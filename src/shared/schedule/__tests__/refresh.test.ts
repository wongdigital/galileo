import { describe, expect, it, vi } from 'vitest'
import type { JsonStore } from '../../storage/jsonStore'
import { SnapshotSlots } from '../../storage/slots'
import { CURRENT_SCHEMA_VERSION, emptyChangeLog } from '..'
import type { ScheduleEvent, Snapshot } from '..'
import { performRefresh, type ScheduleSources } from '../refresh'

const UID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const UID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function source(uid = UID_A, title = 'Panel A'): ScheduleSources {
  return {
    ics: [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `SUMMARY:${title}`,
      'DTSTART:20260723T170000Z',
      'DTEND:20260723T180000Z',
      'LOCATION:Room 5',
      'CATEGORIES:1: PROGRAMS',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
    listHtml: `<a href="event/panel-a/title" id="${uid}"><div class="sched-event-type"></div>`,
  }
}

function event(uid: string, title = `Event ${uid.slice(0, 1)}`): ScheduleEvent {
  return {
    uid,
    shortId: null,
    title,
    start: '2026-07-23T10:00:00-07:00',
    end: '2026-07-23T11:00:00-07:00',
    track: '1: PROGRAMS',
    subtypes: [],
    flags: [],
    room: 'Room 5',
    location: 'Room 5',
    description: '',
    url: null,
  }
}

function snapshot(events: ScheduleEvent[], fetchedAt = '2026-07-20T12:00:00.000Z'): Snapshot {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    fetchedAt,
    site: 'https://example.test',
    events,
    stats: { eventCount: events.length, joinedWithListView: events.length, joinRate: 1 },
  }
}

class RecordingStore implements JsonStore {
  readonly values = new Map<string, unknown>()
  readonly writes: string[] = []
  failAt: number | null = null

  async read(name: string): Promise<unknown | null> {
    return this.values.get(name) ?? null
  }

  async replace(name: string, value: unknown): Promise<void> {
    this.writes.push(name)
    if (this.failAt === this.writes.length) throw new Error(`halt after ${name}`)
    this.values.set(name, structuredClone(value))
  }
}

function harness(initial?: Snapshot) {
  const store = new RecordingStore()
  if (initial) store.values.set('last-known-good.json', initial)
  store.values.set('unseen-changes.json', emptyChangeLog())
  const slots = new SnapshotSlots(store)
  const fetchSources = vi.fn(async () => source())
  const deps = {
    site: 'https://example.test',
    slots,
    fetchSources,
    now: () => new Date('2026-07-22T19:00:00.000Z'),
    warn: vi.fn(),
  }
  return { store, slots, fetchSources, deps }
}

describe('performRefresh', () => {
  it('commits a successful fetch in prefix-consistent order', async () => {
    const { store, deps } = harness(snapshot([event(UID_A, 'Old title')]))

    const result = await performRefresh(deps)

    expect(result.stale).toBe(false)
    expect(result.events[0]?.title).toBe('Panel A')
    expect(result.fetchedAt).toBe('2026-07-22T19:00:00.000Z')
    expect(store.writes).toEqual([
      'last-fetched.json',
      'last-known-good.json',
      'unseen-changes.json',
    ])
  })

  it('stamps fetchedAt only after the fetch has resolved', async () => {
    let release!: (value: ScheduleSources) => void
    const { deps, fetchSources } = harness()
    const now = vi.fn(() => new Date('2026-07-22T19:00:00.000Z'))
    deps.now = now
    fetchSources.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))

    const refresh = performRefresh(deps)
    expect(now).not.toHaveBeenCalled()

    release(source())
    await expect(refresh).resolves.toMatchObject({ fetchedAt: '2026-07-22T19:00:00.000Z' })
    expect(now).toHaveBeenCalledOnce()
  })

  it('holds a drifted fetch for review and promotes it only with acceptAnyway', async () => {
    const old = snapshot([event(UID_A, 'Old A'), event(UID_B, 'Old B')])
    const { store, deps } = harness(old)

    const held = await performRefresh(deps)
    expect(held.warning?.reason).toBe('event-count-drop')
    expect(held.events).toHaveLength(2)
    expect((store.values.get('last-known-good.json') as Snapshot).events).toHaveLength(2)

    const accepted = await performRefresh(deps, { acceptAnyway: true })
    expect(accepted.warning).toBeUndefined()
    expect(accepted.events).toHaveLength(1)
    expect((store.values.get('last-known-good.json') as Snapshot).events).toHaveLength(1)
  })

  it('returns the stale baseline without writing when fetch rejects', async () => {
    const { store, deps, fetchSources } = harness(snapshot([event(UID_A)]))
    fetchSources.mockRejectedValueOnce(new Error('offline'))

    const result = await performRefresh(deps)

    expect(result.stale).toBe(true)
    expect(result.events).toHaveLength(1)
    expect(store.writes).toEqual([])
    expect(deps.warn).toHaveBeenCalledOnce()
  })

  it('returns the designed empty projection without writing on first-run offline', async () => {
    const { store, deps, fetchSources } = harness()
    fetchSources.mockRejectedValueOnce(new Error('offline'))

    const result = await performRefresh(deps)

    expect(result).toMatchObject({ events: [], fetchedAt: null, stale: false })
    expect(store.writes).toEqual([])
  })

  it('treats a captive-portal response as a failed fetch', async () => {
    const prior = snapshot([event(UID_A)])
    const { store, deps, fetchSources } = harness(prior)
    fetchSources.mockResolvedValueOnce({ ics: '<html>Sign in</html>', listHtml: '<html>Sign in</html>' })

    const result = await performRefresh(deps)

    expect(result.stale).toBe(true)
    expect(result.events).toHaveLength(1)
    expect(store.writes).toEqual([])
  })

  it('shares one in-flight fetch for matching options', async () => {
    let release!: (value: ScheduleSources) => void
    const { deps, fetchSources } = harness()
    fetchSources.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))

    const first = performRefresh(deps)
    const second = performRefresh(deps)
    expect(second).toBe(first)
    expect(fetchSources).toHaveBeenCalledTimes(1)

    release(source())
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
  })

  it('queues acceptAnyway behind a plain in-flight refresh', async () => {
    const releases: Array<(value: ScheduleSources) => void> = []
    const old = snapshot([event(UID_A), event(UID_B)])
    const { deps, fetchSources } = harness(old)
    fetchSources.mockImplementation(() => new Promise((resolve) => { releases.push(resolve) }))

    const plain = performRefresh(deps)
    const accepted = performRefresh(deps, { acceptAnyway: true })
    expect(fetchSources).toHaveBeenCalledTimes(1)

    releases[0]!(source())
    await plain
    await vi.waitFor(() => expect(fetchSources).toHaveBeenCalledTimes(2))
    releases[1]!(source())
    expect((await accepted).warning).toBeUndefined()
  })

  it.each([1, 2, 3])('leaves a consistent readable prefix when write step %i halts', async (failAt) => {
    const old = snapshot([event(UID_A, 'Old')])
    const { store, deps, slots } = harness(old)
    store.failAt = failAt

    await expect(performRefresh(deps)).rejects.toThrow('halt after')

    const lastFetched = await slots.readSnapshot('last-fetched')
    const lastKnownGood = await slots.readSnapshot('last-known-good')
    const log = await slots.readChangeLog()
    if (failAt === 1) expect(lastFetched).toBeNull()
    else expect(lastFetched?.fetchedAt).toBe('2026-07-22T19:00:00.000Z')
    if (failAt <= 2) expect(lastKnownGood?.events[0]?.title).toBe('Old')
    else expect(lastKnownGood?.events[0]?.title).toBe('Panel A')
    expect(log.schemaVersion).toBe(1)
  })
})
