-- ─────────────────────────────────────────────────────────────────────────────
-- The people graph.
--
-- Replaces the two disconnected halves of the old model: `connections` (a raw
-- mirror of the LinkedIn CSV) and `entities` (the outreach CRM), which shared no
-- key, so the same human could exist in both with no way to join them.
--
-- `people` is now the single visible table. `connections` stays as a candidate
-- pool you promote from — not every LinkedIn connection is someone you'll talk to.
--
-- Data is moved across in 002; this migration only creates structure.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS people (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name        TEXT NOT NULL,
  name_norm        TEXT NOT NULL,             -- normalizeName(); keeps Hebrew
  role             TEXT,
  works_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  external_company TEXT,                      -- company we don't track as a row
  linkedin_url     TEXT,                      -- canonical: https://www.linkedin.com/in/<slug>
  phone            TEXT,                      -- E.164
  email            TEXT,
  status           TEXT NOT NULL DEFAULT 'new',      -- new|to_reach|talked|following_up|done|dead_end
  relevant         TEXT NOT NULL DEFAULT 'unknown',  -- yes|no|maybe|unknown
  can_give         TEXT NOT NULL DEFAULT '[]',       -- JSON array: intro|lead|advice|referral
  summary          TEXT,                      -- rolled-up "where this stands"
  notes            TEXT,
  circle           INTEGER,                   -- DERIVED from introductions; see circles.ts
  origin           TEXT NOT NULL DEFAULT 'manual',   -- manual|bulk_paste|linkedin_import|company_scan|tracker_import
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_people_name_norm ON people(name_norm);
CREATE INDEX IF NOT EXISTS idx_people_company   ON people(works_company_id);
CREATE INDEX IF NOT EXISTS idx_people_status    ON people(status);
CREATE INDEX IF NOT EXISTS idx_people_demo      ON people(is_demo);

-- The two identity keys. Partial so the many people with neither don't collide
-- on NULL; note SQLite already treats NULLs as distinct in a UNIQUE index, but
-- being explicit documents the intent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_linkedin
  ON people(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_phone
  ON people(phone) WHERE phone IS NOT NULL;


-- ─── The referral edge ───────────────────────────────────────────────────────
-- Direction is outbound and natural: `from` introduced me to `to`. (The old
-- `relationships.led_me_to` stored the reverse — from = the person reached.)
--
-- `to` is a person OR a company, never both: "Dana introduced me to Yoni" and
-- "Dana got me into Wiz" are the same kind of fact. A NULL `from_person_id`
-- means the introduction came from outside the graph (a community, family, an
-- event) named by `source_label` — those are the roots of the BFS.
CREATE TABLE IF NOT EXISTS introductions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
  source_label   TEXT,
  to_person_id   INTEGER REFERENCES people(id) ON DELETE CASCADE,
  to_company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  occurred_at    TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL,
  CHECK ((to_person_id IS NOT NULL) <> (to_company_id IS NOT NULL))
);

-- A plain UNIQUE over these columns does NOT dedupe: SQLite treats each NULL as
-- distinct, which is exactly why the old `relationships` table accumulated
-- duplicate edges despite its ON CONFLICT DO NOTHING. COALESCE fixes that.
CREATE UNIQUE INDEX IF NOT EXISTS idx_intro_dedupe ON introductions(
  COALESCE(from_person_id, 0),
  COALESCE(source_label, ''),
  COALESCE(to_person_id, 0),
  COALESCE(to_company_id, 0)
);
CREATE INDEX IF NOT EXISTS idx_intro_from    ON introductions(from_person_id);
CREATE INDEX IF NOT EXISTS idx_intro_to      ON introductions(to_person_id);
CREATE INDEX IF NOT EXISTS idx_intro_company ON introductions(to_company_id);


-- ─── The talk log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id     INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  occurred_at   TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'other',  -- linkedin|phone|whatsapp|email|in_person|other
  what_i_said   TEXT,
  outcome       TEXT,
  next_step     TEXT,
  next_step_due TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interactions_person ON interactions(person_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_due    ON interactions(next_step_due)
  WHERE next_step_due IS NOT NULL;


-- ─── The review queue ────────────────────────────────────────────────────────
-- Scraper output lands here, never straight into `people`. Nothing becomes a
-- person without the user keeping it.
CREATE TABLE IF NOT EXISTS person_candidates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  full_name    TEXT NOT NULL,
  role         TEXT,
  linkedin_url TEXT,
  source       TEXT NOT NULL,                  -- serp|linkedin_people|manual
  confidence   REAL NOT NULL DEFAULT 0.5,
  raw          TEXT,                           -- JSON: the untouched source record
  decision     TEXT NOT NULL DEFAULT 'pending', -- pending|kept|rejected
  person_id    INTEGER REFERENCES people(id) ON DELETE SET NULL, -- set when kept
  found_at     TEXT NOT NULL,
  decided_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_candidates_company  ON person_candidates(company_id, decision);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_dedupe
  ON person_candidates(COALESCE(company_id, 0), COALESCE(linkedin_url, full_name));


-- ─── Company lists / sectors ─────────────────────────────────────────────────
-- Companies appear in several sector exports, so membership is many-to-many.
CREATE TABLE IF NOT EXISTS company_lists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  source_file TEXT,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company_list_members (
  list_id    INTEGER NOT NULL REFERENCES company_lists(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_list_members_company ON company_list_members(company_id);


-- ─── Saved searches ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_searches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  params_json TEXT NOT NULL,   -- {sectors:[], title_keywords:[], min_years, max_years, location}
  created_at  TEXT NOT NULL,
  last_run_at TEXT
);


-- ─── Column additions to existing tables ─────────────────────────────────────
-- `sector` is lifted out of the companies.metadata JSON blob so it can be filtered.
ALTER TABLE companies ADD COLUMN sector TEXT;
ALTER TABLE companies ADD COLUMN linkedin_verified INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_companies_sector ON companies(sector);

-- Set when a LinkedIn connection is promoted into `people`. That promotion is the
-- only way a row crosses from the pool into the visible table.
ALTER TABLE connections ADD COLUMN person_id INTEGER REFERENCES people(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_connections_person ON connections(person_id);

ALTER TABLE companies ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE positions ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;

-- `outreach` still points its connector/contact FKs at `entities`. SQLite cannot
-- change a foreign key in place, and rebuilding the table needs `PRAGMA
-- foreign_keys=OFF`, which cannot be toggled inside the migration transaction.
-- So the people-shaped columns are added alongside and backfilled in 002; the
-- entity columns become vestigial and are dropped once nothing reads them.
ALTER TABLE outreach ADD COLUMN connector_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE outreach ADD COLUMN contact_person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_outreach_connector_person ON outreach(connector_person_id);
CREATE INDEX IF NOT EXISTS idx_outreach_contact_person   ON outreach(contact_person_id);
