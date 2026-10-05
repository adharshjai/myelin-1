import { getDb } from './db/index'
import { jobsRepo } from './db/jobsRepo'
import { fetchIndeedJobs } from './sources/indeed'
import { openIndeedBrowser } from './sources/indeedBrowser'
import { fetchLinkedInJobs } from './sources/linkedin'
import type { SourceResult } from './sources/collect'
import type { Job, JobSource } from './types'

export const SOURCES: JobSource[] = ['linkedin', 'indeed']
export const DEFAULT_QUERIES = ['software engineer intern', 'hardware engineer intern']
export const DEFAULT_LOCATION = 'United States'
export const DEFAULT_BROWSER_PROFILE_DIR = 'data/indeed-profile'
/** Volume stays deliberately tiny: this many queries per source per run, one page each. */
export const MAX_QUERIES = 3

const LABEL: Record<JobSource, string> = { linkedin: 'LinkedIn', indeed: 'Indeed' }

export interface ScrapeOptions {
  queries: string[]
  location: string
  sources: JobSource[]
  /** Where the Indeed browser window keeps its cookies between runs. */
  browserProfileDir: string
  /** Told what a source is waiting on while it works. */
  log?: (message: string) => void
}

export interface SourceReport {
  source: JobSource
  /** false when no query got a response: offline, rate limited, or blocked. */
  answered: boolean
  postings: number
  /** Postings this run stored for the first time. */
  added: number
  /** Failures only. */
  notes: string[]
}

async function fetchSource(source: JobSource, opts: ScrapeOptions): Promise<SourceResult> {
  if (source === 'linkedin') return fetchLinkedInJobs(opts.queries, opts.location)
  const browser = await openIndeedBrowser(opts.browserProfileDir, opts.log)
  try {
    return await fetchIndeedJobs(opts.queries, opts.location, browser.load)
  } finally {
    await browser.close().catch(() => {})
  }
}

/**
 * One run: ask each source, store what it returned, and hand back the
 * postings no caller has been given yet. A source that fails costs the run
 * nothing but its own postings; a store that fails is the run's failure.
 *
 * `newJobs` stay new until the caller confirms delivery with
 * jobsRepo.markReported, so a run cut short before that (Ctrl-C while a
 * later source is still working) hands them back next time instead of
 * losing them.
 */
export async function scrape(opts: ScrapeOptions): Promise<{ newJobs: Job[]; reports: SourceReport[] }> {
  // An unusable store ends the run here, before any site is asked for anything.
  getDb()
  const reports: SourceReport[] = []
  for (const source of opts.sources) {
    const report: SourceReport = { source, answered: false, postings: 0, added: 0, notes: [] }
    reports.push(report)
    let result: SourceResult
    try {
      result = await fetchSource(source, opts)
    } catch (err) {
      report.notes.push(`${LABEL[source]}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    report.answered = result.answered > 0
    report.postings = result.jobs.length
    report.notes = result.notes
    for (const j of result.jobs) if (jobsRepo.upsert(j).inserted) report.added++
  }
  return { newJobs: jobsRepo.unreported(), reports }
}

/** A run where every source that was asked failed to answer: offline or blocked. */
export function allSourcesFailed(reports: SourceReport[]): boolean {
  return reports.length > 0 && reports.every((r) => !r.answered)
}

/** The one line a run writes. */
export function summaryLine(reports: SourceReport[]): string {
  const parts = reports.map((r) =>
    r.answered ? `${LABEL[r.source]} ${r.postings} (+${r.added} new)` : `${LABEL[r.source]} failed`,
  )
  return `Checked: ${parts.join(', ')}.`
}
