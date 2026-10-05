import { collect, type SourceResult } from './collect'
import { stripHtml } from './html'
import type { NewJob } from '../types'

/**
 * LinkedIn's GUEST jobs endpoint, the one its logged-out search pages are
 * built from. No login, no cookies, none of the user's session anywhere near
 * automation, so their account is never at risk. Postings link to the
 * linkedin.com job page.
 *
 * Volume stays deliberately tiny: a few queries per run, one page each,
 * restricted to the last day. A fraction of one human's browsing.
 */

const GUEST_SEARCH = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search'

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

const TIMEOUT_MS = 20_000

/** Parse the guest response's job cards. Best-effort per card: one malformed
 *  card must never cost the rest of the page. */
export function parseLinkedInCards(html: string): NewJob[] {
  const jobs: NewJob[] = []
  for (const card of html.split(/<li>/i).slice(1)) {
    const id = /data-entity-urn="urn:li:jobPosting:(\d+)"/.exec(card)?.[1]
    const link = /href="(https:\/\/[^"]*linkedin\.com\/jobs\/view\/[^"?]+)/.exec(card)?.[1]
    const title = /base-search-card__title[^>]*>([\s\S]*?)<\//.exec(card)?.[1]
    const company = /base-search-card__subtitle[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\//.exec(card)?.[1]
    const location = /job-search-card__location[^>]*>([\s\S]*?)<\//.exec(card)?.[1]
    const postedAt = /datetime="(\d{4}-\d{2}-\d{2})"/.exec(card)?.[1]
    if (!link || !title || !company) continue
    jobs.push({
      source: 'linkedin',
      externalId: id,
      company: stripHtml(company).slice(0, 80),
      title: stripHtml(title).slice(0, 160),
      location: location ? stripHtml(location).slice(0, 80) : '',
      url: link,
      postedAt: postedAt ?? null,
    })
  }
  return jobs
}

async function fetchQuery(keywords: string, location: string): Promise<NewJob[]> {
  const url = `${GUEST_SEARCH}?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&f_TPR=r86400&start=0`
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (res.status === 429) throw new Error('LinkedIn is rate limiting; not asking again this run.')
  if (!res.ok) throw new Error(`LinkedIn guest search: HTTP ${res.status}`)
  return parseLinkedInCards(await res.text())
}

/** One run's worth of LinkedIn postings: each query's first page. */
export function fetchLinkedInJobs(queries: string[], location: string): Promise<SourceResult> {
  return collect('LinkedIn', queries, (q) => fetchQuery(q, location))
}
