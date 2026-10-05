import { describe, expect, it } from 'vitest'
import { normalizeUrl } from './normalizeUrl'

describe('normalizeUrl', () => {
  it('collapses tracking tails so one posting is one row', () => {
    expect(
      normalizeUrl('https://www.linkedin.com/jobs/view/swe-4453?position=1&pageNum=0&refId=abc&trackingId=xyz'),
    ).toBe('https://www.linkedin.com/jobs/view/swe-4453')
    expect(normalizeUrl('https://x.com/careers?utm_source=li&utm_campaign=q3')).toBe('https://x.com/careers')
  })

  it('keeps the params that ARE the job id', () => {
    expect(normalizeUrl('https://www.indeed.com/viewjob?jk=a483009f3bfac904')).toBe(
      'https://www.indeed.com/viewjob?jk=a483009f3bfac904',
    )
    expect(normalizeUrl('https://www.indeed.com/viewjob?utm_source=x&jk=a483009f3bfac904')).toBe(
      'https://www.indeed.com/viewjob?jk=a483009f3bfac904',
    )
  })

  it('canonicalizes case, hash, trailing slash, and param order', () => {
    expect(normalizeUrl('https://WWW.LinkedIn.com/jobs/view/swe-4453/')).toBe(
      'https://www.linkedin.com/jobs/view/swe-4453',
    )
    expect(normalizeUrl('https://a.com/j?b=2&a=1#app')).toBe(normalizeUrl('https://a.com/j?a=1&b=2'))
  })

  it('leaves non-URLs alone', () => {
    expect(normalizeUrl('')).toBe('')
    expect(normalizeUrl('  not a url ')).toBe('not a url')
  })
})
