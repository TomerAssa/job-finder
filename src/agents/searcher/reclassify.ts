/**
 * Recompute `positions.is_product` over positions already scraped.
 *
 * The flag is written at scrape time, so changing what counts as a target role
 * would otherwise only affect future crawls and leave thousands of already-found
 * positions classified by the old rules.
 */
import { db } from '../../db/client.js';
import { matcherFromKeywords, matchesTitle, type TitleMatcher } from '../../util/roles.js';

export interface ReclassifyResult {
  scanned: number;
  nowMatching: number;
  added: number;
  removed: number;
  addedExamples: string[];
  removedExamples: string[];
}

export function reclassifyPositions(
  matcher: TitleMatcher = matcherFromKeywords(null),
  opts: { dryRun?: boolean } = {},
): ReclassifyResult {
  const handle = db();
  const rows = handle.prepare('SELECT id, title, is_product FROM positions').all() as {
    id: number;
    title: string;
    is_product: number;
  }[];

  const toSet: number[] = [];
  const toClear: number[] = [];
  const addedExamples: string[] = [];
  const removedExamples: string[] = [];

  for (const r of rows) {
    const should = matchesTitle(r.title, matcher) ? 1 : 0;
    if (should === r.is_product) continue;
    if (should) {
      toSet.push(r.id);
      if (addedExamples.length < 8) addedExamples.push(r.title);
    } else {
      toClear.push(r.id);
      if (removedExamples.length < 8) removedExamples.push(r.title);
    }
  }

  if (!opts.dryRun && (toSet.length || toClear.length)) {
    const set = handle.prepare('UPDATE positions SET is_product = 1 WHERE id = ?');
    const clear = handle.prepare('UPDATE positions SET is_product = 0 WHERE id = ?');
    handle.transaction(() => {
      for (const id of toSet) set.run(id);
      for (const id of toClear) clear.run(id);
    })();
  }

  const nowMatching = rows.filter((r) => matchesTitle(r.title, matcher)).length;
  return {
    scanned: rows.length,
    nowMatching,
    added: toSet.length,
    removed: toClear.length,
    addedExamples,
    removedExamples,
  };
}
