-- ─────────────────────────────────────────────────────────────────────────────
-- Remove the pre-migration people model.
--
-- `entities` and `relationships` were superseded by `people` and `introductions`
-- in 001/002 and kept so the backfill could be checked against them. Nothing has
-- read them since. Leaving them means anyone opening the schema finds two people
-- models and has to work out which one is real.
--
-- 002 still reads them when it runs on a fresh database; migrations apply in
-- order, so it has already finished by the time this drops them.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS relationships;
DROP TABLE IF EXISTS entities;

-- The entity-shaped columns on outreach went the same way: 002 copied them into
-- connector_person_id / contact_person_id. Their indexes go too.
--
-- The columns themselves are only dropped on databases that predate this: the
-- base schema no longer creates them, so a new database has nothing to drop, and
-- `ALTER TABLE ... DROP COLUMN` has no IF EXISTS to lean on. See 010.
DROP INDEX IF EXISTS idx_outreach_connector;
DROP INDEX IF EXISTS idx_outreach_contact;
