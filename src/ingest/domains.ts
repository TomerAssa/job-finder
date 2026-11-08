/**
 * Backfill company websites from a source CSV that actually knows them.
 *
 * `companies.website_url` is mostly not a company's website. The careers
 * resolver sets it to the first non-social host a search returned, so Aidoc is
 * on file as google.com, Alma Lasers as pgcareers.com and Hazera as
 * greenhouse.com. That was tolerable while the column was only a hint; it
 * stopped being tolerable once `resolveCareers` began probing the domain
 * directly, because a wrong domain means probing a stranger's careers page.
 *
 * The company-list sources carry real websites — `expansion-sources.csv` has
 * one for 3,047 of the 3,113 companies the expansion added — and they are
 * better data than a search result. Backfilling them raised the number of
 * pending companies the domain probe can serve from 30 of 229 to 195 of 229.
 *
 * A stored value is only replaced when it demonstrably does not belong to the
 * company and the CSV's does: anything else is left alone, because filling an
 * empty column is a different act from overwriting a column somebody may have
 * corrected by hand.
 */
import { basename } from 'node:path';
import { db } from '../db/client.js';
import { readCsv, unwrapExcel } from '../util/csv.js';
import { normalizeCompany, similarity } from '../util/normalize.js';
import { hostLooksLikeCompany, hostOf, isJobBoardHost } from '../util/hosts.js';
import { invalidateCompanyCache } from '../db/companies.js';

export class DomainBackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainBackfillError';
  }
}

export interface DomainBackfillResult {
  rows: number;
  /** CSV rows whose company is in the database. */
  matched: number;
  /** Empty column filled in. */
  filled: number;
  /** A host that was not the company's, replaced by one that is. */
  replaced: number;
  /** Already had a host that looks right. */
  kept: number;
  /** CSV had no usable host for this company. */
  unusable: number;
  /** CSV rows naming a company we do not have. */
  unmatched: number;
  examples: { name: string; from: string | null; to: string }[];
}

/** True when this host is worth storing as a company's own website. */
export function usableCompanyHost(website: string, name: string): boolean {
  if (!website) return false;
  const host = hostOf(website);
  if (!host) return false;
  if (isJobBoardHost(website)) return false;
  return hostLooksLikeCompany(host, name, similarity);
}

export function backfillDomains(
  path: string,
  opts: { dryRun?: boolean } = {},
): DomainBackfillResult {
  const rows = readCsv(path);
  if (rows.length === 0) throw new DomainBackfillError(`${basename(path)} has no rows.`);
  const headers = Object.keys(rows[0]);
  for (const required of ['Name', 'Website']) {
    if (!headers.includes(required)) {
      throw new DomainBackfillError(
        `${basename(path)} has no "${required}" column — found: ${headers.join(', ')}.`,
      );
    }
  }

  const result: DomainBackfillResult = {
    rows: 0, matched: 0, filled: 0, replaced: 0, kept: 0, unusable: 0, unmatched: 0, examples: [],
  };

  const find = db().prepare(
    'SELECT id, name, website_url FROM companies WHERE name_norm = ?',
  );
  const update = db().prepare('UPDATE companies SET website_url = ? WHERE id = ?');

  const apply = db().transaction(() => {
    for (const r of rows) {
      const name = unwrapExcel(r['Name'] ?? '');
      const website = unwrapExcel(r['Website'] ?? '');
      const nameNorm = normalizeCompany(name);
      if (!name || !nameNorm) continue;
      result.rows++;

      const company = find.get(nameNorm) as
        | { id: number; name: string; website_url: string | null }
        | undefined;
      if (!company) {
        result.unmatched++;
        continue;
      }
      result.matched++;

      if (!usableCompanyHost(website, company.name)) {
        result.unusable++;
        continue;
      }

      const stored = company.website_url ?? '';
      if (!stored) {
        if (!opts.dryRun) update.run(website, company.id);
        result.filled++;
      } else if (!usableCompanyHost(stored, company.name)) {
        // The stored host is provably not theirs — a search artefact. Replacing
        // it is a correction, not an overwrite of anything considered.
        if (!opts.dryRun) update.run(website, company.id);
        result.replaced++;
        if (result.examples.length < 10) {
          result.examples.push({ name: company.name, from: stored, to: website });
        }
      } else {
        result.kept++;
      }
    }
  });

  apply();
  if (!opts.dryRun) invalidateCompanyCache();
  return result;
}
