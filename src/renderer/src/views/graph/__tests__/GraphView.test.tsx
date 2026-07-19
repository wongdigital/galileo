// @vitest-environment jsdom

/**
 * A smoke render of the view itself, with the canvas stubbed.
 *
 * The force canvas is feel-tested, not asserted — but everything around it is
 * ordinary React that can break in ordinary ways, and "the graph tab throws" is
 * not something to discover at the con. So: does it mount, does the no-seed
 * prompt appear instead of an empty canvas, does clicking a candidate seed it,
 * and does the zero-edge hint name a lens that actually has edges.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpineProvider } from '@renderer/state/spine'
import { GraphView } from '../GraphView'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'

const { HASH_OF_EMPTY } = vi.hoisted(() => ({ HASH_OF_EMPTY: 'e3b0c44298fc1c14' }))

// force-graph draws to a real canvas and reads layout boxes; neither exists
// here, and neither is what this test is about.
vi.mock('react-force-graph-2d', () => ({
  default: () => <div data-testid="force-canvas" />,
}))

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
        franchises: [],
      },
      p2: {
        status: 'ok',
        description_hash: HASH_OF_EMPTY,
        people: [{ name: 'Ada Vance', role: 'panelist' }],
        franchises: [],
      },
    },
  },
}))

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

const EVENTS = [event('p1', 'Panel One'), event('p2', 'Panel Two')]

const projection = (): DatasetProjection => ({
  events: EVENTS,
  changes: {},
  fetchedAt: '2026-07-18T00:00:00Z',
  stale: false,
})

beforeEach(() => {
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

/**
 * jsdom has no layout engine and no ResizeObserver, so the canvas host measures
 * 0 and the render guard keeps the graph unmounted. Only the test that asserts
 * the canvas mounts needs this; the rest are about the surrounding chrome.
 */
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

const mount = () =>
  render(
    <SpineProvider>
      <GraphView />
    </SpineProvider>,
  )

describe('GraphView', () => {
  it('shows the seed prompt rather than an empty canvas', async () => {
    mount()
    expect(await screen.findByText('Start from something')).toBeTruthy()
    expect(screen.queryByTestId('force-canvas')).toBeNull()
  })

  it('seeds from a candidate and shows the seed with a star control', async () => {
    mount()
    fireEvent.click(await screen.findByText('Panel One'))

    await waitFor(() => expect(screen.getByLabelText('Star Panel One')).toBeTruthy())
    expect(screen.queryByText('Start from something')).toBeNull()
  })

  /**
   * Regression: seeding from the prompt left a permanently blank canvas.
   *
   * The canvas host does not exist while the prompt is up, so a size effect
   * keyed on a ref *object* ran once against `null` and never again — the ref's
   * identity never changes. Seeding mounted the canvas with nothing measuring
   * it, width stayed 0, and the render guard held the graph unmounted while the
   * toolbar cheerfully reported "showing 24 of 65".
   *
   * Asserting the prompt disappears is not enough; that passed throughout. The
   * assertion has to be that the graph *appears*.
   */
  it('mounts the canvas after seeding, not just dismisses the prompt', async () => {
    sizeTheDom()
    mount()
    expect(screen.queryByTestId('force-canvas')).toBeNull()

    fireEvent.click(await screen.findByText('Panel One'))

    await waitFor(() => expect(screen.getByTestId('force-canvas')).toBeTruthy())
  })

  it('points a zero-edge seed at the lens that does have edges', async () => {
    mount()
    // IP is the opening lens and neither fixture event carries a franchise, so
    // the seed lands alone and the hint has to offer People.
    fireEvent.click(await screen.findByText('Panel One'))

    // The people lens only has data once the compiled index resolves, so the
    // hint upgrades from "no other lens either" to a route out.
    await waitFor(() =>
      expect(screen.getByText(/No IP connections/).textContent).toContain('People has 1'),
    )
  })
})
