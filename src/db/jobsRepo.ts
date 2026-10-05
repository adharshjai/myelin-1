import { getDb } from './index'
import { normalizeUrl } from './normalizeUrl'
import type { Job, JobSource, NewJob } from '../types'

type Row = Record<string, unknown>

function rowToJob(r: Row): Job {
  return {
    id: r.id as number,
    source: r.source as JobSource,
    externalId: r.external_id as string,
    company: r.company as string,
    title: r.title as string,
    location: r.location as string,
    url: r.url as string,
    descriptionText: r.description_text as string,
    postedAt: r.posted_at as string | null,
    discoveredAt: r.discovered_at as string,
    dedupeKey: r.dedupe_key as string,
  }
}

/** Letters and digits only, plus the two symbols that tell "C++" from "C#". */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}+#]/gu, '')

const COMPANY_SUFFIX = /[\s,.]+(inc|llc|ltd|corp|corporation|co|company|technologies|technology|labs|group)\.?$/

/** "Google" and "Google LLC" are one employer, and so are "Micron" and
 *  "Micron Technology". Only trailing suffix words (and a leading "the")
 *  come off, so a name is never reduced to nothing or to another company's. */
function normCompany(company: string): string {
  let name = company.trim().toLowerCase().replace(/^the\s+/, '')
  for (;;) {
    const shorter = name.replace(COMPANY_SUFFIX, '')
    if (shorter === name) break
    name = shorter
  }
  return norm(name)
}

export function makeDedupeKey(company: string, title: string, location: string): string {
  return `${normCompany(company)}|${norm(title)}|${norm(location)}`
}

export const jobsRepo = {
  /** Newest posting first. `days` keeps only rows found that recently. */
  list(opts: { source?: JobSource; days?: number } = {}): Job[] {
    const rows = getDb()
      .prepare(
        // A window too wide for SQLite's calendar yields NULL: no cutoff at all.
        `SELECT * FROM jobs
         WHERE (@source IS NULL OR source = @source)
           AND (@since IS NULL OR discovered_at >= COALESCE(datetime('now', @since), ''))
         ORDER BY COALESCE(posted_at, date(discovered_at)) DESC, id DESC`,
      )
      .all({ source: opts.source ?? null, since: opts.days != null ? `-${opts.days} days` : null })
    return (rows as Row[]).map(rowToJob)
  },

  get(id: number): Job | null {
    const row = getDb().prepare(`SELECT * FROM jobs WHERE id=?`).get(id) as Row | undefined
    return row ? rowToJob(row) : null
  },

  count(): number {
    return (getDb().prepare(`SELECT COUNT(*) AS n FROM jobs`).get() as { n: number }).n
  },

  /**
   * Insert if new; returns the job either way plus whether it was inserted.
   * A posting is already known when its source reported the same id before,
   * when its URL is stored, or when its company, title and location match a
   * stored row, which is how one posting listed on both sites stays one row.
   */
  upsert(j: NewJob): { job: Job; inserted: boolean } {
    const db = getDb()
    // Canonical identity first: trimmed fields, tracker-free URL. Sources
    // decorate the same posting differently; the row must not care.
    j = {
      ...j,
      company: j.company.trim(),
      title: j.title.trim(),
      location: (j.location ?? '').trim(),
      url: normalizeUrl(j.url),
    }
    const dedupeKey = makeDedupeKey(j.company, j.title, j.location ?? '')
    const known = (
      j.externalId
        ? db.prepare(`SELECT * FROM jobs WHERE source=? AND external_id=?`).get(j.source, j.externalId)
        : undefined
    ) ?? (
      j.url ? db.prepare(`SELECT * FROM jobs WHERE url=?`).get(j.url) : undefined
    ) ?? db.prepare(`SELECT * FROM jobs WHERE dedupe_key=?`).get(dedupeKey)
    if (known) {
      const row = known as Row
      // A later sighting may carry the date the first one lacked.
      if (j.postedAt && !row.posted_at) {
        db.prepare(`UPDATE jobs SET posted_at=? WHERE id=?`).run(j.postedAt.slice(0, 10), row.id)
        return { job: this.get(row.id as number)!, inserted: false }
      }
      return { job: rowToJob(row), inserted: false }
    }
    const res = db
      .prepare(
        `INSERT INTO jobs (source, external_id, company, title, location, url, description_text, posted_at, dedupe_key)
         VALUES (@source, @externalId, @company, @title, @location, @url, @descriptionText, @postedAt, @dedupeKey)`,
      )
      .run({
        ...j,
        // Not spread defaults: a source may pass these as explicit undefined.
        externalId: j.externalId ?? '',
        descriptionText: j.descriptionText ?? '',
        postedAt: j.postedAt?.slice(0, 10) ?? null,
        dedupeKey,
      })
    return { job: this.get(res.lastInsertRowid as number)!, inserted: true }
  },

  /** Postings stored but never handed to a caller, oldest first. */
  unreported(): Job[] {
    return (getDb().prepare(`SELECT * FROM jobs WHERE reported_at IS NULL ORDER BY id`).all() as Row[]).map(rowToJob)
  },

  /** Record that these postings reached whoever asked for them. */
  markReported(jobs: Job[]): void {
    const db = getDb()
    const mark = db.prepare(`UPDATE jobs SET reported_at=datetime('now') WHERE id=? AND reported_at IS NULL`)
    db.transaction(() => {
      for (const j of jobs) mark.run(j.id)
    })()
  },
}
