// @vitest-environment jsdom

/**
 * End-to-end over the renderer: real filter engine, real facet table, real
 * derivation, real components — only the IPC bridge is faked.
 *
 * These are the U5 scenarios that only exist once the pieces are assembled.
 * Each pure part is already tested next to itself; what this file catches is
 * the wiring between them, which is where a filtered set that never reaches the
 * list or a star that never reaches the row would hide.
 *
 * Fixtures are synthetic. The live corpus carries Sched-authored prose and
 * stays out of git (see U1), so committed tests invent their own events using
 * the real tag vocabulary.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'
import type { StarRecord } from '@shared/stars'

/** The event card loads the enrichment index for its metadata sections; an
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
const SUN = '2026-07-26'

function event(uid: string, partial: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    uid,
    shortId: null,
    title: `Event ${uid}`,
    start: `${SAT}T10:00:00-07:00`,
    end: `${SAT}T10:50:00-07:00`,
    track: '1: PROGRAMS',
    subtypes: [],
    flags: [],
    room: 'Room 5AB',
    location: 'Room 5AB',
    description: '',
    url: null,
    ...partial,
  }
}

/** Horror on Saturday — the canonical filter example's target. */
const HORROR_SAT = event('horror-sat', {
  title: 'Drawing Monsters for a Living',
  subtypes: ['Horror and Suspense'],
})

/**
 * Horror on Sunday — matches the interest, sits on another day. Sunday rather
 * than Friday so Saturday remains the first day with results, which is the day
 * `resolveActiveDay` opens on.
 */
const HORROR_SUN = event('horror-sun', {
  title: 'Night Terrors After Dark',
  subtypes: ['Horror/Suspense'],
  start: `${SUN}T20:00:00-07:00`,
  end: `${SUN}T21:00:00-07:00`,
})

/** Comics on Saturday — right day, wrong interest. */
const COMICS_SAT = event('comics-sat', {
  title: 'Inking Techniques Workshop',
  subtypes: ['Comics'],
})

/** Six hours on the Games track: ambient, so it belongs on the shelf. */
const AMBIENT_SAT = event('ambient-sat', {
  title: 'Open Table Gaming',
  track: '6: GAMES',
  subtypes: ['Board'],
  start: `${SAT}T10:00:00-07:00`,
  end: `${SAT}T16:00:00-07:00`,
  room: 'Pacific Ballroom, Marriott Marquis San Diego Marina',
})

const EVENTS = [HORROR_SAT, HORROR_SUN, COMICS_SAT, AMBIENT_SAT]

function projection(partial: Partial<DatasetProjection> = {}): DatasetProjection {
  return {
    events: EVENTS,
    changes: {},
    fetchedAt: '2026-07-20T18:00:00.000Z',
    stale: false,
    ...partial,
  }
}

let persisted: StarRecord[] = []
let refresh: ReturnType<typeof vi.fn>

/**
 * jsdom reports every element as zero-sized and has no ResizeObserver, so a
 * virtualizer left to its own devices measures a viewport of 0 and renders no
 * rows at all. Giving elements a real size is what makes the list under test
 * the list the user sees.
 *
 * `offsetHeight` specifically: virtual-core measures the scroll element with
 * offsetWidth/offsetHeight, and jsdom hardcodes those to 0 with no layout
 * engine behind them.
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

beforeEach(() => {
  giveTheDomASize()
  persisted = []
  refresh = vi.fn().mockResolvedValue(projection())
  ;(window as unknown as { api: unknown }).api = {
    schedule: { refresh },
    changes: { acknowledge: vi.fn().mockResolvedValue({}) },
    stars: {
      get: vi.fn(() => Promise.resolve(persisted)),
      // Mirrors the real store: persist, then echo back what is on disk.
      set: vi.fn((stars: StarRecord[]) => {
        persisted = stars
        return Promise.resolve(persisted)
      }),
    },
    export: { ics: vi.fn() },
  }
})

afterEach(() => {
  // Explicit: testing-library only auto-cleans when vitest globals are on, and
  // this suite runs without them. Without it every render stacks up in the
  // document and queries start matching the previous test's DOM.
  cleanup()
  vi.restoreAllMocks()
  delete (window as unknown as { api?: unknown }).api
})

async function mount() {
  const view = render(<App />)
  await waitFor(() => expect(screen.getByText('Drawing Monsters for a Living')).toBeTruthy())
  return view
}

const sidebar = (): HTMLElement => document.querySelector('aside') as HTMLElement
const mainPane = (): HTMLElement => document.querySelector('main') as HTMLElement

/** The sidebar chip for a facet value, found by its rendered label. Venue,
 *  time, and audience live behind "More filters", so open it on demand. */
function chip(label: string): HTMLElement {
  const match = new RegExp(`^${label}`)
  const found = within(sidebar()).queryAllByRole('button', { name: match })[0]
  if (found) return found
  fireEvent.click(within(sidebar()).getByText('More filters'))
  return within(sidebar()).getAllByRole('button', { name: match })[0]!
}

/** Row titles in list order. The title is the first truncating span in a row. */
const rowTitles = (): string[] =>
  [...mainPane().querySelectorAll('[role="button"]')]
    .map((el) => el.querySelector('.truncate')?.textContent ?? '')
    .filter(Boolean)

describe('filtering', () => {
  it('narrows to Horror ∩ Saturday, shows the chips, and restores on clear', async () => {
    await mount()
    // Saturday is the default active day, so all three Saturday events show:
    // two rows plus the ambient block on its shelf.
    expect(screen.getByText('Inking Techniques Workshop')).toBeTruthy()

    await act(async () => {
      fireEvent.click(chip('Horror'))
    })

    expect(screen.queryByText('Inking Techniques Workshop')).toBeNull()
    expect(screen.getByText('Drawing Monsters for a Living')).toBeTruthy()

    // The active chip is echoed at the top of the sidebar as a removable pill.
    expect(within(sidebar()).getAllByText('Horror').length).toBeGreaterThan(1)

    await act(async () => {
      fireEvent.click(within(sidebar()).getByText('Clear all filters'))
    })
    expect(screen.getByText('Inking Techniques Workshop')).toBeTruthy()
  })

  it('unions two interests instead of intersecting them', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(chip('Horror'))
    })
    expect(rowTitles()).not.toContain('Inking Techniques Workshop')

    await act(async () => {
      fireEvent.click(chip('Comics'))
    })
    // Adding a second interest shows more, not fewer. Nothing here is both.
    expect(rowTitles()).toContain('Drawing Monsters for a Living')
    expect(rowTitles()).toContain('Inking Techniques Workshop')
  })

  it('keeps ambient events off the list and on a collapsed shelf', async () => {
    await mount()
    expect(rowTitles()).not.toContain('Open Table Gaming')

    const shelf = screen.getByRole('button', { name: /Open all day/ })
    expect(shelf).toBeTruthy()
    expect(screen.queryByText('Open Table Gaming')).toBeNull()

    await act(async () => {
      fireEvent.click(shelf)
    })
    expect(screen.getByText('Open Table Gaming')).toBeTruthy()
  })
})

describe('zero results', () => {
  /**
   * Reached through the search box rather than a second chip, and that is not a
   * test convenience: facet counts are computed under the rest of the active
   * filter, so a value that would return nothing is never offered as a chip in
   * the first place. Free text and the starred toggle are the inputs that can
   * actually empty the list.
   */
  it('names every active input and clears them in one click', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(chip('Horror'))
    })
    await act(async () => {
      fireEvent.change(sidebar().querySelector('input[type="search"]')!, {
        target: { value: 'nothing matches this' },
      })
    })

    expect(within(mainPane()).getByText(/Nothing matches/)).toBeTruthy()
    expect(within(mainPane()).getByText('Genre: Horror')).toBeTruthy()
    // Twice over: once in the sentence naming the filter, once as the
    // relaxation offering to drop it.
    expect(within(mainPane()).getAllByText('"nothing matches this"').length).toBe(2)

    await act(async () => {
      fireEvent.click(within(mainPane()).getByText('Clear all filters'))
    })
    expect(screen.getByText('Drawing Monsters for a Living')).toBeTruthy()
  })

  it('offers a relaxation carrying the count it will actually deliver', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(chip('Horror'))
    })
    await act(async () => {
      fireEvent.change(sidebar().querySelector('input[type="search"]')!, {
        target: { value: 'nothing matches this' },
      })
    })

    const hint = within(mainPane())
      .getAllByRole('button')
      .find((b) => /\+\d/.test(b.textContent ?? ''))
    expect(hint?.textContent).toContain('"nothing matches this"')
    // One horror event on Saturday, one on Sunday — dropping the text recovers
    // both, and the engine says so by re-running rather than estimating.
    expect(hint?.textContent).toContain('+2')

    await act(async () => {
      fireEvent.click(hint!)
    })
    expect(within(mainPane()).queryByText(/Nothing matches/)).toBeNull()
    expect(rowTitles()).toContain('Drawing Monsters for a Living')
  })
})

describe('starring', () => {
  it('persists through the bridge and survives a remount — the restart case', async () => {
    const { unmount } = await mount()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Star Drawing Monsters/ }))
    })
    await waitFor(() => expect(persisted.map((s) => s.uid)).toEqual(['horror-sat']))
    expect(persisted[0]).toMatchObject({ title: 'Drawing Monsters for a Living', room: 'Room 5AB' })

    unmount()
    await mount()
    // A fresh mount reads the store, exactly as a cold start does.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Unstar Drawing Monsters/ })).toBeTruthy()
    )
  })

  it('filters to starred only', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Star Drawing Monsters/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Starred' }))
    })
    expect(rowTitles()).toEqual(['Drawing Monsters for a Living'])
  })
})

describe('ghost stars', () => {
  it('renders a starred event that left the feed instead of dropping it', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Star Drawing Monsters/ }))
    })

    // Sched pulls the event. Under the old tooling this is where the plan
    // silently stops existing.
    refresh.mockResolvedValueOnce(
      projection({ events: EVENTS.filter((e) => e.uid !== 'horror-sat') })
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })

    await waitFor(() => expect(screen.getByText('No longer in the schedule')).toBeTruthy())
    // Still named, from the star's own display-only snapshot.
    expect(screen.getByText('Drawing Monsters for a Living')).toBeTruthy()
    expect(screen.getByText(/starred, then pulled from the feed/)).toBeTruthy()
  })

  it('clears a ghost by UID, with no live event to hand', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Star Drawing Monsters/ }))
    })
    refresh.mockResolvedValueOnce(
      projection({ events: EVENTS.filter((e) => e.uid !== 'horror-sat') })
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })
    await waitFor(() => expect(screen.getByText('No longer in the schedule')).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    })
    await waitFor(() => expect(screen.queryByText('No longer in the schedule')).toBeNull())
    expect(persisted).toEqual([])
  })
})

describe('change flags', () => {
  it('flags a moved row and says what moved', async () => {
    await mount()
    refresh.mockResolvedValueOnce(
      projection({
        events: [{ ...HORROR_SAT, room: 'Room 26AB' }, ...EVENTS.slice(1)],
        changes: {
          'horror-sat': [
            {
              uid: 'horror-sat',
              kind: 'moved-room',
              from: 'Room 5AB',
              to: 'Room 26AB',
              detectedAt: '2026-07-21T09:00:00.000Z',
            },
          ],
        },
      })
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })

    await waitFor(() => expect(screen.getByText('MOVED')).toBeTruthy())
    expect(screen.getByText('· was Room 5AB')).toBeTruthy()
  })

  it('keeps a star on the moved event and its selection intact', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Star Drawing Monsters/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Drawing Monsters for a Living'))
    })

    refresh.mockResolvedValueOnce(
      projection({
        events: [{ ...HORROR_SAT, room: 'Room 26AB' }, ...EVENTS.slice(1)],
        changes: {
          'horror-sat': [
            {
              uid: 'horror-sat',
              kind: 'moved-room',
              to: 'Room 26AB',
              detectedAt: '2026-07-21T09:00:00.000Z',
            },
          ],
        },
      })
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })

    // Star follows the UID, not the room; the selection readout still names it.
    //
    // Two of each now: the row and the event card the selection opens over it
    // both carry the badge, the star, and the new room. That duplication is the
    // point rather than an accident — the card reads the same `buildRow` state
    // the row does, so the two can never disagree (R10).
    await waitFor(() => expect(screen.getAllByText('MOVED')).toHaveLength(2))
    expect(screen.getAllByRole('button', { name: /^Unstar Drawing Monsters/ })).toHaveLength(2)
    expect(screen.getAllByText('Room 26AB')).toHaveLength(2)
  })

  it('is loud about a starred event being cancelled', async () => {
    await mount()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Star Drawing Monsters/ }))
    })

    refresh.mockResolvedValueOnce(
      projection({ events: [{ ...HORROR_SAT, flags: ['CANCELLED'] }, ...EVENTS.slice(1)] })
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })

    await waitFor(() => expect(screen.getByText('CANCELLED')).toBeTruthy())
    const row = screen.getByText('Drawing Monsters for a Living').closest('[role="button"]')!
    // The loud treatment is a full-row band, not just a badge — this is a plan
    // that stopped being a plan (AE4).
    expect(row.className).toContain('bg-cancelled/10')
  })
})

describe('refresh failure', () => {
  it('shows a stale banner over an intact list', async () => {
    await mount()
    refresh.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })

    expect(screen.getByText(/Refresh failed/)).toBeTruthy()
    // The list is still there — never a blank app.
    expect(screen.getByText('Drawing Monsters for a Living')).toBeTruthy()
  })

  it('offers the accept-anyway override when the drift guard held data back', async () => {
    refresh.mockResolvedValue(
      projection({
        stale: true,
        warning: {
          ok: false,
          reason: 'low-join-rate',
          detail: 'join rate 12%',
          stats: { eventCount: 3474, joinedWithListView: 417, joinRate: 0.12 },
        },
      })
    )
    await mount()

    expect(screen.getByText(/New data looks wrong/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept new data anyway' }))
    })
    expect(refresh).toHaveBeenLastCalledWith({ acceptAnyway: true })
  })
})
