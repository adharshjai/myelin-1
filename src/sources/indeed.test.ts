import { describe, expect, it } from 'vitest'
import { fetchIndeedJobs, indeedSearchUrl, parseIndeedPage } from './indeed'

/** Result cards trimmed from a real search page (2026-10-05): most keys and
 *  every tracking token dropped, values as served. */
const NVIDIA = {
  company: 'NVIDIA',
  createDate: 1791186898539,
  displayTitle: 'NVIDIA 2027 Ignite Internships: Software Engineering',
  expired: false,
  formattedLocation: 'Santa Clara, CA 95051',
  formattedRelativeTime: 'Just posted',
  jobLocationCity: 'Santa Clara',
  jobLocationPostal: '95051',
  jobLocationState: 'CA',
  jobTypes: [],
  jobkey: 'af36bb06f876162f',
  pubDate: 1791176400000,
  remoteLocation: false,
  snippet:
    '<ul style="list-style-type:circle;margin-top: 0px;margin-bottom: 0px;padding-left:20px;">\n <li>NVIDIA will cover one-time round trip expense for students traveling over 50 miles to Santa Clara and provide a supplemental housing stipend to assist with…</li>\n</ul>',
  sponsored: false,
  title: 'NVIDIA 2027 Ignite Internships: Software Engineering',
  link: '/rc/clk?jk=af36bb06f876162f&bb=TRIMMED&fccid=TRIMMED&vjs=3',
  tier: { type: 'DEFAULT' },
  viewJobLink: '/viewjob?jk=af36bb06f876162f&from=vjs&tk=TRIMMED&viewtype=embedded',
}

const MICROSOFT = {
  company: 'Microsoft',
  createDate: 1791211531861,
  displayTitle: 'Firmware Engineering Internship (6-month Program)',
  expired: false,
  formattedLocation: 'Santa Clara, CA 95050',
  formattedRelativeTime: 'Just posted',
  jobLocationCity: 'Santa Clara',
  jobLocationPostal: '95050',
  jobLocationState: 'CA',
  jobTypes: ['Internship'],
  jobkey: 'a483009f3bfac904',
  pubDate: 1790917200000,
  remoteLocation: false,
  snippet:
    '<ul style="list-style-type:circle;margin-top: 0px;margin-bottom: 0px;padding-left:20px;">\n <li style="margin-bottom:0px;">Contributes to developer tests and system-level testing to ensure <b>software</b> quality and reliability.</li>\n <li>Designs, develops, and debugs embedded <b>software</b> in C/C++…</li>\n</ul>',
  sponsored: false,
  title: 'Firmware Engineering Internship (6-month Program)',
  link: '/rc/clk?jk=a483009f3bfac904&bb=TRIMMED&fccid=TRIMMED&vjs=3',
  tier: { type: 'DEFAULT' },
  viewJobLink: '/viewjob?jk=a483009f3bfac904&from=vjs&tk=TRIMMED&viewtype=embedded',
}

/** What a search with no matches is padded with: unrelated, under its own tier. */
const SIMILAR_JOB = {
  company: 'SMC Concrete and Construction',
  displayTitle: 'Construction Crew Member – Concrete, Steel & Ag Construction',
  formattedLocation: 'Cawker City, KS 67430',
  jobkey: '91e1aed7b67c2726',
  pubDate: 1790830800000,
  tier: { rawType: 'rjponserp', type: 'RJP_ON_SERP' },
  title: 'Construction Crew Member – Concrete, Steel & Ag Construction',
}

/** The script as the page carries it: the model is one assignment among several. */
function page(results: unknown[]): string {
  const model = {
    metaData: {
      isJpBundle: false,
      mosaicProviderJobCardsModel: { adSignature: '727', appName: 'jasx', pageNumber: 1, results, what: 'software engineer intern', where: 'United States' },
    },
    providerId: 'mosaic-provider-jobcards',
    uiVariant: 'List',
  }
  return `<!DOCTYPE html><html><head><title>Software Engineer Intern Jobs | Indeed</title></head><body>
<div id="mosaic-provider-jobcards"></div>
<script id="mosaic-data" type="text/javascript">
    window.mosaic.providerData["mosaic-provider-app-download-promos"]={"metaData":{"citation":"Indeed data (US)"}};
    window.mosaic.providerData["mosaic-provider-jobcards"]=${JSON.stringify(model)};
    window.mosaic.providerData["mosaic-provider-passport-intercept"]={"metaData":{"shouldShow":false}};
</script></body></html>`
}

describe('parseIndeedPage', () => {
  const jobs = parseIndeedPage(page([NVIDIA, MICROSOFT]))

  it('reads the fields exactly as posted', () => {
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatchObject({
      source: 'indeed',
      externalId: 'af36bb06f876162f',
      company: 'NVIDIA',
      title: 'NVIDIA 2027 Ignite Internships: Software Engineering',
      postedAt: '2026-10-05',
    })
  })

  it('links the posting by its job key, never the click tracker', () => {
    expect(jobs[0].url).toBe('https://www.indeed.com/viewjob?jk=af36bb06f876162f')
  })

  it('writes the location as "City, ST", the way LinkedIn does', () => {
    expect(jobs[0].location).toBe('Santa Clara, CA')
  })

  it('dates a posting by when the employer posted it, not when Indeed indexed it', () => {
    // Indexed 2026-10-05 and labelled "Just posted"; posted three days earlier.
    expect(jobs[1].postedAt).toBe('2026-10-02')
  })

  it('keeps the snippet as plain text', () => {
    expect(jobs[1].descriptionText).toBe(
      'Contributes to developer tests and system-level testing to ensure software quality and reliability. Designs, develops, and debugs embedded software in C/C++…',
    )
  })

  it('keeps the displayed location when Indeed has no city and state, or the job is remote', () => {
    const [remote, bare] = parseIndeedPage(
      page([
        { ...NVIDIA, remoteLocation: true, formattedLocation: 'Remote in Santa Clara, CA' },
        { ...MICROSOFT, jobLocationCity: '', jobLocationState: '', formattedLocation: 'United States' },
      ]),
    )
    expect(remote.location).toBe('Remote in Santa Clara, CA')
    expect(bare.location).toBe('United States')
  })

  it('falls back to the indexing date when the posting date is missing', () => {
    const [job] = parseIndeedPage(page([{ ...NVIDIA, pubDate: undefined }]))
    expect(job.postedAt).toBe('2026-10-05')
    expect(parseIndeedPage(page([{ ...NVIDIA, pubDate: undefined, createDate: undefined }]))[0].postedAt).toBeNull()
  })

  it('ignores the "similar jobs" a search with no matches is padded with', () => {
    expect(parseIndeedPage(page([SIMILAR_JOB]))).toHaveLength(0)
    expect(parseIndeedPage(page([SIMILAR_JOB, NVIDIA]))).toHaveLength(1)
  })

  it('skips expired and malformed cards without losing the rest', () => {
    const parsed = parseIndeedPage(
      page([
        { ...NVIDIA, expired: true },
        null,
        'not a card',
        { ...NVIDIA, jobkey: '' },
        { ...NVIDIA, company: '' },
        { title: 'No key or company' },
        MICROSOFT,
      ]),
    )
    expect(parsed.map((j) => j.externalId)).toEqual(['a483009f3bfac904'])
  })

  it('is not thrown by braces and quotes inside the text', () => {
    const tricky = { ...NVIDIA, displayTitle: 'Engineer {C++ "embedded"} \\ }', snippet: '<li>if (x) { y = "}" }</li>' }
    const [job] = parseIndeedPage(page([tricky, MICROSOFT]))
    expect(job.title).toBe('Engineer {C++ "embedded"} \\ }')
    expect(job.descriptionText).toBe('if (x) { y = "}" }')
  })

  it('takes titles and companies as the plain text they are', () => {
    const [job] = parseIndeedPage(page([{ ...NVIDIA, displayTitle: 'Intern <Summer> R&D &amp; Tools', company: 'A<B>C  Labs' }]))
    expect(job.title).toBe('Intern <Summer> R&D &amp; Tools')
    expect(job.company).toBe('A<B>C Labs')
  })

  it('lets a card that cannot be read cost only itself', () => {
    const parsed = parseIndeedPage(
      page([
        { ...NVIDIA, snippet: 'Bad reference &#99999999; here' },
        { ...NVIDIA, jobkey: 'lone\ud800surrogate' },
        MICROSOFT,
      ]),
    )
    expect(parsed.map((j) => j.externalId)).toEqual(['af36bb06f876162f', 'a483009f3bfac904'])
    expect(parsed[0].descriptionText).toBe('Bad reference &#99999999; here')
  })

  it('returns nothing for an empty, unrecognized, or cut-off page', () => {
    expect(parseIndeedPage('')).toHaveLength(0)
    expect(parseIndeedPage('<html><body>Additional Verification Required</body></html>')).toHaveLength(0)
    expect(parseIndeedPage(page([]))).toHaveLength(0)
    const whole = page([NVIDIA])
    expect(parseIndeedPage(whole.slice(0, whole.indexOf('"results"') + 40))).toHaveLength(0)
    expect(parseIndeedPage('window.mosaic.providerData["mosaic-provider-jobcards"]=null;')).toHaveLength(0)
  })
})

describe('indeedSearchUrl', () => {
  it('asks for the last day of postings', () => {
    expect(indeedSearchUrl('software engineer intern', 'United States')).toBe(
      'https://www.indeed.com/jobs?q=software%20engineer%20intern&l=United%20States&fromage=1',
    )
  })
})

describe('fetchIndeedJobs', () => {
  it('loads one page per query and reports a posting once', async () => {
    const loaded: string[] = []
    const result = await fetchIndeedJobs(['software intern', 'firmware intern'], 'United States', async (url) => {
      loaded.push(url)
      return page(loaded.length === 1 ? [NVIDIA, MICROSOFT] : [MICROSOFT])
    })
    expect(loaded).toHaveLength(2)
    expect(result.answered).toBe(2)
    expect(result.notes).toEqual([])
    expect(result.jobs.map((j) => j.company)).toEqual(['NVIDIA', 'Microsoft'])
  })

  it('stops asking after the first failure and says why', async () => {
    let calls = 0
    const result = await fetchIndeedJobs(['a', 'b', 'c'], 'United States', async () => {
      if (++calls === 2) throw new Error('no results page after 98s.')
      return page([NVIDIA])
    })
    expect(calls).toBe(2)
    expect(result.answered).toBe(1)
    expect(result.jobs).toHaveLength(1)
    expect(result.notes).toEqual(['Indeed "b": no results page after 98s.'])
  })
})
