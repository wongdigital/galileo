import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SnapshotStore } from '../snapshotStore'
import { CURRENT_SCHEMA_VERSION, emptyChangeLog } from '../../shared/schedule'
import type { ScheduleEvent, Snapshot } from '../../shared/schedule'

let base: string
let store: SnapshotStore

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'galileo-store-'))
  store = new SnapshotStore(base)
})

afterEach(() => rmSync(base, { recursive: true, force: true }))

function event(uid: string): ScheduleEvent {
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
  }
}

function snapshot(): Snapshot {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    fetchedAt: '2026-07-20T12:00:00.000Z',
    site: 'https://comiccon2026.sched.com',
    events: [event('a')],
    stats: { eventCount: 1, joinedWithListView: 1, joinRate: 1 },
  }
}

describe('SnapshotStore', () => {
  it('round-trips both slots independently', async () => {
    const good = snapshot()
    const fetchedLater: Snapshot = { ...snapshot(), fetchedAt: '2026-07-21T12:00:00.000Z' }
    await store.writeSnapshot('last-known-good', good)
    await store.writeSnapshot('last-fetched', fetchedLater)
    expect((await store.readSnapshot('last-known-good'))?.fetchedAt).toBe(good.fetchedAt)
    expect((await store.readSnapshot('last-fetched'))?.fetchedAt).toBe(fetchedLater.fetchedAt)
  })

  it('returns null for a slot that has never been written', async () => {
    expect(await store.readSnapshot('last-known-good')).toBeNull()
  })

  it('discards a snapshot from an older schema version instead of crashing', async () => {
    writeFileSync(join(base, 'schedule', 'last-known-good.json'), JSON.stringify({ ...snapshot(), schemaVersion: 0 }))
    expect(await store.readSnapshot('last-known-good')).toBeNull()
  })

  it('discards a truncated file rather than throwing on parse', async () => {
    writeFileSync(join(base, 'schedule', 'last-known-good.json'), '{"schemaVersion":1,"eve')
    expect(await store.readSnapshot('last-known-good')).toBeNull()
  })

  it('leaves no temp files behind after a write', async () => {
    await store.writeSnapshot('last-known-good', snapshot())
    expect(readdirSync(join(base, 'schedule')).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('keeps the previous snapshot readable when a new write fails', async () => {
    await store.writeSnapshot('last-known-good', snapshot())
    // A value JSON cannot serialize: the rename must never happen, so the good
    // file on disk has to survive intact.
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(store.writeSnapshot('last-known-good', circular as unknown as Snapshot)).rejects.toThrow()
    expect((await store.readSnapshot('last-known-good'))?.events).toHaveLength(1)
    expect(readdirSync(join(base, 'schedule')).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('round-trips the unseen-change log and starts empty', async () => {
    expect(await store.readChangeLog()).toEqual(emptyChangeLog())
    const log = {
      schemaVersion: 1,
      entries: { a: [{ uid: 'a', kind: 'moved-room' as const, from: 'Room 5', to: 'Hall H', detectedAt: 'now' }] },
    }
    await store.writeChangeLog(log)
    expect(await store.readChangeLog()).toEqual(log)
  })

  it('falls back to an empty log when the persisted one is from another version', async () => {
    writeFileSync(join(base, 'schedule', 'unseen-changes.json'), JSON.stringify({ schemaVersion: 99, entries: { a: [] } }))
    expect(await store.readChangeLog()).toEqual(emptyChangeLog())
  })

  it('creates its directory on construction so a first write cannot fail', async () => {
    const fresh = join(base, 'nested', 'deeper')
    await expect(new SnapshotStore(fresh).writeSnapshot('last-fetched', snapshot())).resolves.toBeUndefined()
  })
})
