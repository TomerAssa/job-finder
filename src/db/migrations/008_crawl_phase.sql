-- A run does two things, and only reported the first.
--
-- After the last company is visited the new roles are read for experience and
-- location, which takes minutes on a large batch. The progress bar sat at 100%
-- the whole time with no sign anything was still happening — the same silence
-- the run itself was built to remove.
ALTER TABLE crawl_runs ADD COLUMN phase TEXT NOT NULL DEFAULT 'searching';
