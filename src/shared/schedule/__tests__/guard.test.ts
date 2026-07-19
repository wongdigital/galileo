import { describe, expect, it } from 'vitest'
import type { ScheduleEvent, Snapshot, SnapshotStats } from '../types'
import { emptyChangeLog } from '../diff'
import { CURRENT_SCHEMA_VERSION, checkDrift, migrateSnapshot, resolveRefresh } from '../guard'

const NOW = '2026-07-20T18:00:00.000Z'
const EARLIER = '2026-07-20T12:00:00.000Z'
const SITE = 'https://comiccon2026.sched.com'

function event(uid: string, partial: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    uid,
    shortId: null,
    title: `Event ${uid}`,
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

function stats(eventCount: number, joined = eventCount): SnapshotStats {
  return { eventCount, joinedWithListView: joined, joinRate: eventCount === 0 ? 0 : joined / eventCount }
}

function snapshot(events: ScheduleEvent[], fetchedAt = EARLIER): Snapshot {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    fetchedAt,
    site: SITE,
    events,
    stats: stats(events.length),
  }
}

describe('checkDrift', () => {
  it('passes a healthy fetch', () => {
    expect(checkDrift(stats(3474), stats(3476))).toEqual({ ok: true })
  })

  it('fails a join rate under 90 percent', () => {
    const verdict = checkDrift(stats(3474, 100), stats(3476))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('low-join-rate')
  })

  it('passes a join rate exactly at the 90 percent threshold', () => {
    expect(checkDrift(stats(1000, 900), stats(1000))).toEqual({ ok: true })
  })

  it('fails an event count drop over 20 percent against last-known-good', () => {
    const verdict = checkDrift(stats(2000), stats(3476))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toBe('event-count-drop')
  })

  it('allows growth and small shrinkage', () => {
    expect(checkDrift(stats(4000), stats(3476))).toEqual({ ok: true })
    expect(checkDrift(stats(2781), stats(3476))).toEqual({ ok: true })
  })

  it('has no count baseline to compare against on first run', () => {
    expect(checkDrift(stats(3474), null)).toEqual({ ok: true })
    expect(checkDrift(stats(1), null)).toEqual({ ok: true })
  })

  it('fails an empty fetch even with no baseline', () => {
    const verdict = checkDrift(stats(0), null)
    expect(verdict.ok).toBe(false)
  })
})

describe('migrateSnapshot', () => {
  it('accepts a snapshot at the current schema version', () => {
    const snap = snapshot([event('a')])
    expect(migrateSnapshot(snap)).toEqual(snap)
  })

  it('discards an older schema version explicitly instead of crashing later', () => {
    expect(migrateSnapshot({ ...snapshot([event('a')]), schemaVersion: 0 })).toBeNull()
  })

  it('discards a newer schema version written by a future build', () => {
    expect(migrateSnapshot({ ...snapshot([event('a')]), schemaVersion: 999 })).toBeNull()
  })

  it('discards structurally broken input rather than trusting the envelope', () => {
    expect(migrateSnapshot(null)).toBeNull()
    expect(migrateSnapshot({ schemaVersion: CURRENT_SCHEMA_VERSION })).toBeNull()
    expect(migrateSnapshot('not an object')).toBeNull()
  })
})

describe('resolveRefresh', () => {
  const fetched = (events: ScheduleEvent[]) => ({ events, stats: stats(events.length), site: SITE, fetchedAt: NOW })

  it('serves fresh data and promotes it to last-known-good on a healthy fetch', () => {
    const result = resolveRefresh({
      fetched: fetched([event('a'), event('b')]),
      lastKnownGood: snapshot([event('a')]),
      log: emptyChangeLog(),
    })
    expect(result.projection.stale).toBe(false)
    expect(result.projection.fetchedAt).toBe(NOW)
    expect(result.projection.events).toHaveLength(2)
    expect(result.promote?.fetchedAt).toBe(NOW)
    expect(result.projection.warning).toBeUndefined()
  })

  it('accumulates the diff against last-known-good into the change log', () => {
    const result = resolveRefresh({
      fetched: fetched([event('a', { room: 'Hall H' })]),
      lastKnownGood: snapshot([event('a')]),
      log: emptyChangeLog(),
    })
    expect(result.log.entries['a']?.[0]).toMatchObject({ kind: 'moved-room', from: 'Room 5', to: 'Hall H' })
    expect(result.projection.changes['a']).toHaveLength(1)
  })

  it('falls back to last-known-good with staleness when the fetch fails', () => {
    const result = resolveRefresh({
      fetched: null,
      lastKnownGood: snapshot([event('a')]),
      log: emptyChangeLog(),
    })
    expect(result.projection.stale).toBe(true)
    expect(result.projection.fetchedAt).toBe(EARLIER)
    expect(result.projection.events).toHaveLength(1)
    expect(result.promote).toBeNull()
  })

  it('returns an explicit empty state when the fetch fails with no prior snapshot', () => {
    const result = resolveRefresh({ fetched: null, lastKnownGood: null, log: emptyChangeLog() })
    expect(result.projection).toEqual({ events: [], changes: {}, fetchedAt: null, stale: false })
    expect(result.promote).toBeNull()
  })

  it('keeps prior data and surfaces a warning when the drift guard trips', () => {
    const result = resolveRefresh({
      fetched: { events: [], stats: stats(4, 0), site: SITE, fetchedAt: NOW },
      lastKnownGood: snapshot([event('a'), event('b')]),
      log: emptyChangeLog(),
    })
    expect(result.projection.events).toHaveLength(2)
    expect(result.projection.stale).toBe(true)
    expect(result.projection.warning?.reason).toBe('low-join-rate')
    expect(result.promote).toBeNull()
  })

  it('does not diff against a snapshot it decided not to serve', () => {
    const result = resolveRefresh({
      fetched: { events: [event('a', { room: 'Hall H' })], stats: stats(1, 0), site: SITE, fetchedAt: NOW },
      lastKnownGood: snapshot([event('a'), event('b'), event('c')]),
      log: emptyChangeLog(),
    })
    expect(result.log.entries).toEqual({})
  })

  it('accepts the new data when the user overrides the guard', () => {
    const result = resolveRefresh({
      fetched: { events: [event('a')], stats: stats(1, 0), site: SITE, fetchedAt: NOW },
      lastKnownGood: snapshot([event('a'), event('b'), event('c')]),
      log: emptyChangeLog(),
      acceptAnyway: true,
    })
    expect(result.projection.events).toHaveLength(1)
    expect(result.projection.stale).toBe(false)
    expect(result.projection.warning).toBeUndefined()
    expect(result.promote?.events).toHaveLength(1)
    expect(result.log.entries['b']?.[0]?.kind).toBe('removed')
  })

  it('serves suspect data with its warning when there is no prior snapshot to keep', () => {
    const result = resolveRefresh({
      fetched: { events: [event('a')], stats: stats(1, 0), site: SITE, fetchedAt: NOW },
      lastKnownGood: null,
      log: emptyChangeLog(),
    })
    expect(result.projection.events).toHaveLength(1)
    expect(result.projection.warning?.reason).toBe('low-join-rate')
    // A tripped fetch never becomes the baseline every later guard compares to.
    expect(result.promote).toBeNull()
  })

  it('carries unacknowledged changes through a failed refresh', () => {
    const log = resolveRefresh({
      fetched: fetched([event('a', { room: 'Hall H' })]),
      lastKnownGood: snapshot([event('a')]),
      log: emptyChangeLog(),
    }).log
    const offline = resolveRefresh({ fetched: null, lastKnownGood: snapshot([event('a')]), log })
    expect(offline.projection.changes['a']).toHaveLength(1)
  })
})
