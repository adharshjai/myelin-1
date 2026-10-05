import type { NewJob } from '../types'

export interface SourceResult {
  jobs: NewJob[]
  /** Failures only; counts go into the run's one summary line. */
  notes: string[]
  /** How many queries got a response, which tells a quiet day from being offline. */
  answered: number
}

/**
 * One source's part of a run: its queries in turn, small on purpose. The
 * first failure ends it: a rate limit or a verification page means stop
 * asking, not hammer on.
 */
export async function collect(
  label: string,
  queries: string[],
  fetchQuery: (query: string) => Promise<NewJob[]>,
): Promise<SourceResult> {
  const notes: string[] = []
  const all: NewJob[] = []
  let answered = 0
  for (const q of queries) {
    try {
      all.push(...(await fetchQuery(q)))
      answered++
    } catch (err) {
      notes.push(`${label} "${q}": ${err instanceof Error ? err.message : String(err)}`)
      break
    }
  }
  // The same posting often answers two queries; externalId settles it.
  const seen = new Set<string>()
  const jobs = all.filter((j) => {
    const key = j.externalId ?? j.url
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { jobs, notes, answered }
}
