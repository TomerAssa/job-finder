-- Remember that a company is not worth crawling again, and why.
--
-- `careers_unresolved_at` (011) already backs off a company whose careers page
-- could not be found. It cannot say *why*, and the two reasons want opposite
-- treatment: a company that simply hides its openings behind a JS portal is
-- worth a manual look, while one whose domain is dead is worth nothing at all.
-- Both were being retried on the same 45-day cycle, and neither was visible as
-- a list the user could triage.
--
-- So the outcome is recorded as a lifecycle state rather than inferred from an
-- absence:
--
--   NULL              — nothing known against it; crawl normally
--   suspected_closed  — dead domain, or found shut down
--   no_web_presence   — a crawl found no company-owned site at all
--   out_of_scope      — real, but not an Israeli company / wrong data
--   live              — confirmed by hand to exist; never skipped, never re-flagged
--
-- Anything but NULL and 'live' is skipped by the searcher unless it is asked
-- for explicitly, which is what makes this cheaper rather than merely tidier.
ALTER TABLE companies ADD COLUMN lifecycle TEXT;

-- Machine-readable cause, kept separate from the state so several causes can
-- share one state: dead-domain | closed | likely-closed | not-israeli
-- | no-website-found | manual.
ALTER TABLE companies ADD COLUMN lifecycle_reason TEXT;

-- What was actually seen — an NXDOMAIN, an acquisition notice, a SERP that
-- returned only aggregators. A state with no evidence behind it is a guess, and
-- the user has to be able to tell the difference before deleting anything.
ALTER TABLE companies ADD COLUMN lifecycle_evidence TEXT;

-- Who decided. 'user' outranks 'auto' permanently: a company the user checked
-- by hand must not be re-flagged by the next scan, because scraped writes fill
-- empty columns only and never overwrite what the user typed.
ALTER TABLE companies ADD COLUMN lifecycle_source TEXT NOT NULL DEFAULT 'auto';

ALTER TABLE companies ADD COLUMN lifecycle_at TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_lifecycle ON companies(lifecycle);

-- A long run reads its own options back out of this row after the request that
-- started it has gone, so "crawl the parked ones too" has to be stored rather
-- than held in the caller's memory.
ALTER TABLE crawl_runs ADD COLUMN include_dormant INTEGER NOT NULL DEFAULT 0;
