# myelin-1

LinkedIn and Indeed job-posting scrapers with a small SQLite store, cut down from Myelin to just the source code. Each run checks both sites for postings from the last day, stores them, and prints only the ones it has not seen before.

There is no UI, no account, and no login anywhere. Neither scraper touches a signed-in session.

## Use

```bash
npm install
npm run scrape
```

Postings go to stdout as a JSON array. The one-line summary and any failures go to stderr, so the output pipes cleanly:

```bash
npm run --silent scrape > new.json
```

Options:

```bash
npm run scrape -- -q "firmware intern" -q "fpga intern"   # your own searches (at most 3 per run)
npm run scrape -- -l "Texas"                              # location (default: United States)
npm run scrape -- -s linkedin                             # one source only
npm run jobs -- --days 7                                  # stored postings found in the last week
npm run jobs -- -s indeed                                 # stored postings from one source
```

With no `-q`, the searches are `software engineer intern` and `hardware engineer intern`.

Exit codes: 0 when the run finished, 1 when every source that was asked failed to answer or the store could not be used, 2 for bad arguments.

A posting counts as printed only once it has actually been written out. If a run is cut short (Ctrl-C while Indeed is still waiting, say), the next run prints what the interrupted one had found.

## Sources

**LinkedIn** uses the guest jobs endpoint, the one LinkedIn's logged-out search pages are built from. It is a plain HTTP request.

**Indeed** answers a plain HTTP request with a bot challenge, so it is read through a normal, visible Google Chrome window that opens for the run and closes after it (Chrome must be installed). The window is ordinary automation and does nothing to hide that. It keeps a profile folder of its own in `data/indeed-profile`, never your Chrome profile.

Indeed sometimes holds that window at a verification page. In testing, the first run of the day went straight through and repeat runs minutes later were held. When that happens the run says so and waits 90 seconds for the page to be cleared in the window by hand; if it is not, Indeed is reported as failed for that run and LinkedIn's results are unaffected. Nothing in this repo tries to get around the verification.

Both scrapers stay deliberately small: each search reads one page of results, restricted to the last day.

## Store

Postings live in `data/jobs.db` (override with `--db <path>` or `MYELIN_DB`). A posting counts as already seen when:

- the same source reported the same posting id before, or
- its URL is already stored (tracking params ignored), or
- its company, title, and location match a stored row (case, punctuation, and trailing company words like "Inc." or "Technology" ignored). This is how one posting listed on both sites stays one row, credited to whichever site reported it first.

## Layout

```
src/
  cli.ts                   the two commands
  scrape.ts                one run: ask each source, store, return what is new
  types.ts
  sources/
    linkedin.ts            guest endpoint fetch and card parser
    indeed.ts              search URL and results-page parser
    indeedBrowser.ts       the visible Chrome window (playwright-core)
    collect.ts             the per-source query loop
    html.ts
  db/
    index.ts               opens the SQLite file, runs migrations
    migrations.ts
    jobsRepo.ts            upsert with de-duplication, listing
    normalizeUrl.ts
```

## Development

```bash
npm test
npm run typecheck
```

The parsers are tested against fixtures trimmed from real responses. A markup change on either site shows up as that source returning 0 postings, or as Indeed reporting that no results page loaded, not as a crash.
