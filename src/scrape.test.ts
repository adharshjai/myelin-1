import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, useDb } from './db/index'
import { jobsRepo } from './db/jobsRepo'
import { allSourcesFailed, scrape, summaryLine, type ScrapeOptions, type SourceReport } from './scrape'

const card = (id: number, title: string) => `
<li>
  <div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:${id}">
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/${id}?position=1"></a>
    <h3 class="base-search-card__title">${title}</h3>
    <h4 class="base-search-card__subtitle"><a href="https://www.linkedin.com/company/acme">Acme Robotics</a></h4>
    <span class="job-search-card__location">Austin, TX</span>
    <time datetime="2026-10-05">1 hour ago</time>
  </div>
</li>`

const OPTIONS: ScrapeOptions = {
  queries: ['software engineer intern', 'hardware engineer intern'],
  location: 'United States',
  sources: ['linkedin'],
  browserProfileDir: 'unused',
}

const respond = (...pages: (string | number)[]) => {
  const fetchMock = vi.fn(async () => {
    const next = pages.shift() ?? ''
    return typeof next === 'number' ? new Response('', { status: next }) : new Response(next)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => useDb(':memory:'))
afterEach(() => vi.unstubAllGlobals())
afterAll(closeDb)

describe('scrape', () => {
  it('stores what the source returned and hands back each posting once', async () => {
    const fetchMock = respond(card(1, 'Software Engineer Intern') + card(2, 'Firmware Intern'), card(2, 'Firmware Intern'))
    const { newJobs, reports } = await scrape(OPTIONS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(newJobs.map((j) => j.title)).toEqual(['Software Engineer Intern', 'Firmware Intern'])
    expect(reports).toEqual([{ source: 'linkedin', answered: true, postings: 2, added: 2, notes: [] }])
    expect(jobsRepo.count()).toBe(2)
  })

  it('hands back only what is new since the last run that delivered', async () => {
    respond(card(1, 'Software Engineer Intern'), '')
    jobsRepo.markReported((await scrape(OPTIONS)).newJobs)
    respond(card(1, 'Software Engineer Intern') + card(3, 'Hardware Engineer Intern'), '')
    const { newJobs, reports } = await scrape(OPTIONS)
    expect(newJobs.map((j) => j.title)).toEqual(['Hardware Engineer Intern'])
    expect(reports[0]).toMatchObject({ postings: 2, added: 1 })
  })

  it('hands a posting back again when the run that found it never delivered it', async () => {
    respond(card(1, 'Software Engineer Intern'), '')
    await scrape(OPTIONS) // cut short: nothing marked reported
    respond(card(1, 'Software Engineer Intern') + card(3, 'Hardware Engineer Intern'), '')
    const { newJobs, reports } = await scrape(OPTIONS)
    expect(newJobs.map((j) => j.title)).toEqual(['Software Engineer Intern', 'Hardware Engineer Intern'])
    expect(reports[0]).toMatchObject({ postings: 2, added: 1 })
    jobsRepo.markReported(newJobs)
    respond('', '')
    expect((await scrape(OPTIONS)).newJobs).toEqual([])
  })

  it('fails the run, not the source, when the store cannot be used', async () => {
    const unopenable = respond(card(1, 'Software Engineer Intern'), '')
    useDb('/dev/null/no/such/dir/jobs.db')
    await expect(scrape(OPTIONS)).rejects.toThrow()
    expect(unopenable).not.toHaveBeenCalled()

    useDb(':memory:')
    respond(card(1, 'Software Engineer Intern'), '')
    getDb().exec('DROP TABLE jobs')
    await expect(scrape(OPTIONS)).rejects.toThrow(/no such table/)
  })

  it('reports a source that never answered, and keeps what answered before the failure', async () => {
    respond(429)
    const blocked = await scrape(OPTIONS)
    expect(blocked.newJobs).toEqual([])
    expect(blocked.reports[0].answered).toBe(false)
    expect(blocked.reports[0].notes[0]).toMatch(/^LinkedIn "software engineer intern": LinkedIn is rate limiting/)
    expect(allSourcesFailed(blocked.reports)).toBe(true)

    respond(card(1, 'Software Engineer Intern'), 500)
    const partial = await scrape(OPTIONS)
    expect(partial.newJobs).toHaveLength(1)
    expect(partial.reports[0]).toMatchObject({ answered: true, added: 1 })
    expect(partial.reports[0].notes).toEqual(['LinkedIn "hardware engineer intern": LinkedIn guest search: HTTP 500'])
    expect(allSourcesFailed(partial.reports)).toBe(false)
  })
})

describe('summaryLine', () => {
  const report = (over: Partial<SourceReport>): SourceReport => ({
    source: 'linkedin',
    answered: true,
    postings: 0,
    added: 0,
    notes: [],
    ...over,
  })

  it('counts each source and names the ones that failed', () => {
    expect(
      summaryLine([report({ postings: 10, added: 3 }), report({ source: 'indeed', postings: 7, added: 0 })]),
    ).toBe('Checked: LinkedIn 10 (+3 new), Indeed 7 (+0 new).')
    expect(summaryLine([report({ postings: 4, added: 4 }), report({ source: 'indeed', answered: false })])).toBe(
      'Checked: LinkedIn 4 (+4 new), Indeed failed.',
    )
  })
})
