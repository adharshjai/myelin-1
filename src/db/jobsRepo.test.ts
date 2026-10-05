import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, useDb } from './index'
import { jobsRepo, makeDedupeKey } from './jobsRepo'
import type { NewJob } from '../types'

const linkedIn = (over: Partial<NewJob> = {}): NewJob => ({
  source: 'linkedin',
  externalId: '4453700001',
  company: 'Acme Robotics',
  title: 'Software Engineer Intern',
  location: 'Austin, TX',
  url: 'https://www.linkedin.com/jobs/view/software-engineer-intern-at-acme-robotics-4453700001',
  postedAt: '2026-10-04',
  ...over,
})

const indeed = (over: Partial<NewJob> = {}): NewJob => ({
  source: 'indeed',
  externalId: 'af36bb06f876162f',
  company: 'Acme Robotics',
  title: 'Software Engineer Intern',
  location: 'Austin, TX',
  url: 'https://www.indeed.com/viewjob?jk=af36bb06f876162f',
  descriptionText: 'Build robots.',
  postedAt: '2026-10-05',
  ...over,
})

beforeEach(() => useDb(':memory:'))
afterAll(closeDb)

describe('makeDedupeKey', () => {
  it('ignores case, punctuation, and company suffix words', () => {
    expect(makeDedupeKey('Google LLC', 'Software Engineer, Intern', 'Austin, TX')).toBe(
      makeDedupeKey('google', 'software engineer intern', 'austin tx'),
    )
    expect(makeDedupeKey('DRW ', 'Intern', '')).toBe(makeDedupeKey('DRW', 'Intern', ''))
  })

  it('takes suffix words off the end of a company name only', () => {
    expect(makeDedupeKey('Micron Technology, Inc.', 'Intern', '')).toBe(makeDedupeKey('Micron', 'Intern', ''))
    expect(makeDedupeKey('The Trade Desk', 'Intern', '')).toBe(makeDedupeKey('Trade Desk', 'Intern', ''))
    expect(makeDedupeKey('Group One Trading', 'Intern', '')).not.toBe(makeDedupeKey('One Trading', 'Intern', ''))
    expect(makeDedupeKey('Labs', 'Intern', '')).not.toBe(makeDedupeKey('Company', 'Intern', ''))
    expect(makeDedupeKey('The Group', 'Intern', '').startsWith('|')).toBe(false)
  })

  it('tells C++ from C#', () => {
    expect(makeDedupeKey('Acme', 'C++ Developer Intern', '')).not.toBe(makeDedupeKey('Acme', 'C# Developer Intern', ''))
  })

  it('tells apart titles written in other scripts', () => {
    expect(makeDedupeKey('Acme', 'ソフトウェアエンジニア', 'Tokyo')).not.toBe(makeDedupeKey('Acme', 'ハードウェアエンジニア', 'Tokyo'))
  })
})

describe('jobsRepo.upsert', () => {
  it('inserts a new posting and stores it as given', () => {
    const { job, inserted } = jobsRepo.upsert(indeed())
    expect(inserted).toBe(true)
    expect(job).toMatchObject({
      source: 'indeed',
      externalId: 'af36bb06f876162f',
      company: 'Acme Robotics',
      title: 'Software Engineer Intern',
      location: 'Austin, TX',
      url: 'https://www.indeed.com/viewjob?jk=af36bb06f876162f',
      descriptionText: 'Build robots.',
      postedAt: '2026-10-05',
    })
    expect(jobsRepo.get(job.id)).toEqual(job)
  })

  it('reports a posting as new only the first time it is seen', () => {
    expect(jobsRepo.upsert(linkedIn()).inserted).toBe(true)
    expect(jobsRepo.upsert(linkedIn()).inserted).toBe(false)
    expect(jobsRepo.count()).toBe(1)
  })

  it('knows a posting by its source id even when its title and link changed', () => {
    const first = jobsRepo.upsert(linkedIn()).job
    const again = jobsRepo.upsert(
      linkedIn({
        title: 'Software Engineer Intern (Summer 2027)',
        url: 'https://www.linkedin.com/jobs/view/software-engineer-intern-summer-2027-at-acme-robotics-4453700001',
      }),
    )
    expect(again.inserted).toBe(false)
    expect(again.job.id).toBe(first.id)
  })

  it('does not confuse the same id from two sources', () => {
    jobsRepo.upsert(linkedIn({ externalId: '123' }))
    const other = jobsRepo.upsert(indeed({ externalId: '123', title: 'Hardware Engineer Intern' }))
    expect(other.inserted).toBe(true)
  })

  it('knows a posting by its URL whatever tracking tail it carries', () => {
    jobsRepo.upsert(linkedIn({ externalId: undefined }))
    const again = jobsRepo.upsert(
      linkedIn({
        externalId: undefined,
        title: 'SWE Intern',
        url: 'https://www.linkedin.com/jobs/view/software-engineer-intern-at-acme-robotics-4453700001?position=2&refId=abc',
      }),
    )
    expect(again.inserted).toBe(false)
  })

  it('keeps one row for a posting listed on both sites', () => {
    const first = jobsRepo.upsert(linkedIn()).job
    const second = jobsRepo.upsert(indeed({ company: 'Acme Robotics, Inc.' }))
    expect(second.inserted).toBe(false)
    expect(second.job.id).toBe(first.id)
    expect(second.job.source).toBe('linkedin')
  })

  it('keeps postings apart when the role or the place differs', () => {
    jobsRepo.upsert(linkedIn())
    expect(jobsRepo.upsert(indeed({ title: 'Hardware Engineer Intern' })).inserted).toBe(true)
    expect(jobsRepo.upsert(indeed({ externalId: 'b', url: 'https://www.indeed.com/viewjob?jk=b', location: 'Boston, MA' })).inserted).toBe(true)
  })

  it('fills in a posting date a later sighting knows, and never overwrites one', () => {
    const undated = jobsRepo.upsert(linkedIn({ postedAt: null })).job
    expect(undated.postedAt).toBeNull()
    expect(jobsRepo.upsert(linkedIn({ postedAt: '2026-10-04T09:30:00Z' })).job.postedAt).toBe('2026-10-04')
    expect(jobsRepo.upsert(linkedIn({ postedAt: '2026-10-01' })).job.postedAt).toBe('2026-10-04')
  })

  it('trims the fields it stores', () => {
    const { job } = jobsRepo.upsert(linkedIn({ company: '  Acme Robotics ', title: ' Software Engineer Intern  ' }))
    expect(job.company).toBe('Acme Robotics')
    expect(job.title).toBe('Software Engineer Intern')
  })
})

describe('jobsRepo.unreported', () => {
  it('holds a posting until it is marked reported, and only then lets it go', () => {
    const a = jobsRepo.upsert(linkedIn()).job
    const b = jobsRepo.upsert(indeed({ title: 'Hardware Engineer Intern' })).job
    expect(jobsRepo.unreported().map((j) => j.id)).toEqual([a.id, b.id])
    jobsRepo.markReported([a])
    expect(jobsRepo.unreported().map((j) => j.id)).toEqual([b.id])
    // Seeing it again does not make it new again.
    jobsRepo.upsert(linkedIn())
    expect(jobsRepo.unreported().map((j) => j.id)).toEqual([b.id])
    jobsRepo.markReported([a, b])
    expect(jobsRepo.unreported()).toEqual([])
  })
})

describe('jobsRepo.list', () => {
  beforeEach(() => {
    jobsRepo.upsert(linkedIn({ postedAt: '2026-10-03' }))
    jobsRepo.upsert(indeed({ title: 'Hardware Engineer Intern', postedAt: '2026-10-05' }))
    jobsRepo.upsert(linkedIn({ externalId: '9', title: 'Firmware Intern', url: 'https://www.linkedin.com/jobs/view/firmware-intern-9', postedAt: '2026-10-04' }))
  })

  it('lists the newest posting first', () => {
    expect(jobsRepo.list().map((j) => j.title)).toEqual([
      'Hardware Engineer Intern',
      'Firmware Intern',
      'Software Engineer Intern',
    ])
  })

  it('filters by source', () => {
    expect(jobsRepo.list({ source: 'indeed' }).map((j) => j.title)).toEqual(['Hardware Engineer Intern'])
    expect(jobsRepo.list({ source: 'linkedin' })).toHaveLength(2)
  })

  it('filters by when a posting was found', () => {
    getDb().prepare(`UPDATE jobs SET discovered_at = datetime('now', '-10 days') WHERE title = 'Firmware Intern'`).run()
    expect(jobsRepo.list({ days: 7 }).map((j) => j.title)).toEqual(['Hardware Engineer Intern', 'Software Engineer Intern'])
    expect(jobsRepo.list({ days: 30 })).toHaveLength(3)
  })

  it('treats a window wider than the calendar as no window', () => {
    expect(jobsRepo.list({ days: 99999999 })).toHaveLength(3)
    expect(jobsRepo.list({ days: Infinity })).toHaveLength(3)
  })
})
