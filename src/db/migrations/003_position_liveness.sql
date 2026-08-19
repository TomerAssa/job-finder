-- ─────────────────────────────────────────────────────────────────────────────
-- Whether a posting is still open.
--
-- Nothing recorded this, so a role scraped in July and filled in August stayed
-- in the results forever, and every re-crawl resurfaced it. A position is a
-- claim about the world at a moment; it needs a timestamp for when we last saw
-- it and one for when it went away.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE positions ADD COLUMN last_seen_at TEXT;
ALTER TABLE positions ADD COLUMN closed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_positions_open ON positions(closed_at);
CREATE INDEX IF NOT EXISTS idx_positions_seen ON positions(company_id, last_seen_at);

-- Everything already known was, as far as we can tell, last seen when found.
UPDATE positions SET last_seen_at = discovered_at WHERE last_seen_at IS NULL;
