# Example inputs

## `company-list.example.csv`

The shape a company list needs. Drop it on the setup page — or run
`npm run job ingest-list examples/company-list.example.csv` — to see the format
work end to end. The companies are invented, so a search over it will find
nothing real.

Only the name column is required; it is auto-detected, and every other column is
kept as metadata. `Primary Sector` becomes the sector you filter on, and
`Website` is used to verify a company's LinkedIn page before trusting people
scraped in its name.

### Getting a real list

This repository does not ship one. The lists this project was built against are
[Startup Nation Central](https://startupnationcentral.org) exports — a
commercial dataset, and not ours to redistribute. Export your own from there, or
bring a CSV from anywhere else: an industry association's member list, a
conference sponsor page, a spreadsheet you keep yourself. Anything with a column
of company names will load.
