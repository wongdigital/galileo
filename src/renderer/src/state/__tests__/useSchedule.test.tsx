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
import type { StarRecord } from '@shared/stars'
import { clearFakeBridge, installFakeBridge } from '../../test/fakeBridge'

/** sha256('') truncated to 16 hex chars — the fixture events carry empty
 *  descriptions, so this is the hash the staleness pass must agree with. */
const { HASH_OF_EMPTY } = vi.hoisted(() => ({ HASH_OF_EMPTY: 'e3b0c44298fc1c14' }))

// A tiny synthetic index instead of the 1.2 MB compiled one, mirroring the
// useEntityMap suite. p1 carries a person and a franchise so the tests can see
// the enrichment join land in the candidate dimensions.
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
})

afterEach(() => {
  cleanup()
  clearFakeBridge()
})

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
    // Wait past the async enrichment join on both instances — the base swaps
    // identity once when the index resolves, and comparing across that swap
    // would race it.
    const personDims = (model?: ScheduleModel) =>
      model?.candidates.find((c) => c.uid === 'p1')?.dimensions.person
    await waitFor(() => {
      expect(personDims(first)).toEqual(['Ada Vance'])
      expect(personDims(second)).toEqual(['Ada Vance'])
    })

    // `toBe`, not `toEqual`: equal-but-distinct maps would mean the corpus
    // pass ran twice, which is exactly the regression.
    expect(second?.byUid).toBe(first?.byUid)
    expect(second?.classes).toBe(first?.classes)
    expect(second?.facetsByUid).toBe(first?.facetsByUid)
    expect(second?.candidates).toBe(first?.candidates)
  })

  it('joins the compiled index into the person and ip dimensions', async () => {
    let model: ScheduleModel | undefined
    function Probe() {
      model = useSchedule()
      return null
    }

    await act(async () => {
      render(
        <SpineProvider>
          <Probe />
        </SpineProvider>,
      )
    })

    // The join is what makes "events with <person>" resolvable as a chip — in
    // the Filters tab and in the chat's chip resolution alike.
    await waitFor(() => {
      const p1 = model?.candidates.find((c) => c.uid === 'p1')
      expect(p1?.dimensions.person).toEqual(['Ada Vance'])
      expect(p1?.dimensions.ip).toEqual(['star-wars'])
    })
    // An event without an index entry simply carries no person/ip values.
    const p2 = model?.candidates.find((c) => c.uid === 'p2')
    expect(p2?.dimensions.person).toBeUndefined()
    expect(p2?.dimensions.ip).toBeUndefined()
  })
})
