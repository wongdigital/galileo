// @vitest-environment jsdom

/**
 * The enrichment loading window, held open.
 *
 * The people/franchise index arrives through a dynamic import, and until it
 * resolves the IP and People lens indexes are *empty*, not measured. The
 * all-fringe overlay must not read that emptiness as a finding: "No IP hubs
 * here — nothing in this scope shares one" over a scope whose hubs appear two
 * seconds later is misinformation, and a user who believed it and left for
 * Genre was steered away from the very lens they were on.
 *
 * This lives in its own file because the hold is a module-level mock — the
 * import never resolves, so `indexReady` never flips — and the main GraphView
 * suite needs the opposite: enrichment resolved, hubs drawn.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref } from 'react'
import { SpineProvider } from '@renderer/state/spine'
import { GraphView } from '../GraphView'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'
import type { StarRecord } from '@shared/stars'
import { clearFakeBridge, installFakeBridge } from '../../../test/fakeBridge'

// A promise that never settles: the loading window, made permanent.
vi.mock('@data/enrichment.json', () => new Promise<never>(() => {}))

vi.mock('react-force-graph-2d', async () => {
  const react = await vi.importActual<typeof import('react')>('react')
  return {
    default: react.forwardRef((_props: unknown, ref: Ref<unknown>) => {
      react.useImperativeHandle(ref, () => ({
        centerAt: () => {},
        zoom: () => 1,
        d3Force: () => ({ strength: () => undefined, distance: () => undefined }),
        pauseAnimation: () => undefined,
        resumeAnimation: () => undefined,
      }))
      return <div data-testid="force-canvas" />
    }),
  }
})

/** Both events share the Comics subtype, so the *facets* lens has a hub over
 *  this scope (`genre:comics`, degree 2). That is what makes this a regression
 *  test rather than a tautology: with an alternative lens available, the
 *  ungated overlay would have rendered "No IP hubs here — Genre has 1" the
 *  moment the canvas mounted. */
function event(uid: string, title: string): ScheduleEvent {
  return {
    uid,
    shortId: uid,
    title,
    start: '2026-07-23T10:00:00-07:00',
    end: '2026-07-23T11:00:00-07:00',
    track: 'PROGRAMS',
    subtypes: ['Comics'],
    flags: [],
    room: 'Room 1',
    location: 'Room 1',
    description: '',
    url: null,
  }
}

const projection = (): DatasetProjection => ({
  events: [event('p1', 'Panel One'), event('p2', 'Panel Two')],
  changes: {},
  fetchedAt: '2026-07-18T00:00:00Z',
  stale: false,
})

beforeEach(() => {
  installFakeBridge({
    schedule: { refresh: vi.fn(async () => projection()) },
    changes: { acknowledge: vi.fn(async () => ({})) },
    stars: { get: vi.fn(async () => []), set: vi.fn(async (n: StarRecord[]) => n) },
    export: { ics: vi.fn() },
  })
  globalThis.ResizeObserver = class {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(): void {
      this.cb([{ contentRect: { width: 1200, height: 800 } } as ResizeObserverEntry], this)
    }
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  cleanup()
  clearFakeBridge()
})

describe('GraphView — before the enrichment index has loaded', () => {
  it('narrates the load instead of asserting the scope shares nothing', async () => {
    render(
      <SpineProvider>
        <GraphView />
      </SpineProvider>,
    )

    // The map itself mounts — events and the deterministic lenses do not wait
    // for enrichment.
    await screen.findByTestId('force-canvas')
    expect(await screen.findByText('loading people and franchises…')).toBeTruthy()

    // The claim the overlay must not make yet, about any lens.
    expect(screen.queryByText(/hubs here — nothing in this scope shares one/)).toBeNull()
  })
})
