// @vitest-environment jsdom

/**
 * A smoke render of the map, with the canvas stubbed.
 *
 * The force layout is feel-tested, not asserted — but the chrome around it is
 * ordinary React that can break in ordinary ways, and "the graph tab throws" is
 * not something to discover at the con. So what is asserted here is the
 * interaction *contract*: what mounts, what pins, what dismisses, and that only
 * ever one card is open.
 *
 * The stub renders one button per node and one for the background, which is
 * enough to drive `onNodeClick` / `onBackgroundClick` without a canvas. It is
 * deliberately not a fake force layout: nothing here should depend on positions.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref } from 'react'
import { SpineProvider, useSpine } from '@renderer/state/spine'
import { GraphView } from '../GraphView'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'

const { HASH_OF_EMPTY, engine } = vi.hoisted(() => ({
  HASH_OF_EMPTY: 'e3b0c44298fc1c14',
  /** The imperative handle GraphView drives, and a way to fire `onEngineStop`
   *  from a test — the settle never happens without a real simulation. */
  engine: { fits: 0, stop: null as null | (() => void) },
}))

vi.mock('react-force-graph-2d', async () => {
  const react = await vi.importActual<typeof import('react')>('react')
  return {
    default: react.forwardRef(
      (
        {
          graphData,
          onNodeClick,
          onBackgroundClick,
          onEngineStop,
        }: {
          graphData: { nodes: { id: string }[] }
          onNodeClick?: (node: unknown) => void
          onBackgroundClick?: () => void
          onEngineStop?: () => void
        },
        ref: Ref<unknown>,
      ) => {
        react.useImperativeHandle(ref, () => ({
          zoomToFit: () => {
            engine.fits += 1
          },
          zoom: () => 1,
          // Both the getter (`d3Force('charge')?.strength(…)`) and the setter
          // (`d3Force('halo', force)`) shapes, since the view uses each.
          d3Force: () => ({ strength: () => undefined, distance: () => undefined }),
        }))
        engine.stop = onEngineStop ?? null
        return (
          <div data-testid="force-canvas">
            <button type="button" data-testid="background" onClick={() => onBackgroundClick?.()} />
            {graphData.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                data-testid={`node:${node.id}`}
                onClick={() => onNodeClick?.(node)}
              />
            ))}
          </div>
        )
      },
    ),
  }
})

/**
 * Asymmetric on purpose, so a lens switch is observable and so one lens has
 * nothing to join on:
 *
 *   IP      — Star Wars covers p1 + p3; p2 is fringe.
 *   People  — Ada Vance covers p1 + p2; p3 is fringe.
 *   Offering— every title is distinct, so no hub at all.
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

/**
 * Descriptions stay empty on purpose: the enrichment index drops any entry whose
 * `description_hash` disagrees with the event's current description, so giving a
 * fixture event prose would silently strip its people and franchises and leave
 * the map with no hubs at all. What the card does with prose is EventCard's own
 * test; what matters here is which card is open.
 */
function event(uid: string, title: string): ScheduleEvent {
  return {
    uid,
    shortId: uid,
    title,
    start: '2026-07-23T10:00:00-07:00',
    end: '2026-07-23T11:00:00-07:00',
    track: 'PROGRAMS',
    subtypes: [],
    flags: [],
    room: 'Room 1',
    location: 'Room 1',
    description: '',
    url: null,
  }
}

const EVENTS = [event('p1', 'Panel One'), event('p2', 'Panel Two'), event('p3', 'Panel Three')]

/** Cards are identified by their close control rather than their contents —
 *  titles also appear in entity-card rows and node tooltips. */
const EVENT_CARD = 'Close event card'
const ENTITY_CARD = 'Close entity card'

const projection = (): DatasetProjection => ({
  events: EVENTS,
  changes: {},
  fetchedAt: '2026-07-18T00:00:00Z',
  stale: false,
})

beforeEach(() => {
  engine.fits = 0
  engine.stop = null
  ;(window as unknown as { api: unknown }).api = {
    schedule: { refresh: vi.fn(async () => projection()) },
    changes: { acknowledge: vi.fn(async () => ({})) },
    stars: { get: vi.fn(async () => []), set: vi.fn(async (n: unknown[]) => n) },
    export: { ics: vi.fn() },
  }
})

// Vitest runs without globals here, so testing-library's automatic cleanup is
// never registered — without this each test renders into the previous DOM.
afterEach(cleanup)

/** jsdom has no layout engine and no ResizeObserver, so the canvas host measures
 *  0 and the render guard keeps the graph unmounted. */
function sizeTheDom(): void {
  globalThis.ResizeObserver = class {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.cb([{ contentRect: { width: 1200, height: 800 } } as ResizeObserverEntry], this)
    }
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}

/** Exposes the spine so a test can set filter/lens/selection the way the rest of
 *  the app would, rather than reaching into the view. */
let spine: ReturnType<typeof useSpine>
function Probe() {
  spine = useSpine()
  return null
}

const mount = () =>
  render(
    <SpineProvider>
      <Probe />
      <GraphView />
    </SpineProvider>,
  )

const mountSized = async () => {
  sizeTheDom()
  const view = mount()
  await screen.findByTestId('force-canvas')
  return view
}

describe('GraphView — mounting (AE1)', () => {
  it('mounts straight to the map, with no seed prompt in the way', async () => {
    await mountSized()

    expect(screen.getByTestId('force-canvas')).toBeTruthy()
    expect(screen.queryByText('Start from something')).toBeNull()
  })

  it('draws hubs and every in-scope event, fringe included (AE5)', async () => {
    await mountSized()

    // The whole fixture corpus, unfiltered.
    await waitFor(() => expect(screen.getByTestId('node:ip:star-wars')).toBeTruthy())
    for (const uid of ['p1', 'p2', 'p3']) {
      expect(screen.getByTestId(`node:event:${uid}`)).toBeTruthy()
    }
    // p2 carries no franchise and is drawn anyway — R5 is presence, not hiding.
    expect(screen.getByTestId('map-counts').textContent).toBe('1 hub · 3 events · 1 unconnected')
  })

  it('says so rather than crashing when the filter matches nothing', async () => {
    await mountSized()
    act(() => spine.setFilter({ ...spine.filter, text: 'nothing matches this' }))

    await waitFor(() => expect(screen.queryByTestId('force-canvas')).toBeNull())
    expect(screen.getByText(/No events match the current filter/)).toBeTruthy()
  })
})

describe('GraphView — pinning (R7, AE3)', () => {
  it('pins a hub and opens the entity card, then dismisses on background click', async () => {
    await mountSized()
    fireEvent.click(await screen.findByTestId('node:ip:star-wars'))

    expect(await screen.findByText('Star Wars')).toBeTruthy()
    // Its two member events are listed.
    expect(screen.getByText('Panel One')).toBeTruthy()
    expect(screen.getByText('Panel Three')).toBeTruthy()

    fireEvent.click(screen.getByTestId('background'))

    await waitFor(() => expect(screen.queryByText('Star Wars')).toBeNull())
  })

  it('pins an event and opens the event card', async () => {
    await mountSized()
    fireEvent.click(await screen.findByTestId('node:event:p1'))

    expect(await screen.findByLabelText(EVENT_CARD)).toBeTruthy()
    expect(spine.selectedUid).toBe('p1')
  })

  it('keeps one card at a time — pinning a hub clears the event selection', async () => {
    await mountSized()
    fireEvent.click(await screen.findByTestId('node:event:p1'))
    await screen.findByLabelText(EVENT_CARD)

    fireEvent.click(screen.getByTestId('node:ip:star-wars'))

    await waitFor(() => expect(spine.selectedUid).toBeNull())
    expect(screen.queryByLabelText(EVENT_CARD)).toBeNull()
    expect(screen.getByLabelText(ENTITY_CARD)).toBeTruthy()
  })

  it('opens the event card for a selection that arrived from the list', async () => {
    await mountSized()
    act(() => spine.setSelectedUid('p1'))

    expect(await screen.findByLabelText(EVENT_CARD)).toBeTruthy()
  })

  it('re-pins to an event when a row inside the entity card is clicked', async () => {
    await mountSized()
    fireEvent.click(await screen.findByTestId('node:ip:star-wars'))
    await screen.findByText('Star Wars')

    fireEvent.click(screen.getByLabelText('Panel Three'))

    await waitFor(() => expect(spine.selectedUid).toBe('p3'))
    expect(screen.queryByLabelText(ENTITY_CARD)).toBeNull()
    expect(screen.getByLabelText(EVENT_CARD)).toBeTruthy()
  })
})

describe('GraphView — lens switching (R3, AE4)', () => {
  it('dismisses a pinned hub that the new lens does not draw', async () => {
    await mountSized()
    fireEvent.click(await screen.findByTestId('node:ip:star-wars'))
    await screen.findByText('Star Wars')

    // People has no Star Wars hub — Ada Vance is its only one.
    act(() => spine.setLens('people'))

    await waitFor(() => expect(screen.queryByText('Star Wars')).toBeNull())
    expect(await screen.findByTestId('node:person:ada vance')).toBeTruthy()
    // The event dots are untouched by the switch.
    expect(screen.getByTestId('node:event:p1')).toBeTruthy()
  })
})

describe('GraphView — the all-fringe scope', () => {
  it('names a lens that does have hubs when the current one has none', async () => {
    await mountSized()
    await screen.findByTestId('node:ip:star-wars')

    // Every fixture title is distinct, so no offering has a second sitting.
    act(() => spine.setLens('offering'))

    expect(await screen.findByText(/No Offering hubs here/)).toBeTruthy()
    // Both other lenses have exactly one hub over this scope.
    expect(screen.getByText(/IP has 1/)).toBeTruthy()
    // Still a map, not an empty state — every event is drawn as fringe.
    expect(screen.getByTestId('node:event:p1')).toBeTruthy()
  })
})

/**
 * Regression: the re-fit is armed by a scope change and consumed on engine stop.
 *
 * Arming off the `nodesChanged` boolean looks equivalent and is not — two filter
 * edits in a row both report `true`, React's dep check sees no change, and the
 * second edit never re-arms. The symptom is subtle enough to survive a manual
 * pass: the first filter edit frames correctly and every one after it lands at
 * the previous scope's zoom, which reads as "the graph is being weird" rather
 * than as a bug with a cause.
 */
describe('GraphView — re-fitting on scope change', () => {
  const settle = () => act(() => engine.stop?.())

  it('re-fits on every filter edit, not just the first', async () => {
    await mountSized()
    settle()
    const afterFirstMount = engine.fits
    expect(afterFirstMount).toBeGreaterThan(0)

    act(() => spine.setFilter({ ...spine.filter, text: 'Panel One' }))
    await waitFor(() => expect(screen.queryByTestId('node:event:p2')).toBeNull())
    settle()
    expect(engine.fits).toBe(afterFirstMount + 1)

    // The second consecutive edit is the one the boolean latch dropped.
    act(() => spine.setFilter({ ...spine.filter, text: 'Panel Two' }))
    await waitFor(() => expect(screen.queryByTestId('node:event:p1')).toBeNull())
    settle()
    expect(engine.fits).toBe(afterFirstMount + 2)
  })

  it('does not re-fit on a lens switch — the reorganization is the point (R3)', async () => {
    await mountSized()
    settle()
    const before = engine.fits

    act(() => spine.setLens('people'))
    await screen.findByTestId('node:person:ada vance')
    settle()

    expect(engine.fits).toBe(before)
  })
})

describe('GraphView — the filter is the scope (R2)', () => {
  it('re-derives the map when the filter moves, with no local scope state', async () => {
    await mountSized()
    await screen.findByTestId('node:event:p2')

    act(() => spine.setFilter({ ...spine.filter, text: 'Panel One' }))

    await waitFor(() => expect(screen.queryByTestId('node:event:p2')).toBeNull())
    expect(screen.getByTestId('node:event:p1')).toBeTruthy()
    // One event left, and nothing shares a franchise with itself.
    expect(screen.getByTestId('map-counts').textContent).toBe('0 hubs · 1 event · 1 unconnected')
    expect(screen.queryByTestId('node:ip:star-wars')).toBeNull()
  })
})
