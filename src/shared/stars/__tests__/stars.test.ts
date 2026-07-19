import { describe, expect, it } from 'vitest'
import {
  ghostStars,
  isStarred,
  normalizeStars,
  starFromEvent,
  toggleStar,
  unstar,
  type StarRecord,
} from '..'
import type { ScheduleEvent } from '../../schedule/types'

const NOW = '2026-07-20T18:00:00.000Z'

function event(partial: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    uid: 'aaaa1111111111111111111111111111',
    shortId: '2QWWL',
    title: 'Drawing Monsters for a Living',
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

describe('starFromEvent', () => {
  it('snapshots the fields a ghost row needs to describe itself', () => {
    expect(starFromEvent(event(), NOW)).toEqual({
      uid: 'aaaa1111111111111111111111111111',
      title: 'Drawing Monsters for a Living',
      start: '2026-07-25T10:00:00-07:00',
      room: 'Room 5AB',
      starredAt: NOW,
    })
  })
})

describe('toggleStar', () => {
  it('stars and unstars by UID', () => {
    const e = event()
    const on = toggleStar([], e, NOW)
    expect(isStarred(on, e.uid)).toBe(true)
    expect(toggleStar(on, e, NOW)).toEqual([])
  })

  it('unstars by UID alone, which is how a ghost gets removed', () => {
    const on = toggleStar([], event(), NOW)
    expect(unstar(on, 'aaaa1111111111111111111111111111')).toEqual([])
  })
})

describe('normalizeStars', () => {
  it('drops entries with no UID, since there is nothing to point at', () => {
    expect(normalizeStars([{ title: 'Orphan' }, { uid: 'a', title: 'Kept' }])).toEqual([
      { uid: 'a', title: 'Kept', start: null, room: '', starredAt: '' },
    ])
  })

  it('keeps a star whose snapshot fields are missing rather than rejecting it', () => {
    // Losing the row because its label failed to persist would be the exact
    // silent data loss the snapshot exists to prevent.
    expect(normalizeStars([{ uid: 'a' }])).toEqual([
      { uid: 'a', title: '', start: null, room: '', starredAt: '' },
    ])
  })

  it('de-duplicates by UID, first write winning so starredAt is not reset', () => {
    const out = normalizeStars([
      { uid: 'a', starredAt: 'first' },
      { uid: 'a', starredAt: 'second' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.starredAt).toBe('first')
  })

  it('coerces junk from the bridge into an empty list instead of throwing', () => {
    expect(normalizeStars(null)).toEqual([])
    expect(normalizeStars('nope')).toEqual([])
    expect(normalizeStars([null, 7, 'x'])).toEqual([])
  })

  it('nulls a non-string start rather than carrying it through', () => {
    expect(normalizeStars([{ uid: 'a', start: 12345 }])[0]?.start).toBeNull()
  })
})

describe('ghostStars', () => {
  const stars: StarRecord[] = [
    { uid: 'live', title: 'Still here', start: null, room: '', starredAt: NOW },
    { uid: 'gone', title: 'Pulled from the feed', start: null, room: '', starredAt: NOW },
  ]

  it('is exactly the starred UIDs the feed no longer carries', () => {
    expect(ghostStars(stars, new Set(['live'])).map((s) => s.uid)).toEqual(['gone'])
  })

  it('stops being a ghost when the UID comes back, with no flag to clear', () => {
    expect(ghostStars(stars, new Set(['live', 'gone']))).toEqual([])
  })

  it('treats every star as a ghost against an empty feed', () => {
    expect(ghostStars(stars, new Set())).toHaveLength(2)
  })
})
