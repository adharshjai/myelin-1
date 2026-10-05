import { collect, type SourceResult } from './collect'
import { plainText, stripHtml } from './html'
import type { NewJob } from '../types'

/**
 * Indeed's search results, read out of a results page. Indeed answers a bare
 * HTTP request with a bot challenge, so nothing here fetches: the caller
 * hands in a loader that returns the page as a real browser rendered it
 * (indeedBrowser.ts opens a visible window for that). No login anywhere.
 *
 * Volume matches LinkedIn's: a few queries per run, one page each,
 * restricted to the last day.
 */

const SEARCH = 'https://www.indeed.com/jobs'

/** The page ships its result cards as one JSON model assigned in a script. */
const MODEL_ASSIGN = /window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*/

/** The tier of results that matched the search. Every other tier is Indeed
 *  padding the page: a search with no matches still lists unrelated
 *  "similar jobs" under a tier of their own. */
const MATCH_TIER = 'DEFAULT'

interface IndeedResult {
  jobkey?: string
  title?: string
  displayTitle?: string
  company?: string
  formattedLocation?: string
  jobLocationCity?: string
  jobLocationState?: string
  remoteLocation?: boolean
  /** Epoch ms of the employer's posting date. */
  pubDate?: number
  /** Epoch ms of when Indeed indexed the posting. */
  createDate?: number
  snippet?: string
  expired?: boolean
  tier?: { type?: string }
}

export function indeedSearchUrl(keywords: string, location: string): string {
  return `${SEARCH}?q=${encodeURIComponent(keywords)}&l=${encodeURIComponent(location)}&fromage=1`
}

/** The JSON object literal that starts at `start`: brace depth, strings skipped. */
function objectAt(text: string, start: number): string | null {
  if (text[start] !== '{') return null
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}' && --depth === 0) {
      return text.slice(start, i + 1)
    }
  }
  return null
}

function isoDate(ms: unknown): string | null {
  if (typeof ms !== 'number' || ms <= 0) return null
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** "City, ST" where Indeed knows both, so the same posting on LinkedIn reads
 *  alike; otherwise the line as displayed ("Remote", a ZIP-suffixed city). */
function locationOf(r: IndeedResult): string {
  if (!r.remoteLocation && r.jobLocationCity && r.jobLocationState) {
    return `${r.jobLocationCity}, ${r.jobLocationState}`
  }
  return r.formattedLocation ?? ''
}

/** Parse a results page's job cards. Best-effort per card: one malformed
 *  card must never cost the rest of the page. */
export function parseIndeedPage(html: string): NewJob[] {
  const assign = MODEL_ASSIGN.exec(html)
  if (!assign) return []
  const json = objectAt(html, assign.index + assign[0].length)
  if (!json) return []
  let results: unknown
  try {
    const data = JSON.parse(json) as {
      metaData?: { mosaicProviderJobCardsModel?: { results?: unknown } }
    }
    results = data.metaData?.mosaicProviderJobCardsModel?.results
  } catch {
    return []
  }
  if (!Array.isArray(results)) return []

  const jobs: NewJob[] = []
  for (const r of results as unknown[]) {
    try {
      const job = cardToJob(r as IndeedResult | null)
      if (job) jobs.push(job)
    } catch {
      // whatever is wrong with this card is this card's problem
    }
  }
  return jobs
}

/** One card as a posting, or null when it is not a live match for the search.
 *  The model's title, company and location are plain text; only the snippet
 *  is markup. */
function cardToJob(r: IndeedResult | null): NewJob | null {
  if (!r || typeof r !== 'object') return null
  const title = r.displayTitle || r.title
  if (typeof r.jobkey !== 'string' || !r.jobkey || typeof title !== 'string' || !title) return null
  if (typeof r.company !== 'string' || !r.company) return null
  if (r.expired || (r.tier?.type != null && r.tier.type !== MATCH_TIER)) return null
  return {
    source: 'indeed',
    externalId: r.jobkey,
    company: plainText(r.company).slice(0, 80),
    title: plainText(title).slice(0, 160),
    location: plainText(String(locationOf(r))).slice(0, 80),
    // Built from the job key alone: the page's own links carry click trackers.
    url: `https://www.indeed.com/viewjob?jk=${encodeURIComponent(r.jobkey)}`,
    descriptionText: typeof r.snippet === 'string' ? stripHtml(r.snippet).slice(0, 2000) : '',
    postedAt: isoDate(r.pubDate) ?? isoDate(r.createDate),
  }
}

/** Returns a URL's HTML as a real browser rendered it, or throws. */
export type PageLoader = (url: string) => Promise<string>

/** One run's worth of Indeed postings: each query's first page. */
export function fetchIndeedJobs(queries: string[], location: string, load: PageLoader): Promise<SourceResult> {
  return collect('Indeed', queries, async (q) => parseIndeedPage(await load(indeedSearchUrl(q, location))))
}
