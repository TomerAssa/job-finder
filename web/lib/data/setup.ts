import 'server-only';
import { db } from '../db';

/**
 * What the setup wizard needs to know.
 *
 * Everything here is read from configuration and the database — no network
 * calls, so opening the page never spends a credit. Testing connectivity is a
 * separate, explicit button.
 */

export interface SetupStatus {
  keys: { brightData: boolean; llm: boolean; llmProvider: string };
  companies: { total: number; lists: { id: number; name: string; companies: number; crawled: number }[] };
  connections: { total: number; promoted: number };
  positions: { total: number; targetRoles: number };
  demo: { people: number; companies: number; positions: number; active: boolean };
  /** Every step done and no demo rows left. */
  complete: boolean;
}

export function setupStatus(): SetupStatus {
  const handle = db();
  const count = (sql: string) => (handle.prepare(sql).get() as { c: number }).c;

  const brightData = !!(process.env.BRIGHTDATA_API_KEY ?? '').trim();
  const llmProvider =
    process.env.LLM_PROVIDER ??
    ((process.env['GOOGLE_GEMINI2.5_API_KEY'] ?? process.env.GEMINI_API_KEY) ? 'gemini' : 'ollama');
  const llm =
    llmProvider === 'ollama' ||
    !!(
      process.env['GOOGLE_GEMINI2.5_API_KEY'] ??
      process.env.GEMINI_API_KEY ??
      process.env.ANTHROPIC_API_KEY ??
      process.env.OPENAI_API_KEY ??
      ''
    ).trim();

  const lists = handle
    .prepare(
      `SELECT l.id, l.name,
              COUNT(m.company_id) AS companies,
              SUM(CASE WHEN c.status = 'checked' THEN 1 ELSE 0 END) AS crawled
         FROM company_lists l
         LEFT JOIN company_list_members m ON m.list_id = l.id
         LEFT JOIN companies c ON c.id = m.company_id
        WHERE COALESCE(l.source_file, '') != 'demo'
        GROUP BY l.id ORDER BY l.name COLLATE NOCASE`,
    )
    .all() as { id: number; name: string; companies: number; crawled: number }[];

  const demo = {
    people: count('SELECT COUNT(*) c FROM people WHERE is_demo = 1'),
    companies: count('SELECT COUNT(*) c FROM companies WHERE is_demo = 1'),
    positions: count('SELECT COUNT(*) c FROM positions WHERE is_demo = 1'),
    active: false,
  };
  demo.active = demo.people + demo.companies + demo.positions > 0;

  const status: SetupStatus = {
    keys: { brightData, llm, llmProvider },
    companies: { total: count('SELECT COUNT(*) c FROM companies WHERE is_demo = 0'), lists },
    connections: {
      total: count('SELECT COUNT(*) c FROM connections'),
      promoted: count('SELECT COUNT(*) c FROM connections WHERE person_id IS NOT NULL'),
    },
    positions: {
      total: count('SELECT COUNT(*) c FROM positions WHERE is_demo = 0'),
      targetRoles: count('SELECT COUNT(*) c FROM positions WHERE is_demo = 0 AND is_product = 1'),
    },
    demo,
    complete: false,
  };

  status.complete =
    brightData && llm && status.companies.total > 0 && status.positions.total > 0 && !demo.active;
  return status;
}
