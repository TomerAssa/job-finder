# Job Agent League

> ⚠️ **Work in progress.** The core CLI pipeline runs; the web dashboard and
> some polish are still in progress. See the [Roadmap](#roadmap--todo) below.

A small league of agents that finds you a job in the Israeli startup ecosystem:

- **Searcher** — for each company in your Israel Startup Finder export, discovers the
  careers/ATS page via BrightData **SERP** and pulls open positions (Greenhouse/Lever/
  Workable JSON APIs, or Web-Unlocker HTML + LLM extraction for everything else).
  Uses **Redis** to skip companies checked within `CHECK_TTL_DAYS` and to cache responses.
- **Hot-approach** — matches your 1st-degree LinkedIn connections to target companies
  (a reliable local join on the connections CSV — no scraping). Optional, best-effort
  2nd-degree listing for manual review.
- **Recruiter** — tailors your CV (PDF → text) to each shortlisted position.

Everything is persisted in **SQLite** (`data/output/job.db`) and reported as Markdown + CSV.
The LLM runs **locally via Ollama** by default (your CV never leaves your machine) and is
swappable to Claude/OpenAI via `LLM_PROVIDER`.

## Setup

```bash
npm install
cp .env.example .env            # fill in BRIGHTDATA_API_KEY + zones
docker compose up -d redis      # local Redis
ollama serve && ollama pull qwen2.5:14b   # or set LLM_PROVIDER=anthropic|openai
```

Put `startup-finder.csv`, `Connections.csv`, and `cv.pdf` in `data/input/`
(see `data/input/README.md`).

## Use

```bash
npm run ingest     # load companies, connections, CV
npm run search     # find open positions (add -- --limit 5 to try a few)
npm run connect    # warm intros from your connections (add -- --second-degree to list employees)
npm run tailor     # tailor CV for shortlisted positions (add -- --all for every position)
npm run report     # regenerate positions.md / connections.md / run-log.md + CSVs
# or the whole pipeline:
npm run all
```

Pass flags through npm with `--`, e.g. `npm run search -- --limit 5 --force`.
Outputs land in `data/output/` (`positions.md`, `connections.md`, `run-log.md`,
`tailored-cvs/`, CSV mirrors).

## Notes

- **Company-name-only export:** careers URLs are resolved via SERP, so accuracy varies;
  `ats_type` and the run log record how each company was resolved for auditing.
- **2nd-degree** ("connections who know someone there") is *approximate* — LinkedIn does not
  expose connections-of-connections. That pass only lists public employees for you to review;
  it never fabricates warm intros.
- All personal data (CV, connections) stays local unless you opt into an API LLM provider.

## Roadmap / TODO

Done:

- [x] Ingest (companies, LinkedIn connections, CV)
- [x] Searcher — careers/ATS discovery via SERP + open-position extraction
- [x] Hot-approach — 1st-degree connection ↔ company matching
- [x] Recruiter — per-position CV tailoring
- [x] Markdown + CSV reporting over SQLite

In progress / planned:

- [ ] **Web dashboard** — Next.js console (`web/`) over the same SQLite DB (partial)
- [ ] Better 2nd-degree connection inference and review UI
- [ ] Automated tests + CI
- [ ] One-command setup (`docker compose up` for Redis + app)
- [ ] Configurable LLM provider docs (Gemini / Ollama / Claude / OpenAI)
- [ ] Rate-limit / cost dashboard for BrightData usage

> This is a personal side project and a portfolio piece — not production software.
