import 'server-only';
import { db } from '../db';
import { matcherFromKeywords, matchesTitle, yearsOverlap } from '../../../src/util/roles.js';
import { matchesLocation } from '../../../src/util/location.js';
import type { SearchParams } from '../../../src/db/searches.js';

/**
 * Apply a search to the roles already in the database.
 *
 * The crawl is the expensive half; this is the free half, and it is what makes
 * the form answerable before spending anything. Same matcher the crawl uses, so
 * what you preview is what you get.
 */

export interface SectorOption {
  id: number;
  name: string;
  companies: number;
  /** Never looked at. */
  unvisited: number;
  /** Looked at, but longer ago than the freshness window — listings move on. */
  due: number;
  /** Checked recently enough that re-reading would almost certainly find nothing new. */
  fresh: number;
}

/**
 * How long a check stays good for. Mirrors CHECK_TTL_DAYS, which the searcher
 * uses to decide the same thing — the two must agree or the page will offer a
 * batch the crawler then declines to run.
 */
export const CHECK_TTL_DAYS = Number(process.env.CHECK_TTL_DAYS ?? 7);

export function sectorOptions(): SectorOption[] {
  return db()
    .prepare(
      `SELECT l.id, l.name,
              COUNT(m.company_id) AS companies,
              SUM(CASE WHEN c.last_checked_at IS NULL THEN 1 ELSE 0 END) AS unvisited,
              SUM(CASE WHEN c.last_checked_at IS NOT NULL
                        AND c.last_checked_at < datetime('now', ?) THEN 1 ELSE 0 END) AS due,
              SUM(CASE WHEN c.last_checked_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS fresh
         FROM company_lists l
         LEFT JOIN company_list_members m ON m.list_id = l.id
         LEFT JOIN companies c ON c.id = m.company_id
        WHERE COALESCE(l.source_file,'') != 'demo'
        GROUP BY l.id
        ORDER BY l.name COLLATE NOCASE`,
    )
    .all(`-${CHECK_TTL_DAYS} days`, `-${CHECK_TTL_DAYS} days`) as SectorOption[];
}

export interface SearchHit {
  id: number;
  companyId: number;
  companyName: string;
  sector: string;
  title: string;
  seniority: string;
  location: string;
  url: string;
  minYears: number | null;
  maxYears: number | null;
  paths: number;
}

export interface SearchPreview {
  hits: SearchHit[];
  /** Companies in scope that have never been crawled — what a run would cost. */
  uncrawled: number;
  companiesInScope: number;
  /**
   * Hits with no experience range on record, while a years filter is active.
   *
   * Those roles are kept — a listing that omits its range should not vanish —
   * but the distinction matters: "this job says nothing about experience" and
   * "we never read this job closely enough to know" look identical in the
   * results and are not the same claim. Only enriched roles have a range, and
   * enrichment runs on product roles by default.
   */
  missingYearsData: number;
  yearsFilterActive: boolean;
}

export function previewSearch(params: SearchParams, limit = 200): SearchPreview {
  const handle = db();
  const hasSectors = params.sectors.length > 0;
  const placeholders = params.sectors.map(() => '?').join(',');

  const scopeSql = hasSectors
    ? `p.company_id IN (SELECT company_id FROM company_list_members WHERE list_id IN (${placeholders}))`
    : '1=1';

  const rows = handle
    .prepare(
      `SELECT p.id, p.company_id, c.name AS company_name, COALESCE(c.sector,'') AS sector,
              p.title, p.url, r.seniority, r.min_years, r.max_years, r.is_israel,
              COALESCE(r.normalized_location, p.location) AS loc,
              (
                (SELECT COUNT(*) FROM people pe WHERE pe.works_company_id = p.company_id)
              + (SELECT COUNT(*) FROM connections k WHERE k.company_norm = c.name_norm)
              + (SELECT COUNT(*) FROM introductions i WHERE i.to_company_id = p.company_id)
              ) AS paths
         FROM positions p
         JOIN companies c ON c.id = p.company_id
         LEFT JOIN position_requirements r ON r.position_id = p.id
        WHERE ${scopeSql}
        ORDER BY paths DESC, c.name COLLATE NOCASE`,
    )
    .all(...params.sectors) as Record<string, any>[];

  const matcher = matcherFromKeywords(params.titleKeywords);
  const yearsFilterActive = params.minYears != null || params.maxYears != null;
  const hits: SearchHit[] = [];
  let missingYearsData = 0;
  for (const r of rows) {
    if (!matchesTitle(r.title, matcher)) continue;
    if (!yearsOverlap({ minYears: r.min_years ?? null, maxYears: r.max_years ?? null }, params)) continue;
    if (!matchesLocation({ location: r.loc ?? null, isIsrael: r.is_israel ?? null }, params.location)) continue;
    if (yearsFilterActive && r.min_years == null && r.max_years == null) missingYearsData++;
    hits.push({
      id: r.id,
      companyId: r.company_id,
      companyName: r.company_name,
      sector: r.sector,
      title: r.title,
      seniority: r.seniority ?? 'unknown',
      location: r.loc ?? '',
      url: r.url ?? '',
      minYears: r.min_years ?? null,
      maxYears: r.max_years ?? null,
      paths: r.paths ?? 0,
    });
    if (hits.length >= limit) break;
  }

  const scopeCompanySql = hasSectors
    ? `id IN (SELECT company_id FROM company_list_members WHERE list_id IN (${placeholders}))`
    : '1=1';
  const companiesInScope = (
    handle.prepare(`SELECT COUNT(*) c FROM companies WHERE ${scopeCompanySql}`).get(...params.sectors) as { c: number }
  ).c;
  const uncrawled = (
    handle
      .prepare(`SELECT COUNT(*) c FROM companies WHERE ${scopeCompanySql} AND status != 'checked'`)
      .get(...params.sectors) as { c: number }
  ).c;

  return { hits, uncrawled, companiesInScope, missingYearsData, yearsFilterActive };
}
