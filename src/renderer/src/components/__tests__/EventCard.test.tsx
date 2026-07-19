// @vitest-environment jsdom

/**
 * The card's contract, exercised through the real spine rather than a mock —
 * the star path is only interesting *because* it round-trips through
 * echo-back, and a stubbed `toggleStar` would assert nothing about R10.
 *
 * The two scenarios worth reading first are the vanished-UID pair: a starred
 * UID that left the feed has to render its snapshot, and an unstarred one has
 * to hand the pin back to the host. Both come straight from the identity
 * learning (docs/solutions/2026-07-18-uid-is-the-identity-key.md) — events do
 * leave without a CANCELLED flag first.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventCard } from '../EventCard'
import { SpineProvider } from '@renderer/state/spine'
import { useSchedule } from '@renderer/state/useSchedule'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'
import type { StarRecord } from '@shared/stars'

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

const PANEL = event('panel', {
  title: 'Drawing Monsters for a Living',
  room: 'Room 6DE',
  description: 'Four working horror artists on inking teeth.\n\nModerated by nobody in particular.',
})

interface Api {
  schedule: { refresh: ReturnType<typeof vi.fn> }
  changes: { acknowledge: ReturnType<typeof vi.fn> }
  stars: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }
  export: { ics: ReturnType<typeof vi.fn> }
}

let api: Api

function projection(partial: Partial<DatasetProjection> = {}): DatasetProjection {
  return {
    events: [PANEL],
    changes: {},
    fetchedAt: '2026-07-20T18:00:00.000Z',
    stale: false,
    ...partial,
  }
}

/** Mirrors what the 5-day view derives, so "the list agrees" is asserted
 *  against the real selector rather than against the card's own state. */
function RowProbe() {
  const { rows } = useSchedule()
  return (
    <div data-testid="rows">
      {rows.map((row) => (
        <span key={row.uid} data-testid={`row-${row.uid}`}>
          {row.starred ? 'starred' : 'unstarred'}
        </span>
      ))}
    </div>
  )
}

async function mountCard(
  uid: string,
  options: { onDismiss?: () => void; probe?: boolean } = {},
): Promise<void> {
  await act(async () => {
    render(
      <SpineProvider>
        <EventCard uid={uid} onDismiss={options.onDismiss ?? (() => {})} />
        {options.probe ? <RowProbe /> : null}
      </SpineProvider>,
    )
  })
  await waitFor(() => expect(api.schedule.refresh).toHaveBeenCalled())
}

beforeEach(() => {
  api = {
    schedule: { refresh: vi.fn().mockResolvedValue(projection()) },
    changes: { acknowledge: vi.fn().mockResolvedValue({}) },
    stars: { get: vi.fn().mockResolvedValue([]), set: vi.fn() },
    export: { ics: vi.fn() },
  }
  api.stars.set.mockImplementation((stars: StarRecord[]) => Promise.resolve(stars))
  ;(window as unknown as { api: Api }).api = api
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as unknown as { api?: Api }).api
})

describe('a live event', () => {
  it('shows title, time, room, and the description prose', async () => {
    await mountCard('panel')

    expect(await screen.findByText('Drawing Monsters for a Living')).toBeTruthy()
    expect(screen.getByText('10:00a')).toBeTruthy()
    expect(screen.getByText('Room 6DE')).toBeTruthy()
    expect(screen.getByText(/inking teeth/)).toBeTruthy()
  })

  it('stars through the spine and adopts what main echoed back', async () => {
    await mountCard('panel')
    const star = await screen.findByRole('button', { name: 'Star Drawing Monsters for a Living' })

    await act(async () => {
      fireEvent.click(star)
    })

    expect(api.stars.set).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: 'Unstar Drawing Monsters for a Living' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('pops the star back off when the write did not land', async () => {
    await mountCard('panel')
    // A store that echoes an empty list is what a read-only disk looks like.
    api.stars.set.mockResolvedValueOnce([])

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^Star / }))
    })

    expect(screen.getByRole('button', { name: /^Star / })).toBeTruthy()
  })

  it('badges the diff engine states, including one Sched never flagged', async () => {
    api.schedule.refresh.mockResolvedValue(
      projection({
        changes: {
          panel: [
            {
              uid: 'panel',
              kind: 'moved-room',
              from: 'Room 5AB',
              to: 'Room 6DE',
              detectedAt: '2026-07-21T09:00:00.000Z',
            },
          ],
        },
      }),
    )
    await mountCard('panel')

    // The event carries no Sched flag at all; MOVED exists only in the diff.
    expect(await screen.findByText('MOVED')).toBeTruthy()
  })

  it('omits the prose region entirely when the description is empty', async () => {
    api.schedule.refresh.mockResolvedValue(
      projection({ events: [event('bare', { title: 'Bare Panel', description: '   ' })] }),
    )
    await mountCard('bare')

    expect(await screen.findByText('Bare Panel')).toBeTruthy()
    expect(screen.queryByTestId('event-description')).toBeNull()
  })

  it('dismisses on the close control without touching the pin itself', async () => {
    const onDismiss = vi.fn()
    await mountCard('panel', { onDismiss })

    fireEvent.click(await screen.findByRole('button', { name: 'Close event card' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('a UID the feed no longer carries', () => {
  it('renders the star snapshot as a ghost, marked as gone', async () => {
    api.stars.get.mockResolvedValue([
      {
        uid: 'vanished',
        title: 'Secret Screening',
        start: `${SAT}T20:00:00-07:00`,
        room: 'Hall H',
        starredAt: 'then',
      },
    ])
    const onDismiss = vi.fn()
    await mountCard('vanished', { onDismiss })

    expect(await screen.findByText('Secret Screening')).toBeTruthy()
    expect(screen.getByText('8:00p')).toBeTruthy()
    expect(screen.getByText('Hall H')).toBeTruthy()
    expect(screen.getByText(/NO LONGER LISTED/)).toBeTruthy()
    // The plan is still a plan — the card stays until the user closes it.
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('unstars a ghost by UID alone, with no live event to hand', async () => {
    api.stars.get.mockResolvedValue([
      { uid: 'vanished', title: 'Secret Screening', start: null, room: '', starredAt: 'then' },
    ])
    await mountCard('vanished')

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Unstar Secret Screening' }))
    })

    expect(api.stars.set).toHaveBeenCalledWith([])
  })

  it('hands an unstarred vanished UID back to the host instead of throwing', async () => {
    const onDismiss = vi.fn()
    await mountCard('nobody', { onDismiss })

    await waitFor(() => expect(onDismiss).toHaveBeenCalled())
    expect(screen.queryByText(/NO LONGER LISTED/)).toBeNull()
  })
})

describe('cross-surface state (R10)', () => {
  it('starring from the card updates the list row in the same pass', async () => {
    await mountCard('panel', { probe: true })
    await waitFor(() => expect(screen.getByTestId('row-panel').textContent).toBe('unstarred'))

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^Star / }))
    })

    expect(screen.getByTestId('row-panel').textContent).toBe('starred')
  })
})
