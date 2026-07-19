/**
 * Guards the committed `data/facet-map.json` itself. The table is hand-curated
 * and will be hand-edited between compiles, so the invariants that make it
 * trustworthy are asserted here rather than assumed.
 */

import { describe, expect, it } from 'vitest'
import facetMapJson from '../../../../data/facet-map.json'
import { audienceBandForMinAge, type FacetMap } from '../facets'

const map = facetMapJson as unknown as FacetMap

const dimensionIds = new Set(map.dimensions.map((d) => d.id))

describe('data/facet-map.json', () => {
  it('declares every dimension its tags reference', () => {
    for (const [tag, facets] of Object.entries(map.tags)) {
      for (const facet of facets) {
        const dimension = facet.slice(0, facet.indexOf(':'))
        expect(dimensionIds, `tag "${tag}" -> ${facet}`).toContain(dimension)
      }
    }
  })

  it('covers the curated dimensions the plan calls for', () => {
    for (const id of ['genre', 'format', 'audience', 'community', 'players']) {
      expect(dimensionIds).toContain(id)
    }
  })

  it('keeps venue, time band, and duration as validation-only', () => {
    for (const id of ['venue_hint', 'timeband_hint', 'duration_hint']) {
      expect(map.dimensions.find((d) => d.id === id)?.kind).toBe('validation')
    }
  })

  it('sorts every audience tag into exactly four bands', () => {
    const bands = new Set<string>()
    for (const facets of Object.values(map.tags)) {
      for (const facet of facets) {
        if (facet.startsWith('audience:')) bands.add(facet.slice('audience:'.length))
      }
    }
    expect([...bands].sort()).toEqual(['adults', 'all-ages', 'kids', 'teens'])
  })

  /**
   * The band in the table and the numeric floor in `ranges` are two statements
   * about the same tag. If they ever disagree, a filter chip and a "works for a
   * 9-year-old" query would answer differently about the same event.
   */
  it('agrees with its own numeric ranges about which band a tag belongs to', () => {
    for (const [tag, facets] of Object.entries(map.tags)) {
      const declared = facets.find((f) => f.startsWith('audience:'))?.slice('audience:'.length)
      if (!declared) continue
      const age = map.ranges[tag]?.age
      expect(age, `tag "${tag}" claims a band but has no age range`).toBeDefined()
      expect(audienceBandForMinAge(age!.min), `tag "${tag}"`).toBe(declared)
    }
  })

  it('gives every player-count tag a usable range', () => {
    for (const [tag, facets] of Object.entries(map.tags)) {
      if (!facets.includes('players:supported')) continue
      const players = map.ranges[tag]?.players
      expect(players, `tag "${tag}"`).toBeDefined()
      expect(players!.min).toBeGreaterThan(0)
      if (players!.max !== null) expect(players!.max).toBeGreaterThanOrEqual(players!.min)
    }
  })

  it('never files a numeric range under a tag it does not map', () => {
    for (const tag of Object.keys(map.ranges)) {
      expect(map.tags[tag], `range for unmapped tag "${tag}"`).toBeDefined()
    }
  })

  it('parses the feed’s inconsistent spellings of the same tag', () => {
    // Both casings of the player count, and both spacings of the duration.
    expect(map.tags['2-5 players']).toEqual(map.tags['2-5 Players'])
    expect(map.tags['45Minutes']).toEqual(map.tags['45 Minutes'])
    expect(map.tags['30 minutes']).toEqual(map.tags['30 Minutes'])
  })
})
