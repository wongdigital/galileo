import { describe, expect, it } from 'vitest'
import type { Change, ScheduleEvent } from '../types'
import { acknowledgeChanges, accumulateChanges, diffEvents, emptyChangeLog } from '../diff'

const AT = '2026-07-20T12:00:00.000Z'
const LATER = '2026-07-20T18:00:00.000Z'

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

function kinds(changes: Change[]): string[] {
  return changes.map((c) => `${c.uid}:${c.kind}`).sort()
}

describe('diffEvents', () => {
  it('detects a moved start, a moved room, a removal, an addition, and a flag change', () => {
    const prev = [
      event('same'),
      event('moved-time'),
      event('moved-place'),
      event('gone'),
      event('flagged'),
    ]
    const next = [
      event('same'),
      event('moved-time', { start: '2026-07-23T14:00:00-07:00' }),
      event('moved-place', { room: 'Hall H' }),
      event('flagged', { flags: ['CANCELLED'] }),
      event('brand-new'),
    ]

    const changes = diffEvents(prev, next, AT)

    expect(kinds(changes)).toEqual([
      'brand-new:added',
      'flagged:flag-changed',
      'gone:removed',
      'moved-place:moved-room',
      'moved-time:moved-start',
    ])
    expect(changes.find((c) => c.kind === 'moved-start')).toMatchObject({
      from: '2026-07-23T10:00:00-07:00',
      to: '2026-07-23T14:00:00-07:00',
      detectedAt: AT,
    })
    expect(changes.find((c) => c.kind === 'moved-room')).toMatchObject({ from: 'Room 5', to: 'Hall H' })
    expect(changes.find((c) => c.kind === 'flag-changed')).toMatchObject({ from: '', to: 'CANCELLED' })
  })

  it('reports both a time move and a room move for one event', () => {
    const changes = diffEvents(
      [event('x')],
      [event('x', { start: '2026-07-24T10:00:00-07:00', room: 'Hall H' })],
      AT,
    )
    expect(kinds(changes)).toEqual(['x:moved-room', 'x:moved-start'])
  })

  it('ignores flag reordering, which Sched does without meaning anything by it', () => {
    const prev = [event('x', { flags: ['NEW', 'UPDATED'] })]
    const next = [event('x', { flags: ['UPDATED', 'NEW'] })]
    expect(diffEvents(prev, next, AT)).toEqual([])
  })

  it('ignores description and title edits, which are not schedule changes', () => {
    const changes = diffEvents([event('x')], [event('x', { title: 'Renamed', description: 'new' })], AT)
    expect(changes).toEqual([])
  })

  it('treats an empty previous snapshot as no changes rather than a wall of additions', () => {
    // First run has nothing to compare against; flagging all 3,474 events as
    // "new" would make the change log useless on day one.
    expect(diffEvents([], [event('a'), event('b')], AT)).toEqual([])
  })
})

describe('unseen change log', () => {
  it('starts empty', () => {
    expect(emptyChangeLog().entries).toEqual({})
  })

  it('keeps a move visible across a second refresh that detects nothing new', () => {
    const move = diffEvents([event('x')], [event('x', { start: '2026-07-24T10:00:00-07:00' })], AT)
    const afterFirst = accumulateChanges(emptyChangeLog(), move)
    // Second refresh: the feed is stable now, so the diff is empty.
    const afterSecond = accumulateChanges(afterFirst, diffEvents([event('x')], [event('x')], LATER))
    expect(afterSecond.entries['x']).toHaveLength(1)
    expect(afterSecond.entries['x']?.[0]?.kind).toBe('moved-start')
  })

  it('collapses a second move of the same kind, keeping the original from-value', () => {
    const log = accumulateChanges(
      emptyChangeLog(),
      diffEvents([event('x')], [event('x', { start: '2026-07-24T10:00:00-07:00' })], AT),
    )
    const moved = accumulateChanges(
      log,
      diffEvents(
        [event('x', { start: '2026-07-24T10:00:00-07:00' })],
        [event('x', { start: '2026-07-25T10:00:00-07:00' })],
        LATER,
      ),
    )
    expect(moved.entries['x']).toEqual([
      {
        uid: 'x',
        kind: 'moved-start',
        from: '2026-07-23T10:00:00-07:00',
        to: '2026-07-25T10:00:00-07:00',
        detectedAt: LATER,
      },
    ])
  })

  it('drops an entry when the value moves back to where it started', () => {
    const log = accumulateChanges(
      emptyChangeLog(),
      diffEvents([event('x')], [event('x', { room: 'Hall H' })], AT),
    )
    const reverted = accumulateChanges(
      log,
      diffEvents([event('x', { room: 'Hall H' })], [event('x')], LATER),
    )
    expect(reverted.entries['x']).toBeUndefined()
  })

  it('cancels a pending removal when the event comes back', () => {
    const log = accumulateChanges(emptyChangeLog(), diffEvents([event('x'), event('y')], [event('y')], AT))
    expect(log.entries['x']?.[0]?.kind).toBe('removed')
    const back = accumulateChanges(log, diffEvents([event('y')], [event('x'), event('y')], LATER))
    expect(back.entries['x']).toBeUndefined()
  })

  it('clears only the acknowledged UIDs', () => {
    const log = accumulateChanges(
      emptyChangeLog(),
      diffEvents([event('a'), event('b')], [event('a', { room: 'Hall H' }), event('b', { room: 'Hall H' })], AT),
    )
    const acked = acknowledgeChanges(log, ['a'])
    expect(acked.entries['a']).toBeUndefined()
    expect(acked.entries['b']).toHaveLength(1)
  })

  it('acknowledging is idempotent and tolerates unknown UIDs', () => {
    const log = accumulateChanges(emptyChangeLog(), diffEvents([event('a')], [event('a', { room: 'X' })], AT))
    expect(acknowledgeChanges(acknowledgeChanges(log, ['a']), ['a', 'nope']).entries).toEqual({})
  })

  it('does not mutate the log it is given', () => {
    const log = accumulateChanges(emptyChangeLog(), diffEvents([event('a')], [event('a', { room: 'X' })], AT))
    const snapshotOfEntries = JSON.stringify(log.entries)
    acknowledgeChanges(log, ['a'])
    accumulateChanges(log, diffEvents([event('a', { room: 'X' })], [event('a', { room: 'Y' })], LATER))
    expect(JSON.stringify(log.entries)).toBe(snapshotOfEntries)
  })
})
