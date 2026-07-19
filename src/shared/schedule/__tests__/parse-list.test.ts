import { describe, expect, it } from 'vitest'
import { decodeEntities, parseListDescriptions } from '../parse-list'
import { LIST_HTML, LIST_HTML_EMPTY, UID_FARFUTURE, UID_GAME, UID_PANEL } from './fixtures'

describe('decodeEntities', () => {
  it('decodes the entity set Sched actually emits', () => {
    expect(decodeEntities('Sci-Fi &amp; Fantasy')).toBe('Sci-Fi & Fantasy')
    expect(decodeEntities('&lt;tag&gt; &quot;quoted&quot; &#39;apos&#039; a&rarr;b&nbsp;c')).toBe(
      '<tag> "quoted" \'apos\' a→b c',
    )
  })

  it('leaves unknown entities alone rather than mangling them', () => {
    expect(decodeEntities('100&deg; &amp; rising')).toBe('100&deg; & rising')
  })
})

describe('parseListDescriptions', () => {
  const byUid = parseListDescriptions(LIST_HTML)

  it('maps every event UID to its short id and subtypes', () => {
    expect(byUid.size).toBe(4)
    expect(byUid.get(UID_PANEL)).toEqual({ shortId: 'AAAAA', subtypes: ['Comics', 'Sci-Fi & Fantasy'] })
    expect(byUid.get(UID_GAME)).toEqual({ shortId: 'BBBBB', subtypes: ['Tabletop Games'] })
    expect(byUid.get(UID_FARFUTURE)?.shortId).toBe('DDDDD')
  })

  it('excludes the bare track link, which carries no subtype segment', () => {
    expect(byUid.get(UID_PANEL)?.subtypes).not.toContain('1: PROGRAMS')
  })

  it('keeps the first listing when a multi-day event repeats', () => {
    const repeated = `${LIST_HTML}
      <a href="event/ZZZZZ/drawing-robots-for-fun" id="${UID_PANEL}" class="name">Drawing Robots</a>
      <div class="sched-event-type"><a href="/type/1%3A+PROGRAMS/Later">Later</a></div>`
    expect(parseListDescriptions(repeated).get(UID_PANEL)?.shortId).toBe('AAAAA')
  })

  it('dedupes a tag list Sched rendered twice in one type block', () => {
    // Real feed behaviour: some events repeat the entire tag sequence inside
    // one sched-event-type div. One tag, one fact.
    const html = `<a href="event/DDDDD/x" id="${'4'.repeat(32)}" class="name">x</a>
      <div class="sched-event-type">
        <a href="/type/1%3A+PROGRAMS/Comics">Comics</a>
        <a href="/type/1%3A+PROGRAMS/Fandom">Fandom</a>
        <a href="/type/1%3A+PROGRAMS/Comics">Comics</a>
        <a href="/type/1%3A+PROGRAMS/Fandom">Fandom</a>
      </div>`
    expect(parseListDescriptions(html).get('4'.repeat(32))?.subtypes).toEqual(['Comics', 'Fandom'])
  })

  it('returns an empty map for a page with no event anchors', () => {
    expect(parseListDescriptions(LIST_HTML_EMPTY).size).toBe(0)
    expect(parseListDescriptions('').size).toBe(0)
  })

  it('survives a malformed percent-escape instead of throwing', () => {
    // decodeURIComponent throws on a lone `%`; a Sched typo must not take the
    // whole fetch down, so the raw segment is kept.
    const html = `<a href="event/EEEEE/x" id="${'5'.repeat(32)}" class="name">x</a>
      <div class="sched-event-type"><a href="/type/T/100%+Cotton">x</a></div>`
    expect(parseListDescriptions(html).get('5'.repeat(32))?.subtypes).toEqual(['100% Cotton'])
  })

  it('skips anchors whose id is not a 32-hex UID', () => {
    const html = '<a href="event/FFFFF/x" id="not-a-uid" class="name">x</a>'
    expect(parseListDescriptions(html).size).toBe(0)
  })
})
