import { existsSync } from 'fs'
import { parseArgs } from 'util'
import { DEFAULT_DB_PATH, closeDb, dbFile, getDb, useDb } from './db/index'
import { jobsRepo } from './db/jobsRepo'
import {
  DEFAULT_BROWSER_PROFILE_DIR,
  DEFAULT_LOCATION,
  DEFAULT_QUERIES,
  MAX_QUERIES,
  SOURCES,
  allSourcesFailed,
  scrape,
  summaryLine,
} from './scrape'
import type { JobSource } from './types'

const USAGE = `myelin-1: LinkedIn and Indeed job postings, new ones only.

  npm run scrape -- [options]   check the sources, print postings not printed before
  npm run jobs -- [options]     print stored postings, newest first

Postings go to stdout as a JSON array; the summary and any failures go to stderr.

scrape options
  -q, --query <text>      search to run; repeat for more (at most ${MAX_QUERIES} per run)
                          default: ${DEFAULT_QUERIES.map((q) => `"${q}"`).join(', ')}
  -l, --location <text>   default: "${DEFAULT_LOCATION}"
  -s, --source <name>     ${SOURCES.join(' or ')}; repeat for both (default: both)

jobs options
  -s, --source <name>     only postings from this source
      --days <n>          only postings found in the last n days

common
      --db <path>         SQLite file (default: ${DEFAULT_DB_PATH}, or $MYELIN_DB)
  -h, --help

Exit code: 0 done, 1 every source failed or the store could not be used, 2 bad arguments.`

/** Options that mean something to one command only. */
const ONLY_FOR = { scrape: ['query', 'location'], list: ['days'] } as const
const NAME = { scrape: 'scrape', list: 'jobs' } as const

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`)
  process.exit(2)
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// A reader that hung up (| head) is not an error worth a stack trace.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
})

/** Resolves once stdout has taken the text. */
function print(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${text}\n`, (err) => {
      if (!err) resolve()
      else if ((err as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0)
      else reject(err)
    })
  })
}

function parseSources(values: string[] | undefined): JobSource[] | undefined {
  if (!values) return undefined
  for (const v of values) if (!SOURCES.includes(v as JobSource)) fail(`Unknown source "${v}".`)
  return [...new Set(values as JobSource[])]
}

async function main(): Promise<void> {
  let parsed
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        query: { type: 'string', short: 'q', multiple: true },
        location: { type: 'string', short: 'l' },
        source: { type: 'string', short: 's', multiple: true },
        days: { type: 'string' },
        db: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (err) {
    fail(reason(err))
  }
  const { values, positionals } = parsed
  if (values.help) return print(USAGE)

  const [command = 'scrape', ...extra] = positionals
  if (command !== 'scrape' && command !== 'list') fail(`Unknown command "${command}".`)
  if (extra.length > 0) {
    fail(`Unexpected argument "${extra.join(' ')}". Every option needs its flag, and with npm run the options go after "--".`)
  }
  const other = command === 'scrape' ? 'list' : 'scrape'
  const misplaced = ONLY_FOR[other].find((name) => values[name] != null)
  if (misplaced) fail(`--${misplaced} is an option of ${NAME[other]}, not ${NAME[command]}.`)

  if (values.db != null) {
    if (!values.db.trim()) fail('--db needs a path.')
    useDb(values.db)
  }
  const sources = parseSources(values.source)

  if (command === 'list') {
    const days = values.days == null ? undefined : Number(values.days)
    if (days != null && !(Number.isFinite(days) && days > 0)) fail('--days takes a positive number.')
    if (sources && sources.length > 1) fail('jobs takes one --source at a time.')
    // Listing never creates a store: a mistyped path would pass for an empty one.
    if (dbFile() !== ':memory:' && !existsSync(dbFile())) {
      console.error(`No job store at ${dbFile()} yet.`)
      return print('[]')
    }
    return print(JSON.stringify(jobsRepo.list({ source: sources?.[0], days }), null, 2))
  }

  const asked = [...new Set((values.query ?? DEFAULT_QUERIES).map((q) => q.trim()).filter(Boolean))]
  if (asked.length === 0) fail('--query needs some text.')
  const queries = asked.slice(0, MAX_QUERIES)
  if (asked.length > queries.length) {
    console.error(`Running the first ${MAX_QUERIES} queries only; skipped: ${asked.slice(MAX_QUERIES).join(', ')}`)
  }
  try {
    getDb()
  } catch (err) {
    throw new Error(`Cannot use the job store at ${dbFile()}: ${reason(err)}`)
  }
  const use = sources ?? SOURCES
  if (use.includes('indeed')) console.error('Indeed is read in a Chrome window, which opens now and closes when done.')

  const { newJobs, reports } = await scrape({
    queries,
    location: values.location?.trim() || DEFAULT_LOCATION,
    sources: use,
    browserProfileDir: DEFAULT_BROWSER_PROFILE_DIR,
    log: (message) => console.error(message),
  })
  for (const r of reports) for (const note of r.notes) console.error(note)
  console.error(summaryLine(reports))
  const carried = newJobs.length - reports.reduce((n, r) => n + r.added, 0)
  if (carried > 0) {
    console.error(`Also printing ${carried} posting${carried === 1 ? '' : 's'} an earlier run stored but never got to print.`)
  }
  await print(JSON.stringify(newJobs, null, 2))
  // Only now are they reported: a run that dies before this line prints them next time.
  jobsRepo.markReported(newJobs)
  if (allSourcesFailed(reports)) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(reason(err))
    process.exitCode = 1
  })
  .finally(closeDb)
