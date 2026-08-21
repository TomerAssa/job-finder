# Job Agent League

A local-first job-search tool: crawls company career pages for openings, and models
your network as a graph of introductions so you know who can get you in.

## Read these first

- **[docs/GOAL.md](docs/GOAL.md)** — what the product is for and what it refuses to be.
  Read this before any work on the project.
- **[docs/SPEC.md](docs/SPEC.md)** — how it's implemented, section by section. Read the
  section covering whatever you're about to touch.

If a change contradicts `GOAL.md`, stop and say so rather than implementing it. If it
contradicts `SPEC.md`, the spec may be out of date — flag it and propose the edit.

## Layout

| Path | What |
|---|---|
| `src/cli.ts` | The CLI entry point; every agent is reachable from here |
| `src/agents/` | searcher (careers/ATS discovery + extraction), enrich, hotApproach, people, import |
| `src/db/` | SQLite schema, migrations, and the identity/people layer |
| `src/brightdata/` | Web Unlocker + SERP through one proxy endpoint; Redis-cached, monthly-capped |
| `src/llm/provider.ts` | gemini / ollama / anthropic / openai behind one interface |
| `web/` | Next.js console over the same SQLite file |
| `data/input/`, `data/output/` | Personal data. Gitignored. Never commit anything from here. |

## Conventions

- **SQLite is the source of truth.** Reports and the web UI are derived from it. The web
  app opens the same file as the CLI (`JOB_DB`, defaults to `data/output/job.db`).
- **Schema changes go through `src/db/migrations/`**, never by editing `SCHEMA_SQL` in
  place — an existing DB never sees a column added to a `CREATE TABLE IF NOT EXISTS`.
- **Never swallow an error.** `catch { return [] }` is how the company people-scan silently
  did nothing for months. Surface a typed error the UI can display.
- **Scraped writes fill empty columns only.** Anything the user typed wins over anything a
  scraper found.
- **BrightData and LLM calls cost money.** They stay behind an explicit user action, are
  Redis-cached, and respect `BRIGHTDATA_MONTHLY_LIMIT`.
- **The data is mixed Hebrew/English.** Keep `dir="auto"` on name, role, and company fields;
  `normalizeName()` deliberately preserves Hebrew characters.

## Commands

```bash
npm run ingest     # load companies and LinkedIn connections
npm run search     # crawl careers pages for open positions
npm run connect    # match 1st-degree connections to target companies
npm run report     # regenerate markdown + CSV reports
npm run typecheck  # tsc --noEmit  (note: noUnusedLocals is off)
cd web && npm run dev
```
