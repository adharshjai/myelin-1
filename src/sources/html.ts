const NAMED: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }

/** Each character reference decoded exactly once, so "&amp;lt;" reads as the
 *  text "&lt;" and not as a bracket. */
function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|nbsp|lt|gt|quot|apos|amp);/gi, (whole, ref: string) => {
    if (ref[0] !== '#') return NAMED[ref.toLowerCase()]
    const code = /^#x/i.test(ref) ? parseInt(ref.slice(2), 16) : Number(ref.slice(1))
    // A number that is no character stays as the text it came as.
    const isCharacter = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
    return isCharacter ? String.fromCodePoint(code) : whole
  })
}

/** Whitespace collapsed, for text that is already plain. */
export function plainText(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Markup to plain text: tags out, entities decoded, whitespace collapsed. */
export function stripHtml(s: string): string {
  return plainText(decodeEntities(s.replace(/<[^>]+>/g, ' ')))
}
