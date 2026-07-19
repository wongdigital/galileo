import { describe, expect, it } from 'vitest'
import { buildDataset } from '../join'
import { ICS, LIST_HTML, LIST_HTML_EMPTY, UID_FARFUTURE, UID_LATE, UID_PANEL } from './fixtures'

const SITE = 'https://comiccon2026.sched.com'

describe('buildDataset', () => {
  const { events, stats } = buildDataset(ICS, LIST_HTML, { site: SITE })
  const byUid = new Map(events.map((e) => [e.uid, e]))

  it('joins every ICS event with its list-view entry', () => {
    expect(stats).toEqual({ eventCount: 4, joinedWithListView: 4, joinRate: 1 })
  })

  it('produces a fully populated event', () => {
    expect(byUid.get(UID_PANEL)).toMatchObject({
      uid: UID_PANEL,
      shortId: 'AAAAA',
      title: 'Drawing Robots for Fun',
      start: '2026-07-23T10:00:00-07:00',
      end: '2026-07-23T11:00:00-07:00',
      track: '1: PROGRAMS',
      subtypes: ['Comics', 'Sci-Fi & Fantasy'],
      flags: ['UPDATED'],
      room: 'Room 5 (Upper Level)',
      location: 'Room 5 (Upper Level), 111 Harbor Dr, San Diego, CA 92101, USA',
      url: `${SITE}/event/AAAAA`,
    })
  })

  it('keeps a room that carries no street address intact', () => {
    expect(byUid.get(UID_LATE)?.room).toBe('Screening Room 2')
  })

  it('sorts by start time, then title', () => {
    expect(events.map((e) => e.start)).toEqual([...events.map((e) => e.start)].sort())
  })

  it('buckets a midnight-crossing event on the local day it starts', () => {
    const late = byUid.get(UID_LATE)
    expect(late?.start).toBe('2026-07-23T21:30:00-07:00')
    expect(late?.end).toBe('2026-07-24T00:30:00-07:00')
  })

  it('clamps the two-years-out DTEND and records why', () => {
    const far = byUid.get(UID_FARFUTURE)
    expect(far?.end).toBe('2026-07-26T22:00:00-07:00')
    expect(far?.sanitized).toEqual({
      field: 'end',
      reason: 'beyond-con-end',
      original: '2028-07-26T18:00:00-07:00',
    })
  })

  it('degrades to ICS-only fields when the list view yields nothing', () => {
    const degraded = buildDataset(ICS, LIST_HTML_EMPTY, { site: SITE })
    expect(degraded.stats).toEqual({ eventCount: 4, joinedWithListView: 0, joinRate: 0 })
    const panel = degraded.events.find((e) => e.uid === UID_PANEL)
    expect(panel?.shortId).toBeNull()
    expect(panel?.subtypes).toEqual([])
    // The ICS URL is the fallback when there is no shortId to build one from.
    expect(panel?.url).toBe('https://example.test/event/AAAAA')
    expect(panel?.title).toBe('Drawing Robots for Fun')
  })

  it('reports a zero join rate rather than dividing by zero on an empty feed', () => {
    expect(buildDataset('', LIST_HTML, { site: SITE })).toEqual({
      events: [],
      stats: { eventCount: 0, joinedWithListView: 0, joinRate: 0 },
    })
  })

  it('skips VEVENT blocks with no UID, which cannot be identified or diffed', () => {
    const noUid = 'BEGIN:VEVENT\r\nSUMMARY:Ghost\r\nDTSTART:20260723T170000Z\r\nEND:VEVENT'
    expect(buildDataset(noUid, '', { site: SITE }).events).toEqual([])
  })
})
