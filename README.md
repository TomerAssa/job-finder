# Job Finder

A local-first job search that runs on your machine. It crawls the careers pages
of companies you choose, and models your network as a graph of introductions, so
you can see which openings you have a way into.

Your contacts, your notes and your conversations stay on your disk. Nothing is
uploaded unless you point it at a hosted LLM.

> Personal side project and portfolio piece. It works, and it is not production
> software.

## What it does

**Finds openings that aren't advertised to you.** Pick a sector, and the searcher
resolves each company's careers page and pulls the open roles — straight from
Greenhouse, Lever, Workable, Ashby, SmartRecruiters, Recruitee, BambooHR and
Comeet where they're used, and by reading the page otherwise.

**Tells you who can get you in.** Every person you know is a node; every
introduction is an edge. Someone led you to someone, who led you to a company.
The tool tracks those chains, works out how many hops each person is from you,
and shows which openings sit at companies you already have a path into.

**Keeps a record of who you spoke to.** Every conversation is dated, with what
you asked and what came of it, so a search that runs for months does not depend
on remembering.

It does not write or tailor your CV, send messages for you, or invent a
connection it cannot show you the evidence for.

## Setup

```bash
git clone <this repo> && cd job
npm install                     # one install covers the CLI and the console
cp .env.example .env            # fill in what you want to use
docker compose up -d redis      # caching + the scrape budget counter

npm run job seed-demo           # optional: sample data so nothing is empty
cd web && npm run dev           # → http://localhost:4311/setup
```

`/setup` walks the rest: which keys are set, which company lists are loaded,
whether your connections are imported, and whether anything has been crawled yet.
Finishing it clears the demo data.

### What you need

| | Why | Required |
|---|---|---|
| **BrightData** API key + zones | Fetching careers pages and search results | yes, for crawling |
| **An LLM** — Ollama, Gemini, Claude or OpenAI | Reading listings into structured fields | yes |
| **Redis** | Response cache and the monthly scrape cap | strongly recommended |

Ollama is the default and keeps everything local. `BRIGHTDATA_MONTHLY_LIMIT`
(default 4800) is a hard stop enforced before any billable request, so a runaway
crawl cannot quietly spend your month.

### Your data

Put these in `data/input/` — all of it is gitignored:

| File | What | Where from |
|---|---|---|
| a company list CSV | The companies to search | Startup Nation Central, or any CSV with a name column |
| `Connections.csv` | Your LinkedIn connections | LinkedIn → Settings → Data Privacy → Get a copy of your data |

Both are optional and both can be dropped straight onto the setup page instead —
searching works with neither. Connections are what turn a list of jobs into a
list of jobs you have a way into.

## Use

```bash
npm run job ingest-list "data/input/My Sector.csv"   # load a sector
npm run ingest                                       # LinkedIn connections
npm run job search --sector "My Sector" --limit 20   # crawl (costs credits)
npm run enrich                                       # read years, skills, location
npm run connect                                      # cross connections with companies
```

Then work in the console:

| Screen | |
|---|---|
| **/search** | sector, job title, years of experience |
| **/jobs** | every matching role, list or Kanban |
| **/companies/[id]** | roles, who you know there, and a scan for who else to talk to |
| **/people** | your list, with chains and a log of every conversation |
| **/people/import** | paste LinkedIn URLs or phone numbers, or pull from your connections |

### The people model

`people` is the list of everyone you might talk to. Your LinkedIn export is kept
separate as a **pool** you promote from — most of those hundreds are people you
will never contact, and the pool flags the ones who work somewhere that is hiring.

Identity resolves by **LinkedIn URL → phone → name + company**. A name alone is
never enough to merge two records, because two people share a name more often
than you would like.

An **introduction** is a directed edge: `from` introduced me to `to`, where `to`
is a person or a company. Your "circle" for someone is the shortest chain of
introductions to them, computed rather than typed.

## Design notes

Worth knowing before changing anything:

- **SQLite is the source of truth.** The CLI and the console open the same file.
- **Schema changes go in `src/db/migrations/`**, never by editing the base schema —
  an existing database never sees a column added to `CREATE TABLE IF NOT EXISTS`.
- **Failures are loud.** A swallowed error is how the company people-finder
  silently did nothing for months while reporting "no profiles found".
- **Scraped writes fill empty fields only.** What you typed always wins.
- **Spending is explicit.** Crawls and lookups happen when you ask, are cached,
  and count against the monthly cap.

`docs/GOAL.md` covers what this is for; `docs/SPEC.md` covers how each piece works.

```
src/agents/     searcher · enrich · people · hotApproach · import
src/db/         schema, migrations, and the shared people layer
src/brightdata/ one proxy endpoint, Redis-cached and budget-capped
web/            the Next.js console over the same database
```

```bash
npm test           # unit tests
npm run typecheck
npm run job doctor # check keys, Redis and the LLM actually respond
```

## Roadmap

- [ ] Open-web job-board source, for companies outside any list
- [ ] Rebuild the network graph on the introduction model
- [ ] Follow-up reminders from `next_step_due`
- [ ] CI

## Licence

MIT — see [LICENSE](LICENSE).
