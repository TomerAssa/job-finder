/**
 * Merge rows that describe one opening seen by more than one extractor.
 *
 * 005 collapsed exact duplicates, which left the harder case: the ATS API,
 * JSON-LD, the rendered page and LinkedIn each finding the same job and
 * disagreeing about its URL. See `sameJob.ts` for what counts as the same
 * posting — the rule is deliberately conservative, so two genuine openings that
 * share a title stay two rows.
 */
import type Database from 'better-sqlite3';
import { isSameJob, normalizeTitle } from '../../agents/searcher/sameJob.js';

interface Row {
  id: number;
  company_id: number;
  title: string;
  url: string | null;
  source: string | null;
  description: string | null;
  location: string | null;
  discovered_at: string;
  last_seen_at: string | null;
  closed_at: string | null;
  is_shortlisted: number;
  is_product: number;
}

/** Prefer the row from the most authoritative extractor, and one with a URL. */
const SOURCE_RANK: Record<string, number> = {
  greenhouse: 9, lever: 9, workable: 9, ashby: 9, smartrecruiters: 9, recruitee: 9, bamboohr: 9,
  comeet: 8, jsonld: 6, 'llm-iframe': 4, 'llm-rendered': 4, llm: 3, linkedin: 2, tracker: 1,
};
const rank = (r: Row): number => (SOURCE_RANK[r.source ?? ''] ?? 0) + (r.url ? 0.5 : 0);

export function up(handle: Database.Database): void {
  const hasTracking = handle.prepare('SELECT 1 FROM role_tracking WHERE position_id = ?');
  const groups = handle
    .prepare(
      `SELECT company_id, lower(trim(title)) AS t
         FROM positions GROUP BY company_id, lower(trim(title)) HAVING COUNT(*) > 1`,
    )
    .all() as { company_id: number; t: string }[];

  let removed = 0;

  for (const g of groups) {
    const rows = handle
      .prepare(
        `SELECT id, company_id, title, url, source, description, location, discovered_at,
                last_seen_at, closed_at, is_shortlisted, is_product
           FROM positions WHERE company_id = ? AND lower(trim(title)) = ? ORDER BY id`,
      )
      .all(g.company_id, g.t) as Row[];

    // Partition into clusters of rows that all describe one opening.
    const clusters: Row[][] = [];
    for (const row of rows) {
      const cluster = clusters.find((c) => c.every((m) => isSameJob(m, row)));
      if (cluster) cluster.push(row);
      else clusters.push([row]);
    }

    for (const cluster of clusters) {
      if (cluster.length < 2) continue;

      // Anything the user has acted on wins; otherwise the best source.
      const keeper =
        cluster.find((r) => hasTracking.get(r.id)) ??
        [...cluster].sort((a, b) => rank(b) - rank(a) || a.id - b.id)[0];
      const dups = cluster.filter((r) => r.id !== keeper.id);

      // Merging must not quietly undo a decision. When copies disagree, the
      // one furthest along wins: applying to a job outranks dismissing a
      // duplicate the user probably never realised was the same posting.
      const DECISIVENESS: Record<string, number> = {
        via_people: 5, in_process: 4, applied: 3, rejected: 2, relevant: 1,
      };
      const trackings = cluster
        .map((r) => handle.prepare('SELECT * FROM role_tracking WHERE position_id=?').get(r.id) as
          | { position_id: number; status: string | null } | undefined)
        .filter((t): t is { position_id: number; status: string | null } => !!t);
      const best = trackings.sort(
        (a, b) => (DECISIVENESS[b.status ?? ''] ?? 0) - (DECISIVENESS[a.status ?? ''] ?? 0),
      )[0];
      if (best && best.position_id !== keeper.id) {
        handle.prepare('DELETE FROM role_tracking WHERE position_id=?').run(keeper.id);
        handle.prepare('UPDATE role_tracking SET position_id=? WHERE position_id=?').run(keeper.id, best.position_id);
      }

      for (const d of dups) {
        handle.prepare('UPDATE OR IGNORE outreach SET position_id=? WHERE position_id=?').run(keeper.id, d.id);
        handle.prepare('UPDATE OR IGNORE position_requirements SET position_id=? WHERE position_id=?').run(keeper.id, d.id);
      }

      const pick = <K extends keyof Row>(k: K): Row[K] | null =>
        (keeper[k] ?? cluster.find((r) => r[k] != null)?.[k] ?? null) as Row[K] | null;

      const merged = {
        url: pick('url'),
        description: pick('description'),
        location: pick('location'),
        discovered_at: cluster.reduce((a, b) => (a.discovered_at <= b.discovered_at ? a : b)).discovered_at,
        last_seen_at: cluster.map((r) => r.last_seen_at).filter(Boolean).sort().pop() ?? null,
        // Open anywhere means open: one extractor missing it is not evidence
        // the job is gone.
        closed_at: cluster.some((r) => r.closed_at == null) ? null : keeper.closed_at,
        is_shortlisted: cluster.some((r) => r.is_shortlisted) ? 1 : 0,
        is_product: cluster.some((r) => r.is_product) ? 1 : 0,
      };

      // The duplicates go first. The keeper is about to take a URL one of them
      // is still holding, and the dedupe index would reject that.
      const ids = dups.map((d) => d.id);
      handle.prepare(`DELETE FROM positions WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);

      handle
        .prepare(
          `UPDATE positions SET url=?, description=?, location=?, discovered_at=?, last_seen_at=?,
                  closed_at=?, is_shortlisted=?, is_product=? WHERE id=?`,
        )
        .run(
          merged.url, merged.description, merged.location, merged.discovered_at,
          merged.last_seen_at, merged.closed_at, merged.is_shortlisted, merged.is_product,
          keeper.id,
        );

      removed += ids.length;
    }
  }

  console.log(`   merged ${removed} positions seen by more than one source`);
}

export const _normalizeTitle = normalizeTitle;
