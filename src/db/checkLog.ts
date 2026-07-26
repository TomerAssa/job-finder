import { db, now } from './client.js';

/** Insert a check_log row and return its id (for later finishLog). */
export function startLog(agent: string, companyId: number | null): number {
  const info = db()
    .prepare(`INSERT INTO check_log (agent, company_id, started_at, status) VALUES (?, ?, ?, 'running')`)
    .run(agent, companyId, now());
  return Number(info.lastInsertRowid);
}

export function finishLog(
  id: number,
  status: 'ok' | 'skipped' | 'error',
  stats?: Record<string, unknown>,
): void {
  db()
    .prepare(`UPDATE check_log SET finished_at = ?, status = ?, stats = ? WHERE id = ?`)
    .run(now(), status, stats ? JSON.stringify(stats) : null, id);
}
