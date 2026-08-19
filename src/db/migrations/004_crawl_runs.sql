-- ─────────────────────────────────────────────────────────────────────────────
-- Long crawls as tracked jobs.
--
-- A whole sector is twenty minutes of work, far past what one HTTP request can
-- hold open. A run is therefore a record the server updates as it goes: the
-- browser starts it, polls it, and can close without stopping it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crawl_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sectors_json    TEXT NOT NULL,          -- company_lists ids in scope
  target_companies INTEGER,               -- stop after this many (null = all due)
  credit_limit    INTEGER,                -- stop when this much has been spent (null = none)
  force           INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'running', -- running|done|stopped|error
  companies_done  INTEGER NOT NULL DEFAULT 0,
  companies_total INTEGER NOT NULL DEFAULT 0,
  positions_added INTEGER NOT NULL DEFAULT 0,
  roles_added     INTEGER NOT NULL DEFAULT 0,
  positions_closed INTEGER NOT NULL DEFAULT 0,
  credits_used    INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  started_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_crawl_runs_status ON crawl_runs(status, started_at DESC);

-- A searcher row left at 'running' means the process died mid-company. Those
-- are from crashes and aborted runs and will never complete, so they should not
-- make the app look permanently busy.
UPDATE check_log SET status = 'error', finished_at = started_at,
                     stats = COALESCE(stats, '{"note":"run did not finish"}')
 WHERE status = 'running' AND started_at < datetime('now', '-1 hour');
