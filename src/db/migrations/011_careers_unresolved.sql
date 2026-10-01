-- Remember that a company has no findable careers page.
--
-- Resolution is the expensive half of a crawl: two SERP queries plus an LLM
-- pick, roughly a minute and 2-3 credits. A company that already has a
-- careers_url skips all of it, but one that has never resolved paid it again on
-- every single sweep — 136 of the 500 cyber companies, about 27% of the list,
-- 80 minutes and ~350 credits per run spent rediscovering nothing.
--
-- A company with no careers page this month will not have one next week, so
-- this records when the search came up empty and lets the selection back off
-- for far longer than CHECK_TTL_DAYS. Cleared the moment a page is found.
ALTER TABLE companies ADD COLUMN careers_unresolved_at TEXT;

-- Backfill: every company already checked without producing a careers URL has,
-- by definition, failed resolution. Dating it from the last visit means the
-- backlog backs off immediately rather than being retried one more time.
UPDATE companies
   SET careers_unresolved_at = last_checked_at
 WHERE COALESCE(careers_url, '') = ''
   AND last_checked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_companies_unresolved ON companies(careers_unresolved_at);
