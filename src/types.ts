export type JobSource = 'linkedin' | 'indeed'

/** A posting as a source reports it, before the store has given it a row. */
export interface NewJob {
  source: JobSource
  /** The source's own id for the posting. */
  externalId?: string
  company: string
  title: string
  location?: string
  /** The posting's page on the source, free of tracking params. */
  url: string
  /** Whatever text the result card carries: Indeed's snippet, nothing for LinkedIn. */
  descriptionText?: string
  postedAt?: string | null
}

export interface Job {
  id: number
  source: JobSource
  externalId: string
  company: string
  title: string
  location: string
  url: string
  descriptionText: string
  /** ISO date (YYYY-MM-DD), or null when the source did not date the posting. */
  postedAt: string | null
  discoveredAt: string
  /** Normalised company|title|location key used for de-duplication. */
  dedupeKey: string
}
