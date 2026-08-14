# Spec

How [the goal](./GOAL.md) is implemented. Sections map to phases in the implementation plan.

## 1. Data model

### `people` — the main table, everyone you might talk to

| column | notes |
|---|---|
| `id`, `full_name`, `name_norm` | `name_norm` via `normalizeName()` (keeps Hebrew) |
| `role`, `works_company_id` → companies, `external_company` | company resolved by `matchCompany()`, else free text |
| `linkedin_url`, `phone`, `email` | `linkedin_url` and `phone` each get a **partial unique index** (`WHERE ... IS NOT NULL`) — these are the identity keys |
| `status` | `new` \| `to_reach` \| `talked` \| `following_up` \| `done` \| `dead_end` |
| `relevant` | `yes` \| `no` \| `maybe` \| `unknown` |
| `can_give` | JSON array: `intro` \| `lead` \| `advice` \| `referral` |
| `summary` | rolled-up "where this stands" — user-editable, optionally LLM-generated from the log |
| `circle` | **derived**, recomputed by BFS over `introductions`. Never hand-edited. |
| `origin` | `manual` \| `bulk_paste` \| `linkedin_import` \| `company_scan` \| `tracker_import` |
| `is_demo` | 1 for seeded demo rows; purged on setup completion |
| `created_at`, `updated_at` | |

Identity resolution order, used by every writer: **linkedin_url → phone → (name_norm + company)**.
Name-only matching is a *suggestion* surfaced in the dedupe UI, never an automatic merge —
the current `upsertEntity` matches on `name_norm` alone, which silently merges two different
people who share a name.

Scraped writes fill empty columns only (`fill()` semantics, preserved from `src/db/entities.ts`).
User edits always win.

### `linkedin_connections` — the candidate pool

The existing `connections` table, kept as a raw mirror of the LinkedIn CSV export. **Not
shown in the People section.** Gains one column: `person_id` (nullable FK to `people`), set
when the user promotes a connection into their people list. Promotion is the only way a row
crosses over.

The pool stays live: when a search surfaces an opening at a company whose `company_norm`
matches a connection's, the UI offers "You know N people here — add them."

### `introductions` — the referral edge

```sql
CREATE TABLE introductions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,  -- NULL = reached directly / via source_label
  source_label   TEXT,                                             -- community, family, event; used when from_person_id IS NULL
  to_person_id   INTEGER REFERENCES people(id) ON DELETE CASCADE,
  to_company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  occurred_at    TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL,
  CHECK ((to_person_id IS NOT NULL) <> (to_company_id IS NOT NULL))
);
CREATE UNIQUE INDEX idx_intro_dedupe ON introductions(
  COALESCE(from_person_id,0), COALESCE(source_label,''),
  COALESCE(to_person_id,0),   COALESCE(to_company_id,0));
```

Direction is **outbound and natural**: `from` introduced me to `to`. This is the reverse of
today's `relationships.led_me_to`, which stores from = the person reached. The migration flips
existing rows.

The `COALESCE` unique index is deliberate — a plain `UNIQUE` over nullable columns does not
dedupe in SQLite, which is why duplicate edges exist today.

A person's profile shows two lists, both a single query:

- **Who led me to them** — `WHERE to_person_id = ?` (inbound; usually one, may be several)
- **Who/what they led me to** — `WHERE from_person_id = ?` (outbound; people *and* companies)

Chains fall out of this for free: `me → A → B → Wiz` is three rows. `circle` is BFS depth from
the roots (rows where `from_person_id IS NULL`). Recomputed on every edge write; cheap at this scale.

### `interactions` — the talk log

`id`, `person_id`, `occurred_at`, `channel` (`linkedin`|`phone`|`whatsapp`|`email`|`in_person`|`other`),
`what_i_said`, `outcome`, `next_step`, `next_step_due`, `created_at`.

Powers the profile thread and "who haven't I followed up with." `people.summary` is the
rolled-up view; a "Summarize from log" button regenerates it via the LLM on demand.

### `person_candidates` — the review queue

Scraper output lands here, never straight into `people`. `id`, `company_id`, `full_name`,
`role`, `linkedin_url`, `source`, `confidence`, `raw` (JSON), `found_at`, `decision`
(`pending`|`kept`|`rejected`). Keeping a candidate runs identity resolution and creates or
merges a `people` row.

### `company_lists` + `companies.sector`

Companies appear in several sector CSVs, so the link is many-to-many:
`company_lists(id, name, source_file, imported_at)` and
`company_list_members(list_id, company_id)`. `companies.sector` is promoted out of the
`metadata` JSON blob into a real indexed column so it can be filtered on.

### Migrations

There is no migration tool today — `SCHEMA_SQL` is one string of `CREATE TABLE IF NOT EXISTS`
run on every open, which means a column added later never reaches an existing DB. (This has
already bitten: `entities.status` and `entities.can_give` are in the DDL but missing from the
`EntityRow` interface, and would be missing from any older DB.)

Add a minimal runner: `src/db/migrations/NNN_name.sql`, applied in order, tracked in a
`schema_migrations` table, run inside a transaction on DB open.

## 2. People section

Routes: `/people` (list), `/people/[id]` (profile), `/people/import` (bulk + pool).

**List** — table and card views. Filter by status × circle × can-give × company. Sort by
circle, last interaction, status. The current three-view segmented control (Cards/Table/Talk-to)
is preserved; "Talk-to" becomes a filter (`status IN (new, to_reach)`) rather than a third layout.

**Profile** — identity block (name, role, company, LinkedIn, phone), the two introduction lists,
the interaction log with an inline "log a conversation" form, the rolled-up summary, and
free-text notes.

**Bulk add** — one paste box, one entry per line, type auto-detected:

- A LinkedIn URL → **enriched immediately** via the scraper (name, role, company). Enrichment
  runs in a batch with a progress indicator and a visible credit count; failures leave the row
  with a slug-derived name and an "enrich failed" badge you can retry.
- A phone number → a bare row named "Unknown (+972…)" that you rename after you talk to them.
  Normalized to E.164 for the uniqueness index.
- Anything else → rejected with the line number shown.

Both paths run identity resolution against existing `people` before inserting, and report
"N added, M already existed."

**LinkedIn connections pool** — a searchable list of the raw CSV import, showing each
connection's company and a badge when that company has open positions in your DB. Select →
"Add to people." This is the answer to "not every LinkedIn connection is someone I'll talk to."

## 3. Company people scan (replaces "Find PMs and HR")

**Route:** `POST /api/companies/[id]/people-scan` — a real API route. The current implementation
is a server action that spawns `npx tsx src/cli.ts people --company N --json` and parses stdout;
that is removed. The finder is called in-process.

**Company identity gate.** Before scanning, resolve the company's LinkedIn page and compare the
website it lists against `companies.website_url`. On match, set `companies.linkedin_url` +
`companies.linkedin_verified = 1`. Only a verified company uses the LinkedIn people path.
Unverified companies fall back to the SERP query with candidates marked low-confidence. This
exists because `site:linkedin.com/in "Dream"` matches everything and nothing.

**Roles are configurable** — presets (Product, HR/Talent, Engineering leadership, Founders) plus
a custom title list, replacing the two hardcoded queries.

**Results go to `person_candidates`**, rendered as a review list with keep/reject per row.
Nothing enters `people` without a click.

**Errors surface.** No bare `catch`. Every failure path returns a typed error the UI displays:
missing API key, monthly cap reached, zero results, parse failure. A `check_log` row is written
on *both* success and failure.

## 4. Search

A saved-search model, replacing hardcoded targeting.

**Parameters:** `sector` (required — one or more of the imported company lists), `title_keywords`
(optional, defaults to the Product Manager matcher), `min_years` / `max_years` (optional, matched
against `position_requirements.min_years/max_years`), `location` (defaults to Israel).

Persisted as `saved_searches(id, name, params_json, created_at, last_run_at)` so a search can be
re-run and diffed.

**Two-stage execution:**

1. **Sector lists first.** Ingest the five `data/input/Companies List *.csv` files into
   `company_lists` (they're identical Startup Nation Central exports — the existing
   `src/ingest/companies.ts` auto-detects the name column and handles the `="…"` Excel guard).
   Run the existing searcher over the selected lists' companies. This reuses the whole ATS
   pipeline that already works.
2. **Open web second.** A new source queries job boards by title + industry for companies not in
   any list, and registers new companies as it finds them. Runs after stage 1, is separately
   toggleable, and reports its credit cost separately.

`isProductManager()` in `src/util/roles.ts` generalizes to `matchesTitle(title, keywords)`;
`positions.is_product` stays as the default-config case so existing data and the Kanban keep working.

**UI:** `/search` — a form, a run button with a live progress/cost readout, and results feeding
the existing jobs list and Kanban.

## 5. Web app structure

`web/app/console.tsx` is 696 lines: the whole UI, inline-style tokens, four facets, the SVG
graph, and every modal. It is split into routes (`/people`, `/jobs`, `/companies/[id]`, `/search`,
`/setup`) with components under `web/app/_components/`. The `THEMES` token system, the `V()`
helper, and the style factories (`pill()`, `chip()`, `seg()`, `card`) are kept as-is and moved to
`web/app/_components/ui.tsx` — they work and match the design handoff.

Server actions are kept for simple mutations (status, notes). Anything that scrapes, spends
credits, or can fail gets a real API route so errors and progress are reportable.

The **Network facet is removed** — `computeGraph()` and the SVG block delete cleanly. The data
stays; the graph can be rebuilt later on the much better `introductions` model.

`web/lib/queries.ts` (174 lines, imported by nothing) is either wired up or deleted — no dead
analytics layer.

## 6. First run

**Demo data.** `npm run seed:demo` inserts synthetic companies, positions, people, introductions,
and interactions, all with `is_demo = 1`. Every demo row renders with a visible marker and the app
shows a persistent banner: *"This is demo placeholder data. Finish setup to clear it."* Demo names
are obviously fictional — no plausible-looking real people.

**Setup wizard** at `/setup`, four steps: (1) check API keys and Redis, reusing `src/doctor.ts`;
(2) import a company list or pick a bundled sector; (3) import your LinkedIn connections CSV;
(4) run your first search. Completing the wizard deletes every `is_demo = 1` row in one
transaction and drops the banner. Skippable and re-runnable.

**Open-source hygiene.** `data/input/*` and `data/output/` are already gitignored and nothing
personal is committed — verified. Add a LICENSE, rewrite the README around the new flow, and
document every env var. The author's own data stays in the existing gitignored
`data/output/job.db`, reachable via `JOB_DB`.
