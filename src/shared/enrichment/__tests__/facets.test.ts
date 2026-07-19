import { describe, expect, it } from 'vitest'
import {
  applyFacets,
  audienceBandForMinAge,
  buildReviewBucket,
  computeBuilding,
  computeDay,
  computeDurationBand,
  computeTimeBand,
  supportsAge,
  supportsPlayers
} from '../facets'
import { ALL_EVENTS, event, FACET_MAP, GAMES_BLOCK, ODDTAG, PANEL } from './fixtures'

describe('curated dimensions', () => {
  it('maps tags onto their dimensions', () => {
    const f = applyFacets(PANEL, FACET_MAP)
    expect(f.facets['genre']).toEqual(['comics', 'horror'])
    expect(f.facets['format']).toEqual(['workshop'])
    expect(f.facets['audience']).toEqual(['teens'])
  })

  it('folds the feed’s spelling variants onto one value', () => {
    const a = applyFacets(event('a', { subtypes: ['Horror and Suspense'] }), FACET_MAP)
    const b = applyFacets(event('b', { subtypes: ['Horror/Suspense'] }), FACET_MAP)
    expect(a.facets['genre']).toEqual(b.facets['genre'])
  })

  it('leaves a dimension absent rather than empty when nothing maps to it', () => {
    const f = applyFacets(event('x', { subtypes: [] }), FACET_MAP)
    expect(f.facets['genre']).toBeUndefined()
  })
})

describe('audience bands', () => {
  it('normalizes the age-tag mess into four bands', () => {
    const band = (tag: string) =>
      applyFacets(event('x', { subtypes: [tag] }), FACET_MAP).audienceBand
    expect(band('Kids')).toBe('all-ages')
    expect(band('Ages 7+')).toBe('kids')
    expect(band('8+')).toBe('kids')
    expect(band('10+')).toBe('kids')
    expect(band('13+')).toBe('teens')
    expect(band('18+')).toBe('adults')
  })

  it('draws the band boundaries at 7, 13, and 18', () => {
    expect(audienceBandForMinAge(0)).toBe('all-ages')
    expect(audienceBandForMinAge(6)).toBe('all-ages')
    expect(audienceBandForMinAge(7)).toBe('kids')
    expect(audienceBandForMinAge(12)).toBe('kids')
    expect(audienceBandForMinAge(13)).toBe('teens')
    expect(audienceBandForMinAge(17)).toBe('teens')
    expect(audienceBandForMinAge(18)).toBe('adults')
  })

  it('takes the strictest floor when an event carries two age tags', () => {
    const f = applyFacets(event('x', { subtypes: ['8+', '13+'] }), FACET_MAP)
    expect(f.age).toEqual({ min: 13, max: null })
    expect(f.audienceBand).toBe('teens')
  })

  it('answers "can I bring a 9-year-old" exactly, not by band', () => {
    const teen = applyFacets(event('x', { subtypes: ['13+'] }), FACET_MAP)
    expect(supportsAge(teen, 9)).toBe(false)
    expect(supportsAge(teen, 14)).toBe(true)

    const kids = applyFacets(event('x', { subtypes: ['Kids'] }), FACET_MAP)
    expect(supportsAge(kids, 9)).toBe(true)
    expect(supportsAge(kids, 30)).toBe(false)
  })

  it('lets an event with no age tag through — no stated floor means no floor', () => {
    expect(supportsAge(applyFacets(PANEL, FACET_MAP), 4)).toBe(false)
    expect(supportsAge(applyFacets(event('x'), FACET_MAP), 4)).toBe(true)
  })
})

describe('player counts', () => {
  it('matches a works-for-3 query and rejects works-for-6', () => {
    const f = applyFacets(GAMES_BLOCK, FACET_MAP)
    expect(f.players).toEqual({ min: 2, max: 4 })
    expect(supportsPlayers(f, 3)).toBe(true)
    expect(supportsPlayers(f, 6)).toBe(false)
  })

  it('includes the bounds themselves', () => {
    const f = applyFacets(GAMES_BLOCK, FACET_MAP)
    expect(supportsPlayers(f, 2)).toBe(true)
    expect(supportsPlayers(f, 4)).toBe(true)
    expect(supportsPlayers(f, 1)).toBe(false)
  })

  it('unions the range when an event lists two configurations', () => {
    const f = applyFacets(event('x', { subtypes: ['2-4 Players', '2-5 players'] }), FACET_MAP)
    expect(f.players).toEqual({ min: 2, max: 5 })
  })

  it('excludes events with no player count — a panel is not a wrong-sized game', () => {
    expect(supportsPlayers(applyFacets(PANEL, FACET_MAP), 3)).toBe(false)
  })
})

describe('the review bucket', () => {
  it('surfaces an unmapped tag on the event rather than dropping it', () => {
    const f = applyFacets(ODDTAG, FACET_MAP)
    expect(f.unmappedTags).toEqual(['Nonexistent Studios LLC'])
    // The mapped tag on the same event still landed.
    expect(f.facets['genre']).toEqual(['comics'])
  })

  it('tallies unmapped tags across the corpus with examples to review', () => {
    const bucket = buildReviewBucket(ALL_EVENTS, FACET_MAP)
    const row = bucket.find((r) => r.tag === 'Nonexistent Studios LLC')
    expect(row?.count).toBe(1)
    expect(row?.exampleUids).toEqual([ODDTAG.uid])
  })

  it('reports nothing when every tag is mapped', () => {
    expect(buildReviewBucket([PANEL], FACET_MAP)).toEqual([])
  })

  it('sorts the bucket by how often the tag appears', () => {
    const events = [
      event('a', { subtypes: ['Rare Tag'] }),
      event('b', { subtypes: ['Common Tag'] }),
      event('c', { subtypes: ['Common Tag'] })
    ]
    expect(buildReviewBucket(events, FACET_MAP).map((r) => r.tag)).toEqual([
      'Common Tag',
      'Rare Tag'
    ])
  })
})

describe('computed dimensions', () => {
  it('reads the local date off the feed’s own offset, not the host timezone', () => {
    expect(computeDay(PANEL)).toBe('2026-07-23')
  })

  it('buckets a past-midnight event to the previous day only when asked', () => {
    const e = event('x', { start: '2026-07-25T00:30:00-07:00' })
    expect(computeDay(e)).toBe('2026-07-25')
    expect(computeDay(e, { nightOwlCutoffHour: 4 })).toBe('2026-07-24')
  })

  it('bands the clock into four parts', () => {
    const at = (t: string) => computeTimeBand(event('x', { start: `2026-07-23T${t}-07:00` }))
    expect(at('09:00:00')).toBe('morning')
    expect(at('13:00:00')).toBe('afternoon')
    expect(at('19:00:00')).toBe('evening')
    expect(at('22:00:00')).toBe('late-night')
    expect(at('01:00:00')).toBe('late-night')
  })

  it('bands duration where the corpus clusters', () => {
    expect(computeDurationBand(15)).toBe('short')
    expect(computeDurationBand(50)).toBe('standard')
    expect(computeDurationBand(120)).toBe('long')
    expect(computeDurationBand(360)).toBe('block')
    expect(computeDurationBand(null)).toBeNull()
  })

  it('derives the building from the room string', () => {
    const at = (room: string) => computeBuilding(event('x', { room }))
    expect(at('Hall H')).toBe('convention-center')
    expect(at('Room 25ABC')).toBe('convention-center')
    expect(at('Pacific 21, Marriott Marquis San Diego Marina')).toBe('marriott')
    expect(at('Indigo Ballroom, Hilton San Diego Bayfront')).toBe('hilton')
    expect(at('Omni Grand Ballroom DE, 4th Floor')).toBe('omni')
    expect(at('Shiley Special Events Suite, San Diego Central Library')).toBe('library')
  })
})

describe('validation dimensions', () => {
  it('never lets a validation tag into the filterable facets', () => {
    const f = applyFacets(GAMES_BLOCK, FACET_MAP, { durationMinutes: 360 })
    expect(f.facets['duration_hint']).toBeUndefined()
    expect(f.facets['venue_hint']).toBeUndefined()
  })

  it('reports the games track tagging a 6h block as 45 minutes', () => {
    const f = applyFacets(GAMES_BLOCK, FACET_MAP, { durationMinutes: 360 })
    const mismatch = f.validationMismatches.find((m) => m.dimension === 'duration_hint')
    expect(mismatch).toMatchObject({ tag: '45 Minutes', claimed: '45', computed: '360' })
  })

  it('stays silent when the tag agrees with the computed value', () => {
    const e = event('x', { subtypes: ['Marriott Programs'], room: 'Grand 2, Marriott Marquis' })
    expect(applyFacets(e, FACET_MAP).validationMismatches).toEqual([])
  })

  it('flags a venue tag that contradicts the room', () => {
    const e = event('x', { subtypes: ['Marriott Programs'], room: 'Hall H' })
    expect(applyFacets(e, FACET_MAP).validationMismatches).toMatchObject([
      { dimension: 'venue_hint', claimed: 'marriott', computed: 'convention-center' }
    ])
  })
})
