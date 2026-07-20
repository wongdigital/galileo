import { describe, expect, it } from 'vitest'
import { buildCandidate } from '../candidate'
import { applyFacets } from '../../enrichment/facets'
import { classifyEvent } from '../../enrichment/classes'
import { FACET_MAP, GAMES_BLOCK, PANEL } from '../../enrichment/__tests__/fixtures'
import { matchesFilter } from '../engine'
import { EMPTY_FILTER, MATCH_EVERYTHING } from '../types'

function build(event: typeof PANEL) {
  const classification = classifyEvent(event)
  return buildCandidate({
    event,
    facets: applyFacets(event, FACET_MAP, {
      durationMinutes: classification.durationMinutes,
    }),
    classification,
  })
}

describe('buildCandidate', () => {
  it('carries the curated facet dimensions through under their own ids', () => {
    const c = build(PANEL)
    expect(c.dimensions['genre']).toContain('horror')
    expect(c.dimensions['audience']).toEqual(['teens'])
  })

  it('fills the computed dimensions from the event, never from a tag', () => {
    // The games block is tagged "45 Minutes" while running six hours. The
    // duration dimension has to report the block, or the filter tells you a
    // five-hour open table is a short commitment.
    const c = build(GAMES_BLOCK)
    expect(c.dimensions['duration']).toEqual(['block'])
    expect(c.dimensions['venue']).toEqual(['marriott'])
    expect(c.dimensions['day']).toEqual(['2026-07-24'])
  })

  it('carries the exact room verbatim, so "Hall H" is a real chip', () => {
    // Room is the precise seat, distinct from venue (the building) — the only
    // way to scope to one room without a text match that leaks across rooms.
    expect(build(PANEL).dimensions['room']).toEqual(['Room 5AB'])
  })

  it('strips the sort prefix off the track so chips read as "GAMES"', () => {
    expect(build(GAMES_BLOCK).dimensions['track']).toEqual(['GAMES'])
  })

  it('leaves ip and person empty until the compiled index reaches the caller', () => {
    const c = build(PANEL)
    expect(c.dimensions['ip']).toBeUndefined()
    expect(c.dimensions['person']).toBeUndefined()
  })

  it('populates ip and person when extractions are supplied', () => {
    const classification = classifyEvent(PANEL)
    const c = buildCandidate({
      event: PANEL,
      facets: applyFacets(PANEL, FACET_MAP, {
        durationMinutes: classification.durationMinutes,
      }),
      people: [{ name: 'A. Nonymous', role: 'panelist' }],
      franchises: [{ surface_text: 'Mando', canonical: 'star-wars' }],
    })
    expect(c.dimensions['ip']).toEqual(['star-wars'])
    expect(c.dimensions['person']).toEqual(['A. Nonymous'])
  })

  it('builds a lowercase haystack spanning title, room, tags and description', () => {
    const c = build(PANEL)
    expect(c.haystack).toContain('drawing monsters')
    expect(c.haystack).toContain('room 5ab')
    expect(c.haystack).toContain('monster design')
    expect(matchesFilter(c, { ...EMPTY_FILTER, text: 'MONSTER' }, MATCH_EVERYTHING)).toBe(true)
  })
})
