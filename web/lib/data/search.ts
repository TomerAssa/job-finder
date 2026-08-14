import 'server-only';
import { db } from '../db';
import { matcherFromKeywords, matchesTitle, yearsOverlap } from '../../../src/util/roles.js';
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
  crawled: number;
}

export function sectorOptions(): SectorOption[] {
  return db()
    .prepare(
      `SELECT l.id, l.name,
              COUNT(m.company_id) AS companies,
              SUM(CASE WHEN c.status = 'checked' THEN 1 ELSE 0 END) AS crawled
         FROM company_lists l
         LEFT JOIN company_list_members m ON m.list_id = l.id
         LEFT JOIN companies c ON c.id = m.company_id
        GROUP BY l.id
        ORDER BY l.name COLLATE NOCASE`,
    )
    .all() as SectorOption[];
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
              p.title, p.url, r.seniority, r.min_years, r.max_years,
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
  const hits: SearchHit[] = [];
  for (const r of rows) {
    if (!matchesTitle(r.title, matcher)) continue;
    if (!yearsOverlap({ minYears: r.min_years ?? null, maxYears: r.max_years ?? null }, params)) continue;
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

  return { hits, uncrawled, companiesInScope };
}
