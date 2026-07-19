import { describe, expect, it } from 'vitest'
import { parseCategories, parseIcs, toLocalIso, unfold } from '../parse-ics'
import { ICS, UID_FARFUTURE, UID_LATE, UID_PANEL } from './fixtures'

describe('unfold', () => {
  it('joins RFC 5545 continuation lines without eating content whitespace', () => {
    // The fold consumes the newline plus exactly one leading space; a second
    // space is real content, which is how "a second" survives the round trip.
    expect(unfold('DESC:one\r\n  two')).toBe('DESC:one two')
    expect(unfold('DESC:one\r\n\ttwo')).toBe('DESC:onetwo')
  })
})

describe('parseIcs', () => {
  const events = parseIcs(ICS)

  it('splits every VEVENT block', () => {
    expect(events.map((e) => e.UID)).toEqual([UID_PANEL, expect.any(String), UID_LATE, UID_FARFUTURE])
    expect(events).toHaveLength(4)
  })

  it('strips parameters from property names', () => {
    const withParam = parseIcs('BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20260723T100000\r\nEND:VEVENT')
    expect(withParam[0]?.DTSTART).toBe('20260723T100000')
  })

  it('unescapes text values and unfolds descriptions', () => {
    expect(events[0]?.DESCRIPTION).toBe(
      'A folded description that continues onto a second physical line; with a semicolon.',
    )
    expect(events[0]?.LOCATION).toBe('Room 5 (Upper Level), 111 Harbor Dr, San Diego, CA 92101, USA')
  })

  it('unescapes a literal backslash without corrupting the sequence after it', () => {
    const raw = 'BEGIN:VEVENT\r\nSUMMARY:back\\\\slash\\nnewline\r\nEND:VEVENT'
    expect(parseIcs(raw)[0]?.SUMMARY).toBe('back\\slash\nnewline')
  })

  it('ignores lines with no colon rather than throwing', () => {
    expect(parseIcs('BEGIN:VEVENT\r\nGARBAGE\r\nUID:x\r\nEND:VEVENT')[0]).toEqual({ UID: 'x' })
  })
})

describe('toLocalIso', () => {
  it('converts a UTC stamp to Pacific with an explicit offset', () => {
    expect(toLocalIso('20260723T170000Z')).toBe('2026-07-23T10:00:00-07:00')
  })

  it('keeps the local date of an event that crosses midnight in UTC but not locally', () => {
    // 06:00Z on the 24th is still 23:00 on the 23rd in Pacific.
    expect(toLocalIso('20260724T060000Z')).toBe('2026-07-23T23:00:00-07:00')
  })

  it('uses standard time outside DST', () => {
    expect(toLocalIso('20261215T200000Z')).toBe('2026-12-15T12:00:00-08:00')
  })

  it('accepts a floating local stamp as already-local', () => {
    expect(toLocalIso('20260723T100000')).toBe('2026-07-23T10:00:00-07:00')
  })

  it('accepts a date-only value as local midnight', () => {
    expect(toLocalIso('20260723')).toBe('2026-07-23T00:00:00-07:00')
  })

  it('returns null for missing or unparseable values', () => {
    expect(toLocalIso(undefined)).toBeNull()
    expect(toLocalIso('not a date')).toBeNull()
  })
})

describe('parseCategories', () => {
  it('separates the track from Sched change flags', () => {
    expect(parseCategories('U: UPDATED,1: PROGRAMS')).toEqual({ track: '1: PROGRAMS', flags: ['UPDATED'] })
    expect(parseCategories('N: NEW,8: FILMS')).toEqual({ track: '8: FILMS', flags: ['NEW'] })
    expect(parseCategories('X: CANCELLED,6: GAMES')).toEqual({ track: '6: GAMES', flags: ['CANCELLED'] })
  })

  it('handles a track with no flags and flags with no track', () => {
    expect(parseCategories('6: GAMES')).toEqual({ track: '6: GAMES', flags: [] })
    expect(parseCategories('U: UPDATED')).toEqual({ track: null, flags: ['UPDATED'] })
  })

  it('returns an empty result for missing categories', () => {
    expect(parseCategories(undefined)).toEqual({ track: null, flags: [] })
    expect(parseCategories('')).toEqual({ track: null, flags: [] })
  })

  it('does not treat a track that merely looks flag-shaped as a flag', () => {
    expect(parseCategories('U: UPDATES,1: PROGRAMS')).toEqual({ track: '1: PROGRAMS', flags: [] })
  })
})
