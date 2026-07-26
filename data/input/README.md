# Input files

Drop these three files here (they stay local and are git-ignored):

| File | What | How to get it |
|------|------|---------------|
| `startup-finder.csv` | Your Israel Startup Finder export | Export from the site. Any columns work; the company-name column is auto-detected, the rest is stored as metadata. |
| `Connections.csv` | Your 1st-degree LinkedIn connections | LinkedIn → **Settings → Data Privacy → Get a copy of your data → Connections** → export. The preamble lines are handled automatically. |
| `cv.pdf` | Your CV/resume | Any text-based PDF (not a scan). Text is extracted on `ingest`. |

Override paths with flags, e.g. `npm run job -- ingest --companies /path/to/other.csv`.
