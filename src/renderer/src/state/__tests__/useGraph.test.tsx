// @vitest-environment jsdom

/**
 * The graph's view model against the spine, which is where the plan's
 * cross-layer scenarios actually live: a lens switch has to keep the node set,
 * a filter seed has to be capped, a star set in the graph has to show up in the
 * list, and a seed with no edges under the active lens has to be able to say
 * where its edges *are*.
 *
 * The canvas is not exercised here — that layer is feel-tested — but everything
 * that decides what the canvas is handed is.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { SpineProvider, useSpine } from '../spine'
import { useGraph, SEED_CAP } from '../useGraph'
import { useSchedule } from '../useSchedule'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'

/** sha256('') truncated to 16 hex chars — every fixture event has an empty
 *  description, so this is the hash the staleness pass must agree with.
 *  Hoisted because `vi.mock` factories run before the module body. */
const { HASH_OF_EMPTY } = vi.hoisted(() => ({ HASH_OF_EMPTY: 'e3b0c44298fc1c14' }))

/** A tiny synthetic index — no Sched prose, and no 1.2 MB file in the suite. */
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

const EVENTS = [
  event('p1'),
  event('p2'),
  event('p3'),
  // A stranger: no index entry at all, so no people and no franchise.
  event('x1', { title: 'Unrelated' }),
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
    () => ({ spine: useSpine(), graph: useGraph(), schedule: useSchedule() }),
    { wrapper },
  )
}

async function mountReady() {
  const view = mount()
  await waitFor(() => expect(view.result.current.graph.indexReady).toBe(true))
  return view
}

describe('useGraph', () => {
  it('offers seed candidates instead of an empty canvas when nothing is seeded', async () => {
    const { result } = await mountReady()
    expect(result.current.spine.seed).toBeNull()
    expect(result.current.graph.nodes).toHaveLength(0)
    expect(result.current.graph.candidates.length).toBeGreaterThan(0)
  })

  it('seeds a panel and finds the neighbour that shares a person', async () => {
    const { result } = await mountReady()
    act(() => result.current.spine.setLens('people'))
    act(() => result.current.spine.setSeed({ uids: ['p1'], lens: 'people', hops: 1, origin: 'selection' }))

    await waitFor(() => expect(result.current.graph.nodes).toHaveLength(2))
    expect(result.current.graph.nodes.map((n) => n.uid).sort()).toEqual(['p1', 'p2'])
    expect(result.current.graph.links).toHaveLength(1)
    expect(result.current.graph.links[0]?.entities[0]?.label).toBe('Ada Vance')
  })

  it('keeps the node set across a lens switch and moves the fringe instead', async () => {
    const { result } = await mountReady()
    act(() => result.current.spine.setLens('people'))
    act(() => result.current.spine.setSeed({ uids: ['p1'], lens: 'people', hops: 1, origin: 'selection' }))
    await waitFor(() => expect(result.current.graph.nodes).toHaveLength(2))

    act(() => result.current.spine.setLens('ip'))

    // Same two nodes. p2 has no franchise, so under IP it loses its edge and
    // becomes the fringe — the node set persists, the links do not.
    expect(result.current.graph.nodes.map((n) => n.uid).sort()).toEqual(['p1', 'p2'])
    expect(result.current.graph.links).toHaveLength(0)
    expect(result.current.graph.nodes.filter((n) => n.fringe).map((n) => n.uid).sort()).toEqual([
      'p1',
      'p2',
    ])
  })

  it('reports per-lens degrees so a zero-edge seed has a way out', async () => {
    const { result } = await mountReady()
    act(() => result.current.spine.setLens('offering'))
    act(() =>
      result.current.spine.setSeed({ uids: ['p1'], lens: 'offering', hops: 1, origin: 'selection' }),
    )
    await waitFor(() => expect(result.current.graph.nodes).toHaveLength(1))

    const byLens = Object.fromEntries(result.current.graph.seedDegrees.map((d) => [d.lens, d.degree]))
    expect(byLens.offering).toBe(0)
    expect(byLens.people).toBe(1)
    expect(byLens.ip).toBe(1)
  })

  it('caps a filter seed and says what it capped', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `p${i}`)
    const { result } = await mountReady()
    act(() => result.current.spine.setSeed({ uids: many, lens: 'ip', hops: 1, origin: 'filter' }))

    await waitFor(() => expect(result.current.graph.seedTruncated).not.toBeNull())
    expect(result.current.graph.seedTruncated).toEqual({ requested: 40, used: SEED_CAP })
  })

  it('starring in the graph shows up in the 5-day view immediately', async () => {
    const { result } = await mountReady()
    act(() => result.current.spine.setSeed({ uids: ['p1'], lens: 'ip', hops: 1, origin: 'selection' }))
    await waitFor(() => expect(result.current.graph.nodes.length).toBeGreaterThan(0))

    await act(async () => {
      await result.current.spine.toggleStar(EVENTS[0]!)
    })

    expect(result.current.graph.nodes.find((n) => n.uid === 'p1')?.starred).toBe(true)
    expect(result.current.schedule.rows.find((r) => r.uid === 'p1')?.starred).toBe(true)
  })

  it('carries the cancelled encoding alongside the star ring', async () => {
    ;(window as unknown as { api: { schedule: { refresh: unknown } } }).api.schedule.refresh = vi.fn(
      async () => projection([event('p1', { flags: ['CANCELLED'] }), ...EVENTS.slice(1)]),
    )
    const { result } = await mountReady()
    act(() => result.current.spine.setSeed({ uids: ['p1'], lens: 'ip', hops: 1, origin: 'selection' }))
    await waitFor(() => expect(result.current.graph.nodes.length).toBeGreaterThan(0))

    await act(async () => {
      await result.current.spine.toggleStar(EVENTS[0]!)
    })

    const node = result.current.graph.nodes.find((n) => n.uid === 'p1')!
    expect(node.states).toContain('cancelled')
    expect(node.starred).toBe(true)
  })

  it('survives a refresh that removes a node without losing the survivors', async () => {
    const { result } = await mountReady()
    act(() => result.current.spine.setLens('people'))
    act(() => result.current.spine.setSeed({ uids: ['p1'], lens: 'people', hops: 1, origin: 'selection' }))
    await waitFor(() => expect(result.current.graph.nodes).toHaveLength(2))

    ;(window as unknown as { api: { schedule: { refresh: unknown } } }).api.schedule.refresh = vi.fn(
      async () => projection(EVENTS.filter((e) => e.uid !== 'p2')),
    )
    await act(async () => {
      await result.current.spine.refresh()
    })

    await waitFor(() => expect(result.current.graph.nodes).toHaveLength(1))
    expect(result.current.graph.nodes[0]?.uid).toBe('p1')
  })

  /**
   * Regression: `filteredUids` was built inside `useSchedule`'s return literal,
   * so a new array came back on every render even when the filter had not moved.
   * Anything holding it as a memo dependency rebuilt on unrelated state changes —
   * and a force layout keyed on rebuilt data restarts, so the entity graph reset
   * itself the moment a hover set state. Identity is the contract here, not
   * contents, which is why this asserts `toBe` and not `toEqual`.
   */
  it('hands back the same filteredUids array when the filter has not changed', async () => {
    const view = await mountReady()
    const first = view.result.current.schedule.filteredUids

    view.rerender()
    expect(view.result.current.schedule.filteredUids).toBe(first)

    // A state change that touches no filter input — the hover case.
    act(() => view.result.current.spine.setSelectedUid('p1'))
    expect(view.result.current.schedule.filteredUids).toBe(first)
  })
})
