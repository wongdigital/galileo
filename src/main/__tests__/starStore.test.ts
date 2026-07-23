import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StarStore, registerStarIpc, type StarIpcMain } from '../starStore'
import { STARS_SCHEMA_VERSION, type StarRecord } from '../../shared/stars'

let base: string
let store: StarStore

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'galileo-stars-'))
  store = new StarStore(base)
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

const star = (uid: string, partial: Partial<StarRecord> = {}): StarRecord => ({
  uid,
  title: `Event ${uid}`,
  start: '2026-07-25T10:00:00-07:00',
  room: 'Room 5AB',
  starredAt: '2026-07-20T18:00:00.000Z',
  ...partial,
})

const file = () => join(base, 'schedule', 'stars.json')

describe('StarStore', () => {
  it('reads an empty list before anything has been written', async () => {
    expect(await store.read()).toEqual([])
  })

  it('round-trips a starred list across a fresh store — the restart case', async () => {
    await store.write([star('a'), star('b')])
    expect(await new StarStore(base).read()).toEqual([star('a'), star('b')])
  })

  it('writes the versioned envelope', async () => {
    await store.write([star('a')])
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({
      schemaVersion: STARS_SCHEMA_VERSION,
      stars: [star('a')],
    })
  })

  it('keeps the previous primary as a backup generation', async () => {
    await store.write([star('a')])
    await store.write([star('a'), star('b')])
    expect(JSON.parse(readFileSync(join(base, 'schedule', 'stars.backup.json'), 'utf8'))).toEqual({
      schemaVersion: STARS_SCHEMA_VERSION,
      stars: [star('a')],
    })
    writeFileSync(file(), '{corrupt primary')
    expect(await store.read()).toEqual([star('a')])
  })

  it('leaves no temp files behind', async () => {
    await store.write([star('a')])
    expect(readdirSync(join(base, 'schedule')).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('reads a corrupt file as no stars rather than crashing the app', async () => {
    writeFileSync(file(), '{ truncated mid-writ', 'utf8')
    expect(await store.read()).toEqual([])
  })

  it('reads a bare legacy array, since discarding a starred list over a version bump is the worst possible migration', async () => {
    writeFileSync(file(), JSON.stringify([star('a')]), 'utf8')
    expect(await store.read()).toEqual([star('a')])
  })

  it('normalizes what it reads back off disk', async () => {
    writeFileSync(
      file(),
      JSON.stringify({ schemaVersion: 1, stars: [{ uid: 'a' }, { title: 'no uid' }] }),
      'utf8'
    )
    expect(await store.read()).toEqual([{ uid: 'a', title: '', start: null, room: '', starredAt: '' }])
  })

  it('echoes back the list it persisted', async () => {
    expect(await store.write([star('a')])).toEqual([star('a')])
  })

  it('echoes back the previous list when the write fails, so the loss is visible now', async () => {
    await store.write([star('a')])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Occupy the store's deterministic temp path with a directory, so the temp
    // write fails on every platform while stars.json stays intact for the
    // echo. (The old injection — chmod 0o500 on the parent directory — is a
    // no-op on Windows, where a directory's mode does not block writes into it,
    // and the Windows CI run caught exactly that.)
    mkdirSync(`${file()}.${process.pid}.tmp`)

    const echoed = await store.write([star('a'), star('b')])

    expect(echoed).toEqual([star('a')])
    expect(JSON.parse(readFileSync(file(), 'utf8')).stars).toEqual([star('a')])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('registerStarIpc', () => {
  function harness() {
    const handlers = new Map<string, (event: unknown, ...args: never[]) => unknown>()
    const ipcMain: StarIpcMain = { handle: (channel, listener) => void handlers.set(channel, listener) }
    registerStarIpc(ipcMain, store)
    return {
      get: () => handlers.get('stars:get')!(null),
      set: (payload: unknown) => handlers.get('stars:set')!(null, payload as never),
    }
  }

  it('registers exactly the two channels the preload exposes', () => {
    const handlers = new Map<string, unknown>()
    registerStarIpc({ handle: (c, l) => void handlers.set(c, l) }, store)
    expect([...handlers.keys()]).toEqual(['stars:get', 'stars:set'])
  })

  it('persists through set and returns the persisted list', async () => {
    const ipc = harness()
    expect(await ipc.set([star('a')])).toEqual([star('a')])
    expect(await ipc.get()).toEqual([star('a')])
  })

  it('normalizes untrusted payloads from the bridge before persisting', async () => {
    const ipc = harness()
    // Whatever the renderer sends, it crossed a context bridge; the store is
    // the last place that can refuse to write nonsense to disk.
    expect(await ipc.set([{ uid: 'a', title: 'Kept' }, { title: 'dropped' }, 'garbage'])).toEqual([
      { uid: 'a', title: 'Kept', start: null, room: '', starredAt: '' },
    ])
    expect(await ipc.set('not an array at all')).toEqual([])
  })
})
