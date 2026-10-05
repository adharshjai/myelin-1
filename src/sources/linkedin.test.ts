import { describe, expect, it } from 'vitest'
import { parseLinkedInCards } from './linkedin'

/** Trimmed from a real guest-search response (2026-08-13). */
const FIXTURE = `
<ul>
<li>
  <div class="base-card relative base-search-card base-search-card--link job-search-card" data-entity-urn="urn:li:jobPosting:4453694757" data-column="1" data-row="1">
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/back-end-developer-at-alexander-chapman-4453694757?position=1&amp;pageNum=0&amp;refId=abc" data-tracking-will-navigate>
      <span class="sr-only">Back End Developer</span>
    </a>
    <div class="base-search-card__info pt-3 pb-2 pl-2 pr-3">
      <h3 class="base-search-card__title">
        Back End Developer
      </h3>
      <h4 class="base-search-card__subtitle">
        <a class="hidden-nested-link" href="https://uk.linkedin.com/company/alexander-chapman">
          Alexander Chapman
        </a>
      </h4>
      <div class="base-search-card__metadata">
        <span class="job-search-card__location">
          New York, NY
        </span>
        <time class="job-search-card__listdate--new" datetime="2026-08-13">10 hours ago</time>
      </div>
    </div>
  </div>
</li>
<li>
  <div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:4453700001">
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/software-engineer-intern-at-acme-robotics-4453700001?position=2">
      <span class="sr-only">Software Engineer Intern &amp; Co-op</span>
    </a>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">Software Engineer Intern &amp; Co-op</h3>
      <h4 class="base-search-card__subtitle">
        <a class="hidden-nested-link" href="https://www.linkedin.com/company/acme">Acme Robotics</a>
      </h4>
      <div class="base-search-card__metadata">
        <span class="job-search-card__location">Austin, TX</span>
        <time datetime="2026-08-12">1 day ago</time>
      </div>
    </div>
  </div>
</li>
<li>
  <div class="base-card">broken card with none of the fields</div>
</li>
</ul>`

describe('parseLinkedInCards', () => {
  const jobs = parseLinkedInCards(FIXTURE)

  it('extracts every complete card and skips the broken one', () => {
    expect(jobs).toHaveLength(2)
  })

  it('reads the fields exactly as posted', () => {
    expect(jobs[0]).toMatchObject({
      source: 'linkedin',
      externalId: '4453694757',
      company: 'Alexander Chapman',
      title: 'Back End Developer',
      location: 'New York, NY',
      postedAt: '2026-08-13',
    })
    // Query params stripped: the record links the posting, not the tracker.
    expect(jobs[0].url).toBe(
      'https://www.linkedin.com/jobs/view/back-end-developer-at-alexander-chapman-4453694757',
    )
  })

  it('decodes entities in titles', () => {
    expect(jobs[1].title).toBe('Software Engineer Intern & Co-op')
    expect(jobs[1].company).toBe('Acme Robotics')
  })

  it('returns nothing for an empty or unrecognized page', () => {
    expect(parseLinkedInCards('')).toHaveLength(0)
    expect(parseLinkedInCards('<html><body>rate limited</body></html>')).toHaveLength(0)
  })
})
