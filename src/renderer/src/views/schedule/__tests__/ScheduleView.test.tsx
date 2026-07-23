// @vitest-environment jsdom

/**
 * The 5-day view's half of R11: the list hosts the shared card, and hosts it
 * off `selectedUid` — the selection the rows were already toggling.
 *
 * What is worth asserting here is only the hosting. The card's own contract
 * (ghosts, badges, empty descriptions) is covered next to the component, and
 * the list's rows and virtualizer are covered in App.integration.test.tsx.
 * These tests exist to catch the wiring between the two: a card that never
 * mounts, a card that outlives its selection, and a star crossing from card to
 * row without a re-render in between.
 *
 * Fixtures are synthetic for the same reason the integration suite's are — the
 * live corpus carries Sched-authored prose and stays out of git.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScheduleView } from '../ScheduleView'
import { SpineProvider, useSpine } from '@renderer/state/spine'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'
import type { StarRecord } from '@shared/stars'
import { clearFakeBridge, installFakeBridge, type FakePlatformBridge } from '../../../test/fakeBridge'

/** The hosted card loads the enrichment index for its metadata sections; an
 *  empty index keeps the 1.2 MB live file out of the suite. */
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
    entries: {},
  },
}))

const SAT = '2026-07-25'

function event(uid: string, partial: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    uid,
    shortId: null,
    title: `Event ${uid}`,
    start: `${SAT}T10:00:00-07:00`,
    end: `${SAT}T10:50:00-07:00`,
    track: '1: PROGRAMS',
    subtypes: ['Comics'],
    flags: [],
    room: 'Room 5AB',
    location: 'Room 5AB',
    description: '',
    url: null,
    ...partial,
  }
}

const MONSTERS = event('horror-sat', {
  title: 'Drawing Monsters for a Living',
  subtypes: ['Horror and Suspense'],
  room: 'Room 6DE',
  description: 'Four working horror artists on inking teeth.',
})

const INKING = event('comics-sat', {
  title: 'Inking Techniques Workshop',
  start: `${SAT}T12:00:00-07:00`,
  end: `${SAT}T12:50:00-07:00`,
  description: 'Brush versus nib, settled at last.',
})

const EVENTS = [MONSTERS, INKING]

let api: FakePlatformBridge

function projection(partial: Partial<DatasetProjection> = {}): DatasetProjection {
  return {
    events: EVENTS,
    changes: {},
    fetchedAt: '2026-07-20T18:00:00.000Z',
    stale: false,
    ...partial,
  }
}

/**
 * jsdom reports every element as zero-sized and has no ResizeObserver, so a
 * virtualizer left to its own devices measures a viewport of 0 and renders no
 * rows at all. Same stub the integration suite uses, and for the same reason:
 * without it the list under test is not the list the user sees.
 */
function giveTheDomASize(): void {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  for (const [property, value] of [
    ['offsetHeight', 900],
    ['offsetWidth', 800],
    ['clientHeight', 900],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get: () => value,
    })
  }
}

/** Stands in for the map: the graph pins by writing the same spine field a row
 *  click writes, so a button that does only that is a faithful stunt double. */
function GraphStandIn({ uid }: { uid: string }) {
  const { setSelectedUid } = useSpine()
  return (
    <button type="button" onClick={() => setSelectedUid(uid)}>
      pin from the map
    </button>
  )
}

async function mount(options: { standInFor?: string } = {}) {
  const view = render(
    <SpineProvider>
      <ScheduleView />
      {options.standInFor ? <GraphStandIn uid={options.standInFor} /> : null}
    </SpineProvider>,
  )
  await waitFor(() => expect(screen.getByText('Drawing Monsters for a Living')).toBeTruthy())
  return view
}

/** The card is the only `<aside>` the view renders. */
const card = (): HTMLElement | null => document.querySelector('aside')

/** A row by its title — the list's copy of a title, never the card's. */
function row(title: string): HTMLElement {
  const found = [...document.querySelectorAll('[role="button"]')].find(
    (el) => el.textContent?.includes(title),
  )
  return found as HTMLElement
}

beforeEach(() => {
  giveTheDomASize()
  api = installFakeBridge({
    schedule: { refresh: vi.fn().mockResolvedValue(projection()) },
    changes: { acknowledge: vi.fn().mockResolvedValue({}) },
    stars: { get: vi.fn().mockResolvedValue([]), set: vi.fn() },
  })
  // Mirrors the real store: persist, then echo back what is on disk.
  api.stars.set.mockImplementation((stars: StarRecord[]) => Promise.resolve(stars))
})

afterEach(() => {
  // testing-library only auto-cleans with vitest globals on, and this suite
  // runs without them.
  cleanup()
  vi.restoreAllMocks()
  clearFakeBridge()
})

describe('the card over the list (AE6)', () => {
  it('opens on a row click, naming the event and showing its prose', async () => {
    await mount()
    expect(card()).toBeNull()

    await act(async () => {
      fireEvent.click(row('Drawing Monsters for a Living'))
    })

    const panel = card()!
    expect(panel).toBeTruthy()
    expect(within(panel).getByText('Drawing Monsters for a Living')).toBeTruthy()
    expect(within(panel).getByText(/inking teeth/)).toBeTruthy()
    expect(within(panel).getByText('Room 6DE')).toBeTruthy()
  })

  it('closes again when the same row deselects', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(row('Drawing Monsters for a Living'))
    })
    expect(card()).toBeTruthy()

    await act(async () => {
      fireEvent.click(row('Drawing Monsters for a Living'))
    })
    expect(card()).toBeNull()
  })

  it('swaps contents when a second row takes the selection', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(row('Drawing Monsters for a Living'))
    })
    await act(async () => {
      fireEvent.click(row('Inking Techniques Workshop'))
    })

    const panel = card()!
    expect(within(panel).getByText(/Brush versus nib/)).toBeTruthy()
    expect(within(panel).queryByText(/inking teeth/)).toBeNull()
  })

  it('dismisses from the card without leaving the row selected', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(row('Drawing Monsters for a Living'))
    })

    await act(async () => {
      fireEvent.click(within(card()!).getByRole('button', { name: 'Close event card' }))
    })

    expect(card()).toBeNull()
    // Selection and card are the same fact (R7) — the row is unselected too.
    expect(row('Drawing Monsters for a Living').className).toContain('border-l-transparent')
  })
})

describe('selection arriving from the other view', () => {
  it('shows the card for a uid the map pinned, with no row click involved', async () => {
    await mount({ standInFor: 'comics-sat' })
    expect(card()).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'pin from the map' }))
    })

    // Same spine field, so the list needs no plumbing of its own to honour it.
    expect(within(card()!).getByText('Inking Techniques Workshop')).toBeTruthy()
    expect(row('Inking Techniques Workshop').className).toContain('border-l-lumen')
  })
})

describe('starring across the two surfaces', () => {
  it('updates the row in place when the star is toggled from the card', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(row('Drawing Monsters for a Living'))
    })
    expect(
      within(row('Drawing Monsters for a Living')).getByRole('button', { name: /^Star / }),
    ).toBeTruthy()

    await act(async () => {
      fireEvent.click(within(card()!).getByRole('button', { name: /^Star / }))
    })

    await waitFor(() =>
      expect(
        within(row('Drawing Monsters for a Living')).getByRole('button', { name: /^Unstar / }),
      ).toBeTruthy(),
    )
    // The card stays open — starring is not a dismissal.
    expect(card()).toBeTruthy()
  })
})
