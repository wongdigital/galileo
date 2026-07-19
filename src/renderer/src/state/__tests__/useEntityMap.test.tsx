// @vitest-environment jsdom

/**
 * The entity map's view model against the spine, which is where the plan's
 * cross-layer scenarios actually live: the filter has to be the only scope, a
 * lens switch has to swap hubs without touching the event population, a star set
 * anywhere has to show up everywhere, and none of it may hand back a fresh array
 * when nothing moved.
 *
 * The canvas is not exercised here — that layer is feel-tested — but everything
 * that decides what the canvas is handed is.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { EMPTY_FILTER } from '@shared/filter'
import { SpineProvider, useSpine } from '../spine'
import { useEntityMap } from '../useEntityMap'
import { useSchedule } from '../useSchedule'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'

/** sha256('') truncated to 16 hex chars — every fixture event has an empty
 *  description, so this is the hash the staleness pass must agree with.
 *  Hoisted because `vi.mock` factories run before the module body. */
const { HASH_OF_EMPTY } = vi.hoisted(() => ({ HASH_OF_EMPTY: 'e3b0c44298fc1c14' }))

/**
 * A tiny synthetic index — no Sched prose, and no 1.2 MB file in the suite.
 *
 * The overlap is deliberately asymmetric so that a lens switch is observable:
 * Star Wars covers p1 + p3, Ada Vance covers p1 + p2. Each lens therefore has
 * exactly one hub, and they claim different events.
 */
vi.mock('@data/enrichment.json', () => ({
  default: {
    schema_version: 1,
    generated_at: '2026-07-18T00:00:00Z',
    provenance: {
      model: 'test',
      batch_id: 'test',
      franchise_seed_version: 1,
      system_prompt_sha: 'test',
      event_count: 0,
    },
    entries: {
      p1: {
        status: 'ok',
        description_hash: HASH_OF_EMPTY,
        people: [{ name: 'Ada Vance', role: 'moderator' }],
        franchises: [{ surface_text: 'Star Wars', canonical: 'star-wars' }],
      },
      p2: {
        status: 'ok',
        description_hash: HASH_OF_EMPTY,
        people: [{ name: 'Ada Vance', role: 'panelist' }],
        franchises: [],
      },
      p3: {
        status: 'ok',
        description_hash: HASH_OF_EMPTY,
        people: [],
        franchises: [{ surface_text: 'Star Wars', canonical: 'star-wars' }],
      },
    },
  },
}))

function event(uid: string, partial: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    uid,
    shortId: uid,
    title: `Event ${uid}`,
    start: '2026-07-23T10:00:00-07:00',
    end: '2026-07-23T11:00:00-07:00',
    track: 'PROGRAMS',
    subtypes: [],
    flags: [],
    room: 'Room 1',
    location: 'Room 1',
    description: '',
    url: null,
    ...partial,
  }
}

/** Titles carry the filter term, since free text matches the haystack — this is
 *  the fixture's stand-in for "Comics", the slice the map was measured on. */
const EVENTS = [
  event('p1', { title: 'Comics Spotlight' }),
  event('p2', { title: 'Comics Roundtable' }),
  event('p3', { title: 'Comics Costuming' }),
  // A stranger: no index entry at all, and outside the filter term.
  event('x1', { title: 'Unrelated', room: 'Room 9' }),
]

function projection(events: ScheduleEvent[]): DatasetProjection {
  return { events, changes: {}, fetchedAt: '2026-07-18T00:00:00Z', stale: false }
}

let persisted: unknown[] = []

beforeEach(() => {
  persisted = []
  vi.stubGlobal('window', window)
  ;(window as unknown as { api: unknown }).api = {
    schedule: { refresh: vi.fn(async () => projection(EVENTS)) },
    changes: { acknowledge: vi.fn(async () => ({})) },
    stars: {
      get: vi.fn(async () => persisted),
      set: vi.fn(async (next: unknown[]) => {
        persisted = next
        return next
      }),
    },
    export: { ics: vi.fn() },
  }
})

const wrapper = ({ children }: { children: ReactNode }) => <SpineProvider>{children}</SpineProvider>

function mount() {
  return renderHook(
    () => ({ spine: useSpine(), map: useEntityMap(), schedule: useSchedule() }),
    { wrapper },
  )
}

async function mountReady() {
  const view = mount()
  await waitFor(() => expect(view.result.current.map.indexReady).toBe(true))
  return view
}

const setText = (spine: { setFilter: (f: typeof EMPTY_FILTER) => void }, text: string) =>
  act(() => spine.setFilter({ ...EMPTY_FILTER, text }))

describe('useEntityMap — scope is the filter (R2)', () => {
  it('resolves hubs, titles, and the fringe over a filtered slice', async () => {
    const { result } = await mountReady()
    setText(result.current.spine, 'Comics')

    await waitFor(() => expect(result.current.map.scopeUids).toHaveLength(3))
    const map = result.current.map

    // Under IP, Star Wars covers p1 and p3 — two in-scope events, so it draws.
    expect(map.hubs.map((h) => h.id)).toEqual(['ip:star-wars'])
    expect(map.hubs[0]).toMatchObject({ label: 'Star Wars', degree: 2, kind: 'entity' })

    // The pure layer labels events with the uid; resolving titles is this hook's job.
    expect(map.events.map((e) => e.title).sort()).toEqual([
      'Comics Costuming',
      'Comics Roundtable',
      'Comics Spotlight',
    ])
    expect(map.events.find((e) => e.uid === 'p1')).toMatchObject({
      id: 'event:p1',
      time: '10:00a',
      room: 'Room 1',
      degree: 1,
      fringe: false,
      starred: false,
    })

    // p2 has no franchise, so nothing claims it under IP.
    expect(map.events.filter((e) => e.fringe).map((e) => e.uid)).toEqual(['p2'])
    expect(map).toMatchObject({ hubCount: 1, connectedCount: 2, fringeCount: 1 })
    expect(map.links).toHaveLength(2)
    expect(map.nodes).toHaveLength(4)
  })

  it('spans the whole corpus when no filter is set (AE5)', async () => {
    const { result } = await mountReady()

    expect(result.current.map.scopeUids).toHaveLength(EVENTS.length)
    expect(result.current.map.events).toHaveLength(EVENTS.length)
    // x1 has no enrichment entry at all — it is in scope and it is fringe.
    expect(result.current.map.events.find((e) => e.uid === 'x1')).toMatchObject({ fringe: true })
    expect(result.current.map.connectedCount + result.current.map.fringeCount).toBe(EVENTS.length)
  })

  it('returns an empty map rather than throwing when the filter matches nothing', async () => {
    const { result } = await mountReady()
    setText(result.current.spine, 'nothing matches this')

    await waitFor(() => expect(result.current.map.scopeUids).toHaveLength(0))
    expect(result.current.map.nodes).toEqual([])
    expect(result.current.map.hubs).toEqual([])
    expect(result.current.map.events).toEqual([])
    expect(result.current.map.links).toEqual([])
    expect(result.current.map).toMatchObject({ hubCount: 0, connectedCount: 0, fringeCount: 0 })
  })
})

describe('useEntityMap — lens switching (R3, AE4)', () => {
  it('swaps hubs without changing the scope or the event population', async () => {
    const { result } = await mountReady()
    setText(result.current.spine, 'Comics')
    await waitFor(() => expect(result.current.map.hubs).toHaveLength(1))

    const scopeBefore = result.current.map.scopeUids
    const eventsBefore = result.current.map.events
    const idsBefore = eventsBefore.map((e) => e.id).sort()

    act(() => result.current.spine.setLens('people'))

    const map = result.current.map
    expect(map.lens).toBe('people')
    // Ada Vance covers p1 and p2; Star Wars is gone.
    expect(map.hubs.map((h) => h.id)).toEqual(['person:ada vance'])
    expect(map.hubs[0]).toMatchObject({ label: 'Ada Vance', degree: 2 })

    // Scope is untouched — a lens switch is not a re-scope, which is what tells
    // the view to reorganize rather than re-fit.
    expect(map.scopeUids).toBe(scopeBefore)
    expect(map.events.map((e) => e.id).sort()).toEqual(idsBefore)
    expect(map.events.filter((e) => e.fringe).map((e) => e.uid)).toEqual(['p3'])
  })

  /**
   * Only `degree` and `fringe` are lens-dependent on an event dot. An event that
   * neither gains nor loses a hub across the switch is the same dot in every
   * respect, and handing back a new object for it churns identities that the
   * node cache and the painters both hold.
   */
  it('reuses the node objects of events the switch did not move', async () => {
    const { result } = await mountReady()
    setText(result.current.spine, 'Comics')
    await waitFor(() => expect(result.current.map.hubs).toHaveLength(1))

    const before = new Map(result.current.map.events.map((e) => [e.uid, e]))
    act(() => result.current.spine.setLens('people'))
    const after = new Map(result.current.map.events.map((e) => [e.uid, e]))

    // p1 carries a hub under both lenses at degree 1 — nothing about it moved.
    expect(after.get('p1')).toBe(before.get('p1'))
    // p2 and p3 traded places between the core and the fringe, so both are new.
    expect(after.get('p2')).not.toBe(before.get('p2'))
    expect(after.get('p3')).not.toBe(before.get('p3'))
  })

  it('drops to an all-fringe map under a lens with nothing to join on', async () => {
    const { result } = await mountReady()
    setText(result.current.spine, 'Comics')
    await waitFor(() => expect(result.current.map.hubs).toHaveLength(1))

    // Distinct titles mean distinct offering clusters, so no offering qualifies.
    act(() => result.current.spine.setLens('offering'))

    expect(result.current.map.hubs).toEqual([])
    expect(result.current.map.links).toEqual([])
    expect(result.current.map.fringeCount).toBe(3)
    // The indexes for every lens stay on the model, so the view can say where
    // the hubs actually are without rebuilding anything.
    expect(result.current.map.indexes.get('ip')?.uidsByEntity.get('ip:star-wars')).toEqual([
      'p1',
      'p3',
    ])
  })
})

describe('useEntityMap — shared encodings (R10)', () => {
  it('starring through the spine lands on the map node and the list row together', async () => {
    const { result } = await mountReady()
    await waitFor(() => expect(result.current.map.events.length).toBeGreaterThan(0))

    await act(async () => {
      await result.current.spine.toggleStar(EVENTS[0]!)
    })

    expect(result.current.map.events.find((e) => e.uid === 'p1')?.starred).toBe(true)
    expect(result.current.schedule.rows.find((r) => r.uid === 'p1')?.starred).toBe(true)
  })

  it('carries the cancelled state alongside the star, exactly as a row does', async () => {
    ;(window as unknown as { api: { schedule: { refresh: unknown } } }).api.schedule.refresh = vi.fn(
      async () => projection([{ ...EVENTS[0]!, flags: ['CANCELLED'] }, ...EVENTS.slice(1)]),
    )
    const { result } = await mountReady()
    await waitFor(() => expect(result.current.map.events.length).toBeGreaterThan(0))

    await act(async () => {
      await result.current.spine.toggleStar(EVENTS[0]!)
    })

    const node = result.current.map.events.find((e) => e.uid === 'p1')!
    const row = result.current.schedule.rows.find((r) => r.uid === 'p1')!
    expect(node.states).toEqual(row.states)
    expect(node.states).toContain('cancelled')
    expect(node.starred).toBe(true)
  })

  it('rebuilds only the starred event, leaving its neighbours identical', async () => {
    const { result } = await mountReady()
    await waitFor(() => expect(result.current.map.events.length).toBeGreaterThan(0))
    const before = new Map(result.current.map.events.map((e) => [e.uid, e]))

    await act(async () => {
      await result.current.spine.toggleStar(EVENTS[0]!)
    })

    const after = new Map(result.current.map.events.map((e) => [e.uid, e]))
    expect(after.get('p1')).not.toBe(before.get('p1'))
    expect(after.get('p2')).toBe(before.get('p2'))
    expect(after.get('p3')).toBe(before.get('p3'))
  })

  it('drops a uid the refresh removed without disturbing the survivors', async () => {
    const { result } = await mountReady()
    await waitFor(() => expect(result.current.map.events).toHaveLength(4))

    ;(window as unknown as { api: { schedule: { refresh: unknown } } }).api.schedule.refresh = vi.fn(
      async () => projection(EVENTS.filter((e) => e.uid !== 'p2')),
    )
    await act(async () => {
      await result.current.spine.refresh()
    })

    await waitFor(() => expect(result.current.map.events).toHaveLength(3))
    expect(result.current.map.events.map((e) => e.uid).sort()).toEqual(['p1', 'p3', 'x1'])
    // p2 was Ada Vance's second event, so People loses its only hub with it.
    expect(result.current.map.scopeUids).not.toContain('p2')
  })
})

/**
 * Identity, not contents, is the contract. `filteredUids` was once built inside
 * `useSchedule`'s return literal and came back fresh on every render, so anything
 * holding it as a memo dependency rebuilt on unrelated state changes — and a
 * force layout keyed on rebuilt data restarts. The graph reset itself the moment
 * a hover set state. Hence `toBe` throughout.
 */
describe('useEntityMap — identity stability', () => {
  it('hands back the same arrays across a render that changed nothing', async () => {
    const view = await mountReady()
    const { hubs, events, nodes, links, scopeUids } = view.result.current.map

    view.rerender()

    expect(view.result.current.map.hubs).toBe(hubs)
    expect(view.result.current.map.events).toBe(events)
    expect(view.result.current.map.nodes).toBe(nodes)
    expect(view.result.current.map.links).toBe(links)
    expect(view.result.current.map.scopeUids).toBe(scopeUids)
  })

  it('hands back the same arrays when selection moves — the hover case', async () => {
    const view = await mountReady()
    const { hubs, events, nodes, links, scopeUids } = view.result.current.map

    act(() => view.result.current.spine.setSelectedUid('p1'))

    expect(view.result.current.map.hubs).toBe(hubs)
    expect(view.result.current.map.events).toBe(events)
    expect(view.result.current.map.nodes).toBe(nodes)
    expect(view.result.current.map.links).toBe(links)
    expect(view.result.current.map.scopeUids).toBe(scopeUids)

    // And again on the way back out, since a hover ends as often as it starts.
    act(() => view.result.current.spine.setSelectedUid(null))
    expect(view.result.current.map.nodes).toBe(nodes)
  })

  /**
   * The scope array is not shared with the harness's own `useSchedule` — this
   * hook holds its own instance, so the two derive equal contents down separate
   * memo chains. What has to hold is that *this* one moves when the filter moves
   * and then stops, which is the signal the view re-fits on.
   */
  it('replaces the scope array when the filter moves, then holds it still', async () => {
    const view = await mountReady()
    const whole = view.result.current.map.scopeUids
    expect(whole).toEqual(view.result.current.schedule.filteredUids)

    setText(view.result.current.spine, 'Comics')
    await waitFor(() => expect(view.result.current.map.scopeUids).toHaveLength(3))

    const narrowed = view.result.current.map.scopeUids
    expect(narrowed).not.toBe(whole)

    view.rerender()
    expect(view.result.current.map.scopeUids).toBe(narrowed)
  })
})
