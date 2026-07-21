import { describe, expect, it } from 'vitest'
import {
  buildDayBuckets,
  buildDayRows,
  buildGhostRows,
  buildRow,
  dayLabel,
  durationLabel,
  formatTime,
  ghostsForDay,
  isLoud,
  resolveActiveDay,
  ALL_DAYS,
  rowStates,
  withDayHeaders,
} from '../derive'
import type { Change, ScheduleEvent } from '@shared/schedule'
import type { EventClassification } from '@shared/enrichment'
import type { StarRecord } from '@shared/stars'

function event(uid: string, partial: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    uid,
    shortId: null,
    title: `Event ${uid}`,
    start: '2026-07-25T10:00:00-07:00',
    end: '2026-07-25T10:50:00-07:00',
    track: '1: PROGRAMS',
    subtypes: [],
    flags: [],
    room: 'Room 5AB',
    location: 'Room 5AB',
    description: '',
    url: null,
    ...partial,
  }
}

function classification(
  uid: string,
  eventClass: 'attend' | 'ambient',
  durationMinutes: number | null = 50
): EventClassification {
  return { uid, eventClass, durationMinutes, reason: 'scheduled' }
}

const change = (uid: string, partial: Partial<Change> = {}): Change => ({
  uid,
  kind: 'moved-room',
  detectedAt: '2026-07-20T18:00:00.000Z',
  ...partial,
})

describe('wall-clock formatting', () => {
  it('reads the clock off the string rather than through Date', () => {
    // Whatever zone the laptop is in, a 10:00 Pacific panel reads 10:00a.
    expect(formatTime('2026-07-25T10:00:00-07:00')).toBe('10:00a')
    expect(formatTime('2026-07-25T15:30:00-07:00')).toBe('3:30p')
    expect(formatTime('2026-07-25T00:15:00-07:00')).toBe('12:15a')
    expect(formatTime('2026-07-25T12:05:00-07:00')).toBe('12:05p')
  })

  it('has a placeholder for a missing start rather than rendering "Invalid Date"', () => {
    expect(formatTime(null)).toBe('—')
    expect(formatTime('not a timestamp')).toBe('—')
  })

  it('labels a day without consulting the host timezone', () => {
    expect(dayLabel('2026-07-25')).toEqual({ weekday: 'Sat', date: 'Jul 25' })
    expect(dayLabel('2026-07-22')).toEqual({ weekday: 'Wed', date: 'Jul 22' })
  })

  it('formats durations compactly', () => {
    expect(durationLabel(50)).toBe('50m')
    expect(durationLabel(60)).toBe('1h')
    expect(durationLabel(360)).toBe('6h')
    expect(durationLabel(95)).toBe('1h 35m')
    expect(durationLabel(null)).toBe('')
  })
})

describe('rowStates', () => {
  it('reads Sched’s own flags', () => {
    expect(rowStates(event('a', { flags: ['NEW'] }))).toEqual(['new'])
    expect(rowStates(event('a', { flags: ['UPDATED'] }))).toEqual(['updated'])
  })

  it('reads moves out of the change log, which is the only place they exist', () => {
    expect(rowStates(event('a'), [change('a', { kind: 'moved-room' })])).toEqual(['moved'])
    expect(rowStates(event('a'), [change('a', { kind: 'moved-start' })])).toEqual(['moved'])
  })

  it('surfaces a move on an event Sched still calls unchanged', () => {
    // Sched leaves flags static while the room changes underneath them; the
    // snapshot diff is what catches it.
    const states = rowStates(event('a', { flags: [] }), [change('a', { kind: 'moved-room' })])
    expect(states).toEqual(['moved'])
  })

  it('lets cancelled subsume every other state', () => {
    const states = rowStates(event('a', { flags: ['UPDATED', 'CANCELLED'] }), [
      change('a', { kind: 'moved-start' }),
    ])
    expect(states).toEqual(['cancelled'])
  })

  it('reads a flag change to CANCELLED as cancelled, and anything else as updated', () => {
    expect(rowStates(event('a'), [change('a', { kind: 'flag-changed', to: 'CANCELLED' })])).toEqual([
      'cancelled',
    ])
    expect(rowStates(event('a'), [change('a', { kind: 'flag-changed', to: 'UPDATED' })])).toEqual([
      'updated',
    ])
  })

  it('orders several states so the most actionable reads first', () => {
    const states = rowStates(event('a', { flags: ['NEW', 'UPDATED'] }), [
      change('a', { kind: 'moved-room' }),
    ])
    expect(states).toEqual(['new', 'moved', 'updated'])
  })

  it('is quiet for an untouched event', () => {
    expect(rowStates(event('a'))).toEqual([])
  })
})

describe('isLoud', () => {
  it('fires only for a starred cancellation — a plan that stopped being a plan', () => {
    expect(isLoud(['cancelled'], true)).toBe(true)
    expect(isLoud(['cancelled'], false)).toBe(false)
    expect(isLoud(['moved'], true)).toBe(false)
  })
})

describe('buildDayRows', () => {
  const classes = new Map([
    ['panel', classification('panel', 'attend')],
    ['block', classification('block', 'ambient', 360)],
    ['early', classification('early', 'attend')],
  ])

  it('sends ambient events to the shelf and keeps attend events as rows', () => {
    const { rows, ambient } = buildDayRows({
      events: [event('panel'), event('block', { start: '2026-07-25T10:00:00-07:00' })],
      classes,
      changes: {},
      starredUids: new Set(),
    })
    expect(rows.map((r) => r.uid)).toEqual(['panel'])
    expect(ambient.map((r) => r.uid)).toEqual(['block'])
  })

  it('sorts by start, then room, so a refresh cannot reshuffle equal times', () => {
    const { rows } = buildDayRows({
      events: [
        event('panel', { start: '2026-07-25T10:00:00-07:00', room: 'Room 9' }),
        event('early', { start: '2026-07-25T09:00:00-07:00' }),
        event('tie', { start: '2026-07-25T10:00:00-07:00', room: 'Room 1' }),
      ],
      classes: new Map([...classes, ['tie', classification('tie', 'attend')]]),
      changes: {},
      starredUids: new Set(),
    })
    expect(rows.map((r) => r.uid)).toEqual(['early', 'tie', 'panel'])
  })

  it('carries star and change state onto the row', () => {
    const { rows } = buildDayRows({
      events: [event('panel', { flags: ['CANCELLED'] })],
      classes,
      changes: { panel: [change('panel')] },
      starredUids: new Set(['panel']),
    })
    expect(rows[0]?.starred).toBe(true)
    expect(rows[0]?.states).toEqual(['cancelled'])
    expect(rows[0]?.loud).toBe(true)
    expect(rows[0]?.changes).toHaveLength(1)
  })

  it('renders a duration on the row from the classification, not the tags', () => {
    const row = buildRow(event('block'), { classes, changes: {}, starredUids: new Set() })
    expect(row.duration).toBe('6h')
  })
})

describe('buildDayBuckets', () => {
  it('takes days from the whole corpus and counts from the filtered set', () => {
    const buckets = buildDayBuckets(
      ['2026-07-24', '2026-07-25', '2026-07-25', '2026-07-26'],
      ['2026-07-25']
    )
    expect(buckets.map((b) => [b.day, b.count])).toEqual([
      ['2026-07-24', 0],
      ['2026-07-25', 1],
      ['2026-07-26', 0],
    ])
  })

  it('keeps a filtered-out day in the rail rather than letting the buttons move', () => {
    const buckets = buildDayBuckets(['2026-07-24', '2026-07-25'], [])
    expect(buckets.map((b) => b.day)).toEqual(['2026-07-24', '2026-07-25'])
    expect(buckets.every((b) => b.count === 0)).toBe(true)
  })

  it('ignores events with no day at all', () => {
    expect(buildDayBuckets([null, '2026-07-25'], [null])).toEqual([
      { day: '2026-07-25', weekday: 'Sat', date: 'Jul 25', count: 0 },
    ])
  })
})

describe('resolveActiveDay', () => {
  const buckets = buildDayBuckets(
    ['2026-07-24', '2026-07-25', '2026-07-26'],
    ['2026-07-25', '2026-07-26']
  )

  it('keeps the current day across a refresh', () => {
    expect(resolveActiveDay(buckets, '2026-07-24')).toBe('2026-07-24')
  })

  it('falls to the first day with results when the current one is gone', () => {
    expect(resolveActiveDay(buckets, '2026-07-30')).toBe('2026-07-25')
    expect(resolveActiveDay(buckets, null)).toBe('2026-07-25')
  })

  it('falls to the first day at all when the filter emptied every day', () => {
    const empty = buildDayBuckets(['2026-07-24', '2026-07-25'], [])
    expect(resolveActiveDay(empty, null)).toBe('2026-07-24')
  })

  it('has nothing to resolve against an empty corpus', () => {
    expect(resolveActiveDay([], 'anything')).toBeNull()
  })

  it('keeps "All" sticky regardless of the day buckets', () => {
    expect(resolveActiveDay(buckets, ALL_DAYS)).toBe(ALL_DAYS)
    // Even against an empty corpus — All is a valid selection, not a day.
    expect(resolveActiveDay([], ALL_DAYS)).toBe(ALL_DAYS)
  })
})

describe('buildGhostRows', () => {
  const stars: StarRecord[] = [
    {
      uid: 'live',
      title: 'Still scheduled',
      start: '2026-07-25T10:00:00-07:00',
      room: 'Room 5AB',
      starredAt: '2026-07-20T18:00:00.000Z',
    },
    {
      uid: 'gone',
      title: 'Pulled from the feed',
      start: '2026-07-25T14:00:00-07:00',
      room: 'Room 9',
      starredAt: '2026-07-20T18:00:00.000Z',
    },
    {
      uid: 'dateless',
      title: 'Starred before it had a time',
      start: null,
      room: '',
      starredAt: '2026-07-20T18:00:00.000Z',
    },
  ]

  it('is exactly the starred UIDs the feed dropped, described from the snapshot', () => {
    const ghosts = buildGhostRows(stars, new Set(['live']))
    expect(ghosts.map((g) => g.star.uid)).toEqual(['dateless', 'gone'])
    expect(ghosts.find((g) => g.star.uid === 'gone')).toMatchObject({
      time: '2:00p',
      day: '2026-07-25',
    })
  })

  it('stops producing a ghost when the UID returns, with no flag to clear', () => {
    expect(buildGhostRows(stars, new Set(['live', 'gone', 'dateless']))).toEqual([])
  })

  it('buckets a ghost onto the day its snapshot recorded', () => {
    const ghosts = buildGhostRows(stars, new Set(['live']))
    expect(ghostsForDay(ghosts, '2026-07-25').map((g) => g.star.uid)).toEqual(['dateless', 'gone'])
    expect(ghostsForDay(ghosts, '2026-07-24').map((g) => g.star.uid)).toEqual(['dateless'])
  })
})

describe('withDayHeaders', () => {
  const input = {
    classes: new Map<string, EventClassification>(),
    changes: {} as Record<string, Change[]>,
    starredUids: new Set<string>(),
  }
  const row = (uid: string) => buildRow(event(uid), input)

  it('inserts one header before each day, once, in row order', () => {
    const rows = [row('a'), row('b'), row('c'), row('d')]
    const days = new Map<string, string | null>([
      ['a', '2026-07-24'],
      ['b', '2026-07-24'],
      ['c', '2026-07-25'],
      ['d', '2026-07-26'],
    ])
    const shape = withDayHeaders(rows, days).map((it) =>
      it.kind === 'header' ? `H:${it.day}` : `R:${it.row.uid}`,
    )
    expect(shape).toEqual([
      'H:2026-07-24',
      'R:a',
      'R:b',
      'H:2026-07-25',
      'R:c',
      'H:2026-07-26',
      'R:d',
    ])
  })

  it('returns an empty list for no rows', () => {
    expect(withDayHeaders([], new Map())).toEqual([])
  })

  it('labels rows without a day under an Unscheduled (null) header', () => {
    // Dateless rows sort to the end (startMs → Infinity); without their own
    // divider they would visually belong to the last real day.
    const rows = [row('a'), row('x')]
    const days = new Map<string, string | null>([
      ['a', '2026-07-24'],
      ['x', null],
    ])
    expect(withDayHeaders(rows, days)).toEqual([
      { kind: 'header', day: '2026-07-24' },
      { kind: 'row', row: rows[0] },
      { kind: 'header', day: null },
      { kind: 'row', row: rows[1] },
    ])
  })
})
