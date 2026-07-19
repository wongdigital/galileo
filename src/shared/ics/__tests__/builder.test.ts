import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildIcs, icsUid, localDay } from '../builder'
import { PACIFIC_TZID, wallClock } from '../pacific'
import { event, saturdaySessions } from './fixtures'

/** VEVENT blocks, unfolded — ical-generator wraps lines at 75 octets. */
function vevents(ics: string): string[] {
  const unfolded = ics.replace(/\r\n /g, '')
  return unfolded.split('BEGIN:VEVENT').slice(1).map((block) => block.split('END:VEVENT')[0] as string)
}

describe('wallClock', () => {
  it('reports the Pacific wall clock sitting in the ISO string, not the machine clock', () => {
    const value = wallClock('2026-07-25T10:00:00-07:00')
    expect(value?.toFormat('yyyyLLdd')).toBe('20260725')
    expect(value?.toFormat('HHmmss')).toBe('100000')
  })

  it('returns null for an unparseable timestamp rather than a wrong one', () => {
    expect(wallClock('sometime saturday')).toBeNull()
  })

  it('throws if ical-generator asks for a format we have not accounted for', () => {
    expect(() => wallClock('2026-07-25T10:00:00-07:00')?.toFormat('yyyy')).toThrow()
  })
})

describe('localDay', () => {
  it('reads the local date off the offset-carrying string', () => {
    expect(localDay('2026-07-25T23:30:00-07:00')).toBe('2026-07-25')
    // Late-night event: local date stays Saturday even though it is Sunday UTC.
    expect(new Date('2026-07-25T23:30:00-07:00').toISOString().slice(0, 10)).toBe('2026-07-26')
  })
})

describe('buildIcs', () => {
  it('exports 6 starred Saturday sessions with Pacific TZID and a 15-minute alarm each', () => {
    const result = buildIcs(saturdaySessions(), { stamp: new Date('2026-07-20T00:00:00Z') })

    expect(result.exported).toBe(6)
    expect(result.excluded).toEqual([])

    const blocks = vevents(result.ics)
    expect(blocks).toHaveLength(6)
    for (const block of blocks) {
      expect(block).toContain(`DTSTART;TZID=${PACIFIC_TZID}:`)
      expect(block).toContain(`DTEND;TZID=${PACIFIC_TZID}:`)
      expect(block).toContain('TRIGGER:-PT15M')
    }
  })

  it('writes the wall clock from the event, not the host timezone', () => {
    // The failure this guards: ical-generator formats plain strings with
    // system-local getters, so on a New York machine a 10am panel exported as
    // 13:00 under a Los_Angeles TZID.
    const original = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      const result = buildIcs([event('a'.repeat(32), { start: '2026-07-25T10:00:00-07:00', end: '2026-07-25T10:50:00-07:00' })])
      expect(result.ics).toContain(`DTSTART;TZID=${PACIFIC_TZID}:20260725T100000`)
      expect(result.ics).toContain(`DTEND;TZID=${PACIFIC_TZID}:20260725T105000`)
    } finally {
      process.env.TZ = original
    }
  })

  it('exports an ambient 6h games block without an alarm', () => {
    const block = event('b'.repeat(32), {
      title: 'Open Table: Cavern Crawl',
      track: '6: GAMES',
      start: '2026-07-25T10:00:00-07:00',
      end: '2026-07-25T16:00:00-07:00'
    })
    const result = buildIcs([block])

    expect(result.exported).toBe(1)
    expect(result.ics).not.toContain('BEGIN:VALARM')
  })

  it('mixes alarmed and alarm-free events in one file by class', () => {
    const panel = event('c'.repeat(32))
    const block = event('d'.repeat(32), {
      track: '6: GAMES',
      start: '2026-07-25T10:00:00-07:00',
      end: '2026-07-25T16:00:00-07:00'
    })
    const blocks = vevents(buildIcs([panel, block]).ics)

    expect(blocks[0]).toContain('TRIGGER:-PT15M')
    expect(blocks[1]).not.toContain('BEGIN:VALARM')
  })

  it('excludes a cancelled starred event and says so', () => {
    const dead = event('e'.repeat(32), { title: 'Pulled Panel', flags: ['CANCELLED'] })
    const result = buildIcs([event('f'.repeat(32)), dead])

    expect(result.exported).toBe(1)
    expect(result.excluded).toEqual([
      { uid: 'e'.repeat(32), title: 'Pulled Panel', reason: 'cancelled' }
    ])
    expect(result.ics).not.toContain('Pulled Panel')
  })

  it('skips an event missing a start or an end rather than inventing a time', () => {
    const noStart = event('a'.repeat(32), { title: 'No Start', start: null })
    const noEnd = event('b'.repeat(32), { title: 'No End', end: null })
    const result = buildIcs([noStart, noEnd, event('c'.repeat(32))])

    expect(result.exported).toBe(1)
    expect(result.excluded.map((x) => x.reason)).toEqual(['missing-times', 'missing-times'])
  })

  it('exports a U3-clamped end as-is and reports the correction', () => {
    const clamped = event('a'.repeat(32), {
      start: '2026-07-25T10:00:00-07:00',
      end: '2026-07-25T22:00:00-07:00',
      sanitized: { field: 'end', reason: 'duration-exceeds-cap', original: '2028-07-25T10:00:00-07:00' }
    })
    const result = buildIcs([clamped])

    expect(result.exported).toBe(1)
    expect(result.sanitized).toEqual(['a'.repeat(32)])
    expect(result.ics).toContain(`DTEND;TZID=${PACIFIC_TZID}:20260725T220000`)
    expect(result.ics).not.toContain('2028')
  })

  it('exports one day when asked, excluding the rest of the con', () => {
    const saturday = event('a'.repeat(32), { start: '2026-07-25T10:00:00-07:00', end: '2026-07-25T10:50:00-07:00' })
    const sunday = event('b'.repeat(32), { title: 'Sunday Panel', start: '2026-07-26T10:00:00-07:00', end: '2026-07-26T10:50:00-07:00' })
    const result = buildIcs([saturday, sunday], { day: '2026-07-25' })

    expect(result.exported).toBe(1)
    expect(result.excluded).toEqual([
      { uid: 'b'.repeat(32), title: 'Sunday Panel', reason: 'other-day' }
    ])
  })

  it('exports the whole con when no day is given', () => {
    const saturday = event('a'.repeat(32), { start: '2026-07-25T10:00:00-07:00', end: '2026-07-25T10:50:00-07:00' })
    const sunday = event('b'.repeat(32), { start: '2026-07-26T10:00:00-07:00', end: '2026-07-26T10:50:00-07:00' })

    expect(buildIcs([saturday, sunday]).exported).toBe(2)
  })

  it('derives UIDs from the Sched UID so a re-import updates instead of duplicating', () => {
    const sessions = saturdaySessions()
    const stamp = new Date('2026-07-20T00:00:00Z')
    const first = buildIcs(sessions, { stamp })

    // Same stars, one of them moved to a new room and a later slot.
    const moved = { ...(sessions[0] as (typeof sessions)[number]), room: 'Room 6DE', start: '2026-07-25T14:00:00-07:00', end: '2026-07-25T14:50:00-07:00' }
    const second = buildIcs([moved, ...sessions.slice(1)], { stamp })

    const uidsOf = (ics: string): string[] => [...ics.matchAll(/^UID:(.+)$/gm)].map((m) => (m[1] as string).trim())
    expect(uidsOf(second.ics)).toEqual(uidsOf(first.ics))
    expect(uidsOf(first.ics)[0]).toBe(icsUid(sessions[0]!.uid))
    expect(second.ics).toContain('20260725T140000')
  })

  it('honours a non-default alarm lead time', () => {
    const result = buildIcs([event('a'.repeat(32))], { alarmMinutes: 30 })
    expect(result.ics).toContain('TRIGGER:-PT30M')
  })

  it('produces an empty but valid calendar when everything is excluded', () => {
    const result = buildIcs([event('a'.repeat(32), { flags: ['CANCELLED'] })])

    expect(result.exported).toBe(0)
    expect(result.ics).toContain('BEGIN:VCALENDAR')
    expect(result.ics).not.toContain('BEGIN:VEVENT')
  })

  it('carries the room and the session URL onto the calendar entry', () => {
    const panel = event('a'.repeat(32), {
      location: 'Room 5AB, 111 Harbor Dr, San Diego, CA 92101, USA',
      url: 'https://comiccon2026.sched.com/event/abcd'
    })
    const ics = buildIcs([panel]).ics.replace(/\r\n /g, '')

    expect(ics).toContain('LOCATION:Room 5AB')
    expect(ics).toContain('URL;VALUE=URI:https://comiccon2026.sched.com/event/abcd')
  })
})

describe('ICS envelope', () => {
  let ics: string
  beforeAll(() => {
    ics = buildIcs(saturdaySessions(), { calendarName: 'SDCC Stars' }).ics
  })
  afterAll(() => {
    ics = ''
  })

  it('is a PUBLISH calendar, so Apple Calendar imports rather than asking for an RSVP', () => {
    expect(ics).toContain('METHOD:PUBLISH')
  })

  it('names the calendar for the import dialog', () => {
    expect(ics).toContain('X-WR-CALNAME:SDCC Stars')
  })

  it('stamps in UTC — a floating DTSTAMP is not valid RFC 5545', () => {
    const stamped = buildIcs([event('a'.repeat(32))], { stamp: new Date('2026-07-20T18:30:00Z') })
    expect(stamped.ics).toContain('DTSTAMP:20260720T183000Z')
  })

  it('breaks every line with CRLF as RFC 5545 requires — a bare LF can break import', () => {
    // Counted rather than split: a bare LF anywhere is the failure, and the
    // unterminated final line must not be mistaken for one.
    const bareLineFeeds = [...ics].filter((char, i) => char === '\n' && ics[i - 1] !== '\r')
    expect(bareLineFeeds).toHaveLength(0)
    expect(ics.split('\r\n').length).toBeGreaterThan(1)
    expect(ics.endsWith('END:VCALENDAR')).toBe(true)
  })
})
