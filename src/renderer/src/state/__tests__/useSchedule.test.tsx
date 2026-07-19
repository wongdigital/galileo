// @vitest-environment jsdom

/**
 * Layer 1 is shared across hook instances.
 *
 * The sidebar, the list, and the entity map each mount their own `useSchedule`,
 * and the corpus pass — `classifyAll` plus `applyFacets` over every event — is
 * the app's expensive derivation. Per-instance memos would run it once per
 * mount, and again per instance on every dataset swap. The module-level cache
 * keyed on the events array is what makes N instances cost one pass, and these
 * tests assert it the only way that cannot rot: object identity (`toBe`)
 * between what two independent instances return.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpineProvider } from '../spine'
import { useSchedule, type ScheduleModel } from '../useSchedule'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'

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
  ;(window as unknown as { api: unknown }).api = {
    schedule: { refresh: vi.fn(async () => projection()) },
    changes: { acknowledge: vi.fn(async () => ({})) },
    stars: { get: vi.fn(async () => []), set: vi.fn(async (n: unknown[]) => n) },
    export: { ics: vi.fn() },
  }
})

afterEach(cleanup)

describe('useSchedule — the shared corpus pass', () => {
  it('hands two instances the same Layer-1 derivation, by identity', async () => {
    let first: ScheduleModel | undefined
    let second: ScheduleModel | undefined

    function First() {
      first = useSchedule()
      return null
    }
    function Second() {
      second = useSchedule()
      return null
    }

    await act(async () => {
      render(
        <SpineProvider>
          <First />
          <Second />
        </SpineProvider>,
      )
    })
    await waitFor(() => expect(first?.byUid.size).toBe(2))

    // `toBe`, not `toEqual`: equal-but-distinct maps would mean the corpus
    // pass ran twice, which is exactly the regression.
    expect(second?.byUid).toBe(first?.byUid)
    expect(second?.classes).toBe(first?.classes)
    expect(second?.facetsByUid).toBe(first?.facetsByUid)
    expect(second?.candidates).toBe(first?.candidates)
  })
})
