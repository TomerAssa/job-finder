/**
 * SQLite schema. We use plain `CREATE TABLE IF NOT EXISTS` executed on startup
 * rather than a migration tool, so first run needs zero extra steps. The DB is
 * the source of truth; reports are derived from it.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS companies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  name_norm     TEXT NOT NULL,                 -- normalized for fuzzy joins
  metadata      TEXT,                          -- JSON: sector/size/stage/location/...
  website_url   TEXT,
  careers_url   TEXT,
  ats_type      TEXT,                          -- greenhouse|comeet|lever|workable|generic|unknown
  linkedin_url  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|checked|error
  needs_llm     INTEGER NOT NULL DEFAULT 0,     -- no structured parse; flagged for LLM/manual review
  last_error    TEXT,
  last_checked_at TEXT,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_norm ON companies(name_norm);

CREATE TABLE IF NOT EXISTS positions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  location      TEXT,
  url           TEXT,
  source        TEXT,                          -- ats type / 'llm' etc.
  description   TEXT,
  fit_note      TEXT,
  is_product    INTEGER NOT NULL DEFAULT 0,     -- title is a Product Manager role (user's only target)
  is_shortlisted INTEGER NOT NULL DEFAULT 0,
  discovered_at TEXT NOT NULL,
  UNIQUE(company_id, title, url)
);
CREATE INDEX IF NOT EXISTS idx_positions_product ON positions(is_product);
CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company_id);

CREATE TABLE IF NOT EXISTS position_requirements (
  position_id         INTEGER PRIMARY KEY REFERENCES positions(id) ON DELETE CASCADE,
  seniority           TEXT,            -- junior|mid|senior|lead|principal|manager|intern|unknown
  min_years           INTEGER,
  max_years           INTEGER,
  must_have_skills    TEXT,            -- JSON array (lowercased tokens)
  nice_to_have_skills TEXT,            -- JSON array
  tech_stack          TEXT,            -- JSON array
  domain              TEXT,
  employment_type     TEXT,            -- full-time|part-time|contract|internship|unknown
  work_model          TEXT,            -- remote|hybrid|onsite|unknown
  normalized_location TEXT,
  country             TEXT,            -- best-guess country of the role
  is_israel           INTEGER,         -- 1 = in Israel / open to Israel-based, 0 = elsewhere
  languages           TEXT,            -- JSON array
  summary             TEXT,
  enriched_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name    TEXT,
  last_name     TEXT,
  full_name     TEXT NOT NULL,
  company       TEXT,
  company_norm  TEXT,
  position      TEXT,
  linkedin_url  TEXT,
  imported_at   TEXT NOT NULL,
  UNIQUE(full_name, company, linkedin_url)
);
CREATE INDEX IF NOT EXISTS idx_connections_company_norm ON connections(company_norm);

CREATE TABLE IF NOT EXISTS warm_intros (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  match_type    TEXT NOT NULL,                 -- direct|approx_2nd
  confidence    REAL NOT NULL DEFAULT 1.0,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE(company_id, connection_id, match_type)
);

-- ─── Outreach CRM (user-owned; survives re-scrapes) ────────────────────────
CREATE TABLE IF NOT EXISTS entities (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name      TEXT NOT NULL,
  name_norm      TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'manual', -- me|connection|connector|pm|hr|employee|source|manual
  degree         INTEGER,                        -- מעגל: hop distance (1..n)
  works_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  external_company TEXT,                          -- company not in our 500
  role           TEXT,
  linkedin_url   TEXT,
  contact_detail TEXT,                            -- phone / profile URL
  talked_status  TEXT,                            -- דיברנו
  conclusions    TEXT,                            -- מסקנות
  relevant       TEXT,                            -- yes|no|maybe|unknown
  status         TEXT,                            -- new|to-reach|talked|following-up|done
  can_give       TEXT,                            -- JSON array: intro|lead|advice|referral
  source         TEXT NOT NULL DEFAULT 'manual',  -- import|serp|manual
  researched_at  TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_name_norm ON entities(name_norm);
CREATE INDEX IF NOT EXISTS idx_entities_company ON entities(works_company_id);

CREATE TABLE IF NOT EXISTS relationships (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation       TEXT NOT NULL,                   -- led_me_to|knows|works_at|can_reach
  to_entity_id   INTEGER REFERENCES entities(id) ON DELETE CASCADE,
  to_company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  source_label   TEXT,                            -- for communities/LinkedIn/family sources
  note           TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE(from_entity_id, relation, to_entity_id, to_company_id, source_label)
);

CREATE TABLE IF NOT EXISTS role_tracking (
  position_id    INTEGER PRIMARY KEY REFERENCES positions(id) ON DELETE CASCADE,
  relevant       TEXT,                            -- yes|no|maybe|cv_sent
  applied_status TEXT,                            -- free-text status (P column)
  messaged       TEXT,                            -- O column
  status         TEXT,                            -- rejected|applied|in_process|waiting|via_people
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outreach (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id    INTEGER REFERENCES positions(id) ON DELETE CASCADE,
  company_id     INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  connector_entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL,
  contact_entity_id   INTEGER REFERENCES entities(id) ON DELETE SET NULL,
  channel        TEXT,
  status         TEXT NOT NULL DEFAULT 'todo',    -- todo|contacted|replied|submitted|not_relevant|closed
  note           TEXT,
  added_at       TEXT NOT NULL,
  contacted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_outreach_position ON outreach(position_id);
CREATE INDEX IF NOT EXISTS idx_outreach_connector ON outreach(connector_entity_id);
CREATE INDEX IF NOT EXISTS idx_outreach_contact ON outreach(contact_entity_id);

CREATE TABLE IF NOT EXISTS check_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agent         TEXT NOT NULL,                 -- searcher|connect|enrich|people
  company_id    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL,                 -- ok|skipped|error
  stats         TEXT                           -- JSON: {positions: n, ...}
);
CREATE INDEX IF NOT EXISTS idx_check_log_company ON check_log(company_id);
`;

export interface CompanyRow {
  id: number;
  name: string;
  name_norm: string;
  metadata: string | null;
  website_url: string | null;
  careers_url: string | null;
  ats_type: string | null;
  linkedin_url: string | null;
  status: string;
  needs_llm: number;
  last_error: string | null;
  last_checked_at: string | null;
  created_at: string;
}

export interface PositionRow {
  id: number;
  company_id: number;
  title: string;
  location: string | null;
  url: string | null;
  source: string | null;
  description: string | null;
  fit_note: string | null;
  is_product: number;
  is_shortlisted: number;
  discovered_at: string;
}

export interface ConnectionRow {
  id: number;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  company: string | null;
  company_norm: string | null;
  position: string | null;
  linkedin_url: string | null;
  imported_at: string;
}

export interface EntityRow {
  id: number;
  full_name: string;
  name_norm: string;
  kind: string;
  degree: number | null;
  works_company_id: number | null;
  external_company: string | null;
  role: string | null;
  linkedin_url: string | null;
  contact_detail: string | null;
  talked_status: string | null;
  conclusions: string | null;
  relevant: string | null;
  source: string;
  researched_at: string | null;
  notes: string | null;
  created_at: string;
}
