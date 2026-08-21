# Goal

Job Agent League helps one person run one job search well, on their own machine.

It does two things no job board does:

1. **Finds the openings that exist but aren't advertised to you** — by crawling the
   career pages of a defined universe of companies (a sector, a list, a saved search)
   rather than waiting for a feed.
2. **Tells you who can get you in** — by modelling your job search as what it actually
   is: a chain of introductions. Someone led you to someone, who led you to a company.

## Who it's for

Someone running a focused search in a specific market who already knows that warm
intros beat cold applications, and who is willing to run a local tool and bring their
own API keys in exchange for their contact data never leaving their machine.

## Principles

- **Local-first.** SQLite on your disk. Your contacts, your notes and your
  conversations never leave the machine unless you opt into a hosted LLM provider. Nothing personal is
  ever committed to the repo.
- **The graph is the product.** Positions are commodity data; who you know and who
  they can reach is not. Every feature either enriches that graph or acts on it.
- **User-owned data survives re-scrapes.** Your notes, statuses, and introductions are
  yours. A re-crawl may add and update scraped fields; it never overwrites what you typed.
- **Never fabricate a connection.** If we can't verify a path, we say so. An empty
  result is a valid answer; an invented one is not.
- **Spend is visible and bounded.** Scraping and LLM calls cost money. The user chooses
  when to spend it, and sees what it cost.
- **Failures are loud.** A silent `catch` that returns an empty array is a bug, not
  error handling. Every failure surfaces a real message.

## What success looks like

A stranger clones the repo, follows the setup wizard, picks a sector, and within an
hour has: a list of live openings in their target market, a list of people they know
at those companies, and a ranked list of who to ask for an intro.

## Non-goals

- CV tailoring or generation (lives as a separate Claude skill).
- Hosting, accounts, teams, or multi-user anything.
- Being a general CRM. It tracks a job search and nothing else.
- Automated outreach. The tool tells you who to talk to; you do the talking.
