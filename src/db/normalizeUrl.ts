/** Tracker params that make one posting look like many. Params that ARE the
 *  job id (Indeed's jk) are not trackers and must survive. */
const TRACKER_PARAMS = /^(utm_\w+|ref|refid|referral|trackingid|tracking|position|pagenum|src|source|eid|mc_\w+)$/i

/** One canonical form per posting URL, so the same job found twice (or with
 *  two tracking tails) collapses to one row. */
export function normalizeUrl(raw: string): string {
  if (!/^https?:/i.test(raw)) return raw.trim()
  try {
    const u = new URL(raw)
    u.hostname = u.hostname.toLowerCase()
    u.hash = ''
    const kept: [string, string][] = []
    u.searchParams.forEach((value, key) => {
      if (!TRACKER_PARAMS.test(key)) kept.push([key, value])
    })
    kept.sort(([a], [b]) => a.localeCompare(b))
    u.search = kept.length ? `?${kept.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : ''
    let out = u.toString()
    if (out.endsWith('/')) out = out.slice(0, -1)
    return out
  } catch {
    return raw.trim()
  }
}
