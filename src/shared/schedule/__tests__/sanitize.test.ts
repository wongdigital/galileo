import { describe, expect, it } from 'vitest'
import type { ScheduleEvent } from '../types'
import { deriveConLastDay, sanitizeEvent, sanitizeEvents } from '../sanitize'

const CON_LAST_DAY = '2026-07-26'

function event(partial: Partial<ScheduleEvent>): ScheduleEvent {
  return {
    uid: 'u',
    shortId: null,
    title: 't',
    start: '2026-07-23T10:00:00-07:00',
    end: '2026-07-23T11:00:00-07:00',
    track: '1: PROGRAMS',
    subtypes: [],
    flags: [],
    room: 'Room 5',
    location: 'Room 5',
    description: '',
    url: null,
    ...partial,
  }
}

describe('deriveConLastDay', () => {
  it('takes the last day the schedule actually starts events on', () => {
    expect(
      deriveConLastDay([
        '2026-07-22T18:00:00-07:00',
        '2026-07-24T10:00:00-07:00',
        '2026-07-26T16:00:00-07:00',
      ]),
    ).toBe('2026-07-26')
  })

  it('ignores a lone far-future DTSTART outlier', () => {
    // DTSTARTs are trustworthy in bulk but not individually; one bad row must
    // not stretch the con window by two years and disable every clamp.
    const starts = Array.from({ length: 400 }, () => '2026-07-24T10:00:00-07:00')
    starts.push('2028-07-26T10:00:00-07:00')
    expect(deriveConLastDay(starts)).toBe('2026-07-24')
  })

  it('returns null when nothing parses', () => {
    expect(deriveConLastDay([])).toBeNull()
    expect(deriveConLastDay([null, null])).toBeNull()
  })
})

describe('sanitizeEvent', () => {
  const opts = { conLastDay: CON_LAST_DAY }

  it('leaves a normal panel untouched', () => {
    const ev = event({})
    const out = sanitizeEvent(ev, opts)
    expect(out.end).toBe('2026-07-23T11:00:00-07:00')
    expect(out.sanitized).toBeUndefined()
  })

  it('leaves a midnight-crossing event untouched and keeps both local dates', () => {
    const out = sanitizeEvent(
      event({ start: '2026-07-23T21:30:00-07:00', end: '2026-07-24T00:30:00-07:00', track: '8: FILMS' }),
      opts,
    )
    expect(out.sanitized).toBeUndefined()
    expect(out.start?.slice(0, 10)).toBe('2026-07-23')
    expect(out.end?.slice(0, 10)).toBe('2026-07-24')
  })

  it('clamps a DTEND two years out to the same local day, not to con end plus a day', () => {
    // The live "Dice Throne" shape. Clamping to con-end+1day would render it as
    // a multi-day banner; the same-local-day clamp keeps it a single-day block.
    const out = sanitizeEvent(
      event({ start: '2026-07-26T10:00:00-07:00', end: '2028-07-26T18:00:00-07:00', track: '6: GAMES' }),
      opts,
    )
    expect(out.end).toBe('2026-07-26T22:00:00-07:00')
    expect(out.sanitized).toEqual({
      field: 'end',
      reason: 'beyond-con-end',
      original: '2028-07-26T18:00:00-07:00',
    })
  })

  it('clamps an end that spills past the last con day even by a few hours', () => {
    const out = sanitizeEvent(
      event({ start: '2026-07-26T10:00:00-07:00', end: '2026-07-27T22:00:00-07:00', track: '6: GAMES' }),
      opts,
    )
    expect(out.end).toBe('2026-07-26T22:00:00-07:00')
    expect(out.sanitized?.reason).toBe('beyond-con-end')
  })

  it('clamps to end-of-day when DTSTART plus twelve hours would cross midnight', () => {
    const out = sanitizeEvent(
      event({ start: '2026-07-26T20:00:00-07:00', end: '2026-07-29T18:00:00-07:00', track: '6: GAMES' }),
      opts,
    )
    expect(out.end).toBe('2026-07-26T23:59:59-07:00')
  })

  it('clamps a >12h non-ambient event even though it ends inside the con', () => {
    const out = sanitizeEvent(
      event({ start: '2026-07-23T08:00:00-07:00', end: '2026-07-23T23:00:00-07:00', track: '1: PROGRAMS' }),
      opts,
    )
    expect(out.end).toBe('2026-07-23T20:00:00-07:00')
    expect(out.sanitized?.reason).toBe('duration-exceeds-cap')
  })

  it('allows a long ambient block that ends inside the con', () => {
    // 899 GAMES events run 4h+; a 13h drop-in hall is real, not a data error.
    const out = sanitizeEvent(
      event({ start: '2026-07-23T10:00:00-07:00', end: '2026-07-23T23:00:00-07:00', track: '6: GAMES' }),
      opts,
    )
    expect(out.sanitized).toBeUndefined()
  })

  it('allows a genuinely multi-day ambient block inside the con window', () => {
    const out = sanitizeEvent(
      event({ start: '2026-07-23T10:00:00-07:00', end: '2026-07-26T16:00:00-07:00', track: '6: GAMES' }),
      opts,
    )
    expect(out.sanitized).toBeUndefined()
  })

  it('clamps an end that precedes its own start', () => {
    const out = sanitizeEvent(
      event({ start: '2026-07-23T10:00:00-07:00', end: '2026-07-23T09:00:00-07:00' }),
      opts,
    )
    expect(out.end).toBe('2026-07-23T22:00:00-07:00')
    expect(out.sanitized?.reason).toBe('duration-exceeds-cap')
  })

  it('leaves events alone when start or end is missing', () => {
    expect(sanitizeEvent(event({ end: null }), opts).sanitized).toBeUndefined()
    expect(sanitizeEvent(event({ start: null }), opts).sanitized).toBeUndefined()
  })

  it('is a no-op when the con window is unknown', () => {
    const ev = event({ start: '2026-07-26T10:00:00-07:00', end: '2028-07-26T18:00:00-07:00' })
    expect(sanitizeEvent(ev, { conLastDay: null }).sanitized).toBeUndefined()
  })
})

describe('sanitizeEvents', () => {
  it('derives the con window from the batch when none is supplied', () => {
    const out = sanitizeEvents([
      event({ uid: 'a', start: '2026-07-26T10:00:00-07:00', end: '2028-07-26T18:00:00-07:00' }),
      event({ uid: 'b' }),
    ])
    expect(out[0]?.sanitized?.reason).toBe('beyond-con-end')
    expect(out[1]?.sanitized).toBeUndefined()
  })
})
