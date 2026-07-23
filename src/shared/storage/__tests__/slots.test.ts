import { describe, expect, it, vi } from 'vitest'
import type { JsonStore } from '../jsonStore'
import { SnapshotSlots, StarSlots } from '../slots'
import { CURRENT_SCHEMA_VERSION, emptyChangeLog } from '../../schedule'
import type { Snapshot } from '../../schedule'
import type { StarRecord } from '../../stars'

class MemoryJsonStore implements JsonStore {
  readonly values = new Map<string, unknown>()
  failName: string | null = null

  async read(name: string): Promise<unknown | null> {
    return this.values.get(name) ?? null
  }

  async replace(name: string, value: unknown): Promise<void> {
    if (name === this.failName) throw new Error(`replace failed: ${name}`)
    this.values.set(name, structuredClone(value))
  }
}

const snapshot = (fetchedAt = '2026-07-20T12:00:00.000Z'): Snapshot => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  fetchedAt,
  site: 'https://example.test',
  events: [],
  stats: { eventCount: 0, joinedWithListView: 0, joinRate: 1 },
})

const star = (uid: string): StarRecord => ({
  uid,
  title: `Event ${uid}`,
  start: null,
  room: '',
  starredAt: '2026-07-20T18:00:00.000Z',
})

describe('SnapshotSlots', () => {
  it('round-trips both snapshots and the change log through an injected store', async () => {
    const json = new MemoryJsonStore()
    const slots = new SnapshotSlots(json)
    const log = { schemaVersion: 1, entries: { a: [] } }

    await slots.writeSnapshot('last-known-good', snapshot())
    await slots.writeSnapshot('last-fetched', snapshot('2026-07-21T12:00:00.000Z'))
    await slots.writeChangeLog(log)

    expect((await slots.readSnapshot('last-known-good'))?.fetchedAt).toBe('2026-07-20T12:00:00.000Z')
    expect((await slots.readSnapshot('last-fetched'))?.fetchedAt).toBe('2026-07-21T12:00:00.000Z')
    expect(await slots.readChangeLog()).toEqual(log)
  })

  it('treats absent, corrupt, and unknown-version snapshots as absent', async () => {
    const json = new MemoryJsonStore()
    const slots = new SnapshotSlots(json)
    expect(await slots.readSnapshot('last-known-good')).toBeNull()
    json.values.set('last-known-good.json', '{not parsed by a real adapter')
    expect(await slots.readSnapshot('last-known-good')).toBeNull()
    json.values.set('last-known-good.json', { ...snapshot(), schemaVersion: 99 })
    expect(await slots.readSnapshot('last-known-good')).toBeNull()
  })

  it('uses an empty change log for invalid persisted data', async () => {
    const json = new MemoryJsonStore()
    const slots = new SnapshotSlots(json)
    json.values.set('unseen-changes.json', { schemaVersion: 99, entries: {} })
    expect(await slots.readChangeLog()).toEqual(emptyChangeLog())
  })
})

describe('StarSlots', () => {
  it('rotates the previous primary into a backup generation', async () => {
    const json = new MemoryJsonStore()
    const slots = new StarSlots(json)
    await slots.write([star('a')])
    await slots.write([star('a'), star('b')])
    json.values.set('stars.json', null)
    expect(await slots.read()).toEqual([star('a')])
  })

  it('falls back from a corrupt primary to a valid backup and floors at empty', async () => {
    const json = new MemoryJsonStore()
    const slots = new StarSlots(json)
    json.values.set('stars.json', null)
    json.values.set('stars.backup.json', { schemaVersion: 1, stars: [star('a')] })
    expect(await slots.read()).toEqual([star('a')])
    json.values.set('stars.backup.json', null)
    expect(await slots.read()).toEqual([])
  })

  it('tolerates an unknown star schema version', async () => {
    const json = new MemoryJsonStore()
    const slots = new StarSlots(json)
    json.values.set('stars.json', { schemaVersion: 99, stars: [star('a')] })
    expect(await slots.read()).toEqual([star('a')])
  })

  it('echoes the previously persisted generation when a write fails', async () => {
    const json = new MemoryJsonStore()
    const slots = new StarSlots(json)
    await slots.write([star('a')])
    json.failName = 'stars.json'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await slots.write([star('a'), star('b')])).toEqual([star('a')])
    warn.mockRestore()
  })
})
