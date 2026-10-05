import { describe, expect, it } from 'vitest'
import { plainText, stripHtml } from './html'

describe('stripHtml', () => {
  it('drops tags and collapses whitespace', () => {
    expect(stripHtml('<ul>\n <li>Designs <b>software</b></li>\n <li>Ships it</li>\n</ul>')).toBe('Designs software Ships it')
  })

  it('decodes named, decimal, and hex references', () => {
    expect(stripHtml('R&amp;D &lt;Intern&gt; &quot;Summer&quot;&nbsp;2027')).toBe('R&D <Intern> "Summer" 2027')
    expect(stripHtml('Engineer&#39;s Co-op &#x2013; Fall')).toBe("Engineer's Co-op \u2013 Fall")
  })

  it('decodes each reference once, however the ampersand was written', () => {
    expect(stripHtml('&amp;lt;')).toBe('&lt;')
    expect(stripHtml('&#38;lt;')).toBe('&lt;')
    expect(stripHtml('&#x26;amp;')).toBe('&amp;')
  })

  it('leaves a number that is no character as the text it came as', () => {
    expect(stripHtml('Intern &#99999999;')).toBe('Intern &#99999999;')
    expect(stripHtml('Intern &#x110000;')).toBe('Intern &#x110000;')
    expect(stripHtml('Intern &#0; &#xD800;')).toBe('Intern &#0; &#xD800;')
    expect(stripHtml(`Intern &#${'9'.repeat(400)};`)).toBe(`Intern &#${'9'.repeat(400)};`)
  })
})

describe('plainText', () => {
  it('only tidies whitespace', () => {
    expect(plainText('  Engineer <C++>  &amp;\n Intern ')).toBe('Engineer <C++> &amp; Intern')
  })
})
