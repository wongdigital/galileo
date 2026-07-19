import { describe, expect, it } from 'vitest'
import { joinEnrichment } from '../join'
import {
  ALL_EVENTS,
  fakeHash,
  FACET_MAP,
  GAMES_BLOCK,
  index,
  PANEL,
  UID_BLOCK,
  UID_PANEL,
  UID_REPEAT_A
} from './fixtures'

const opts = { hashDescription: fakeHash }

describe('joinEnrichment', () => {
  it('attaches people and franchises when the description has not moved', () => {
    const result = joinEnrichment([PANEL], index(), FACET_MAP, opts)
    const joined = result.byUid.get(UID_PANEL)!
    expect(joined.enrichment).toBe('enriched')
    expect(joined.people).toHaveLength(1)
    expect(joined.franchises).toHaveLength(1)
  })

  it('degrades people and IP when the description hash drifts, but keeps facets', () => {
    const rewritten = { ...PANEL, description: 'This description was rewritten after the compile.' }
    const result = joinEnrichment([rewritten], index(), FACET_MAP, opts)
    const joined = result.byUid.get(UID_PANEL)!

    expect(joined.enrichment).toBe('stale')
    expect(joined.people).toEqual([])
    expect(joined.franchises).toEqual([])

    // Facets come from the runtime tag table, so they survive the drift.
    expect(joined.facets.facets['genre']).toEqual(['comics', 'horror'])
    expect(joined.classification.eventClass).toBe('attend')
  })

  it('degrades an event that is absent from the index to facets-only', () => {
    const result = joinEnrichment(ALL_EVENTS, index(), FACET_MAP, opts)
    const joined = result.byUid.get(UID_REPEAT_A)!

    expect(joined.enrichment).toBe('not-enriched')
    expect(joined.people).toEqual([])
    expect(joined.facets.facets['format']).toEqual(['board-game'])
    expect(joined.facets.audienceBand).toBe('kids')
  })

  it('keeps "processed, found nothing" distinct from "never processed"', () => {
    const result = joinEnrichment([GAMES_BLOCK, ...ALL_EVENTS.slice(2)], index(), FACET_MAP, opts)
    // Present in the index with empty arrays.
    expect(result.byUid.get(UID_BLOCK)!.enrichment).toBe('enriched')
    // Not in the index at all.
    expect(result.byUid.get(UID_REPEAT_A)!.enrichment).toBe('not-enriched')
  })

  it('marks an entry the compiler could not extract as failed, not as a gap', () => {
    const withFailure = index({
      entries: {
        [UID_PANEL]: { status: 'errored', people: [], franchises: [] }
      }
    })
    const joined = joinEnrichment([PANEL], withFailure, FACET_MAP, opts).byUid.get(UID_PANEL)!
    expect(joined.enrichment).toBe('failed')
    expect(joined.facets.facets['genre']).toEqual(['comics', 'horror'])
  })

  it('treats an ok entry with no hash as drift rather than as a pass', () => {
    const noHash = index({
      entries: { [UID_PANEL]: { status: 'ok', people: [{ name: 'X', role: 'host' }], franchises: [] } }
    })
    const joined = joinEnrichment([PANEL], noHash, FACET_MAP, opts).byUid.get(UID_PANEL)!
    expect(joined.enrichment).toBe('stale')
    expect(joined.people).toEqual([])
  })

  it('runs with no index at all — the app works before the first compile', () => {
    const result = joinEnrichment(ALL_EVENTS, null, FACET_MAP, opts)
    expect(result.stats.enriched).toBe(0)
    expect(result.stats.notEnriched).toBe(ALL_EVENTS.length)
    for (const joined of result.byUid.values()) {
      expect(joined.classification.eventClass).toMatch(/attend|ambient/)
    }
    expect(result.byUid.get(UID_BLOCK)!.facets.facets['format']).toEqual(['board-game'])
  })

  it('builds offering clusters as part of the join', () => {
    const result = joinEnrichment(ALL_EVENTS, index(), FACET_MAP, opts)
    const key = result.byUid.get(UID_REPEAT_A)!.offeringKey
    expect(result.offerings.byKey.get(key)?.sessionCount).toBe(2)
  })

  it('reports coverage across the four states', () => {
    const stats = joinEnrichment(ALL_EVENTS, index(), FACET_MAP, opts).stats
    expect(stats.events).toBe(ALL_EVENTS.length)
    expect(stats.enriched).toBe(2)
    expect(stats.notEnriched).toBe(ALL_EVENTS.length - 2)
    expect(stats.coverage).toBeCloseTo(2 / ALL_EVENTS.length)
  })

  it('passes the classifier’s duration to the facet validator so the two agree', () => {
    const joined = joinEnrichment([GAMES_BLOCK], index(), FACET_MAP, opts).byUid.get(UID_BLOCK)!
    expect(joined.classification.durationMinutes).toBe(360)
    expect(joined.facets.computed.durationBand).toBe('block')
    expect(joined.facets.validationMismatches).toContainEqual(
      expect.objectContaining({ tag: '45 Minutes', computed: '360' })
    )
  })
})
