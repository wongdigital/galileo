// @vitest-environment jsdom

/**
 * AE3's second half: a hub's card lists what the hub contains, each row stars
 * in place, and a row click re-pins that event rather than closing the panel.
 *
 * The "stars without dismissing" assertion is the load-bearing one. Starring a
 * row is a write to the spine, which re-renders the card from the top — if the
 * card ever conflated a state change with a dismissal, this is where it shows.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntityCard } from '../EntityCard'
import { SpineProvider } from '@renderer/state/spine'
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

const MORNING = event('morning', { title: 'Inking Techniques Workshop' })
const EVENING = event('evening', {
  title: 'Night Terrors After Dark',
  start: `${SAT}T20:00:00-07:00`,
  end: `${SAT}T21:00:00-07:00`,
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
    // Deliberately out of chronological order: the card sorts, the feed does not.
    events: [EVENING, MORNING],
    changes: {},
    fetchedAt: '2026-07-20T18:00:00.000Z',
    stale: false,
    ...partial,
  }
}

async function mountCard(
  memberUids: string[],
  handlers: { onSelectEvent?: (uid: string) => void; onDismiss?: () => void } = {},
): Promise<void> {
  await act(async () => {
    render(
      <SpineProvider>
        <EntityCard
          label="Marvel"
          memberUids={memberUids}
          onSelectEvent={handlers.onSelectEvent ?? (() => {})}
          onDismiss={handlers.onDismiss ?? (() => {})}
        />
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

describe('the member list', () => {
  it('names the entity, counts what is in scope, and lists the rows in time order', async () => {
    await mountCard(['evening', 'morning'])

    expect(await screen.findByText('Marvel')).toBeTruthy()
    expect(screen.getByText('2 events')).toBeTruthy()

    const titles = screen
      .getAllByRole('button')
      .map((node) => node.getAttribute('aria-label'))
      .filter((label): label is string => !!label && !label.startsWith('Star ') && !label.startsWith('Close '))
    expect(titles).toEqual(['Inking Techniques Workshop', 'Night Terrors After Dark'])
    expect(screen.getByText('10:00a')).toBeTruthy()
    expect(screen.getByText('8:00p')).toBeTruthy()
  })

  it('drops a member UID that no longer resolves rather than rendering a blank row', async () => {
    await mountCard(['morning', 'gone'])

    expect(await screen.findByText('1 event')).toBeTruthy()
    expect(screen.getByText('Inking Techniques Workshop')).toBeTruthy()
  })

  it('says so when nothing in scope survives', async () => {
    await mountCard(['gone'])
    expect(await screen.findByText('No events left in scope.')).toBeTruthy()
  })
})

describe('row interaction (AE3)', () => {
  it('stars a row in place, leaving the card open', async () => {
    const onDismiss = vi.fn()
    await mountCard(['morning', 'evening'], { onDismiss })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Star Inking Techniques Workshop' }))
    })

    expect(api.stars.set).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: 'Unstar Inking Techniques Workshop' }).getAttribute('aria-pressed'),
    ).toBe('true')
    // Still the same card, same rows, nobody asked the host to close it.
    expect(screen.getByText('Marvel')).toBeTruthy()
    expect(screen.getByText('Night Terrors After Dark')).toBeTruthy()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('does not re-pin when the click landed on the star', async () => {
    const onSelectEvent = vi.fn()
    await mountCard(['morning'], { onSelectEvent })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Star Inking Techniques Workshop' }))
    })

    expect(onSelectEvent).not.toHaveBeenCalled()
  })

  it('hands the UID back to the host when a row is clicked', async () => {
    const onSelectEvent = vi.fn()
    await mountCard(['morning', 'evening'], { onSelectEvent })

    fireEvent.click(await screen.findByRole('button', { name: 'Night Terrors After Dark' }))
    expect(onSelectEvent).toHaveBeenCalledWith('evening')
  })

  it('re-pins from the keyboard too', async () => {
    const onSelectEvent = vi.fn()
    await mountCard(['morning'], { onSelectEvent })

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Inking Techniques Workshop' }), {
      key: 'Enter',
    })
    expect(onSelectEvent).toHaveBeenCalledWith('morning')
  })
})

describe('dismissal', () => {
  it('asks the host to close, and does nothing else', async () => {
    const onDismiss = vi.fn()
    await mountCard(['morning'], { onDismiss })

    fireEvent.click(await screen.findByRole('button', { name: 'Close entity card' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
