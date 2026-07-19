// @vitest-environment jsdom

/**
 * The spine's two failure contracts, which are behaviour rather than shape and
 * so cannot be asserted from the pure modules:
 *
 * - a failed refresh leaves the previous dataset exactly where it is (the list
 *   stays usable under a stale banner, never blanks), and
 * - a star write is adopted from what main echoes back, not from what the
 *   renderer optimistically set.
 */

import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpineProvider, useSpine, type SpineState } from '../spine'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'
import type { StarRecord } from '@shared/stars'

function event(uid: string, partial: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    uid,
    shortId: null,
    title: `Event ${uid}`,
    start: '2026-07-25T10:00:00-07:00',
    end: '2026-07-25T10:50:00-07:00',
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

function projection(partial: Partial<DatasetProjection> = {}): DatasetProjection {
  return {
    events: [event('a'), event('b')],
    changes: {},
    fetchedAt: '2026-07-20T18:00:00.000Z',
    stale: false,
    ...partial,
  }
}

interface Api {
  schedule: { refresh: ReturnType<typeof vi.fn> }
  changes: { acknowledge: ReturnType<typeof vi.fn> }
  stars: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }
  export: { ics: ReturnType<typeof vi.fn> }
}

let api: Api
let spine: SpineState

function Probe() {
  spine = useSpine()
  return null
}

async function mount() {
  await act(async () => {
    render(
      <SpineProvider>
        <Probe />
      </SpineProvider>
    )
  })
  await waitFor(() => expect(spine.status).toBe('ready'))
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
  vi.restoreAllMocks()
  delete (window as unknown as { api?: Api }).api
})

describe('initial load', () => {
  it('fetches once and adopts the dataset and the persisted stars', async () => {
    api.stars.get.mockResolvedValue([
      { uid: 'a', title: 'Event a', start: null, room: '', starredAt: 'then' },
    ])
    await mount()

    expect(api.schedule.refresh).toHaveBeenCalledTimes(1)
    expect(spine.dataset?.events).toHaveLength(2)
    await waitFor(() => expect(spine.stars.map((s) => s.uid)).toEqual(['a']))
  })
})

describe('refresh failure mid-session', () => {
  it('keeps the previous dataset on screen and reports the error', async () => {
    await mount()
    expect(spine.dataset?.events).toHaveLength(2)

    api.schedule.refresh.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'))
    await act(async () => {
      await spine.refresh()
    })

    // The list is intact — a failed refresh must never blank the app.
    expect(spine.dataset?.events).toHaveLength(2)
    expect(spine.refreshError).toContain('ENOTFOUND')
    expect(spine.status).toBe('ready')
  })

  it('clears the error once a later refresh succeeds', async () => {
    await mount()
    api.schedule.refresh.mockRejectedValueOnce(new Error('offline'))
    await act(async () => {
      await spine.refresh()
    })
    expect(spine.refreshError).not.toBeNull()

    await act(async () => {
      await spine.refresh()
    })
    expect(spine.refreshError).toBeNull()
  })

  it('passes the accept-anyway override through to main', async () => {
    await mount()
    await act(async () => {
      await spine.refresh({ acceptAnyway: true })
    })
    expect(api.schedule.refresh).toHaveBeenLastCalledWith({ acceptAnyway: true })
  })

  it('preserves the selection across a refresh, keyed by UID', async () => {
    await mount()
    act(() => spine.setSelectedUid('b'))

    api.schedule.refresh.mockResolvedValueOnce(
      projection({ events: [event('b', { room: 'Room 9' }), event('c')] })
    )
    await act(async () => {
      await spine.refresh()
    })

    expect(spine.selectedUid).toBe('b')
  })
})

describe('star echo-back', () => {
  it('adopts the list main persisted rather than its own optimistic one', async () => {
    await mount()
    // Main normalizes; the renderer must show what came back, not what it sent.
    api.stars.set.mockResolvedValueOnce([
      { uid: 'a', title: 'Event a', start: null, room: 'Normalized by main', starredAt: 'server' },
    ])

    await act(async () => {
      await spine.toggleStar(event('a'))
    })

    expect(spine.stars).toEqual([
      { uid: 'a', title: 'Event a', start: null, room: 'Normalized by main', starredAt: 'server' },
    ])
    expect(spine.starError).toBeNull()
  })

  it('surfaces a write that silently did not land', async () => {
    await mount()
    // The store echoing back a list without the new star is exactly what a
    // read-only disk looks like. It has to be visible now, not at restart.
    api.stars.set.mockResolvedValueOnce([])

    await act(async () => {
      await spine.toggleStar(event('a'))
    })

    expect(spine.stars).toEqual([])
    expect(spine.starError).toContain('did not save')
  })

  it('falls back to the on-disk list when the write throws', async () => {
    await mount()
    api.stars.set.mockRejectedValueOnce(new Error('EROFS: read-only file system'))
    api.stars.get.mockResolvedValueOnce([
      { uid: 'b', title: 'Event b', start: null, room: '', starredAt: 'earlier' },
    ])

    await act(async () => {
      await spine.toggleStar(event('a'))
    })

    expect(spine.starError).toContain('EROFS')
    expect(spine.stars.map((s) => s.uid)).toEqual(['b'])
  })

  it('unstars a ghost by UID alone, with no live event to hand', async () => {
    await mount()
    await act(async () => {
      await spine.toggleStar(event('a'))
    })
    expect(spine.stars.map((s) => s.uid)).toEqual(['a'])

    await act(async () => {
      await spine.removeStar('a')
    })
    expect(spine.stars).toEqual([])
  })

  it('keeps a star attached to its UID across a refresh that moved the event', async () => {
    await mount()
    await act(async () => {
      await spine.toggleStar(event('a'))
    })

    api.schedule.refresh.mockResolvedValueOnce(
      projection({
        events: [event('a', { room: 'Room 26AB' })],
        changes: {
          a: [
            {
              uid: 'a',
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
      await spine.refresh()
    })

    expect(spine.stars.map((s) => s.uid)).toEqual(['a'])
    expect(spine.dataset?.changes['a']?.[0]?.kind).toBe('moved-room')
    // The star's snapshot still says Room 5AB and that is correct: it records
    // what was starred. The live room comes from the dataset, never from here.
    expect(spine.stars[0]?.room).toBe('Room 5AB')
  })
})

describe('acknowledge', () => {
  it('adopts the surviving log main returns', async () => {
    await mount()
    api.changes.acknowledge.mockResolvedValueOnce({ b: [] })

    await act(async () => {
      await spine.acknowledge(['a'])
    })

    expect(api.changes.acknowledge).toHaveBeenCalledWith(['a'])
    expect(spine.dataset?.changes).toEqual({ b: [] })
  })

  it('does not call main for an empty list', async () => {
    await mount()
    await act(async () => {
      await spine.acknowledge([])
    })
    expect(api.changes.acknowledge).not.toHaveBeenCalled()
  })
})
