import { describe, expect, it } from 'vitest'
import {
  addChip,
  applyFilter,
  describeFilter,
  facetOptions,
  filteredUids,
  isEmptyFilter,
  matchesFilter,
  relaxations,
  removeChip,
  toggleChip,
} from '../engine'
import { EMPTY_FILTER, MATCH_EVERYTHING, dimensionKind, type FilterState } from '../types'
import { ALL, COMICS_SAT, HORROR_FRI, HORROR_SAT, STARWARS_SAT, candidate } from './fixtures'

const filter = (partial: Partial<FilterState> = {}): FilterState => ({ ...EMPTY_FILTER, ...partial })

describe('dimension registry', () => {
  it('classifies the interest and constraint dimensions the plan names', () => {
    expect(dimensionKind('genre')).toBe('interest')
    expect(dimensionKind('ip')).toBe('interest')
    expect(dimensionKind('person')).toBe('interest')
    expect(dimensionKind('day')).toBe('constraint')
    expect(dimensionKind('venue')).toBe('constraint')
    expect(dimensionKind('duration')).toBe('constraint')
    expect(dimensionKind('time')).toBe('constraint')
    expect(dimensionKind('audience')).toBe('constraint')
  })

  it('treats an unknown dimension as a constraint so it can only narrow', () => {
    expect(dimensionKind('invented-by-a-future-chat-compiler')).toBe('constraint')
  })
})

describe('interests union, constraints intersect', () => {
  it('is the canonical example: (Horror ∪ Star Wars) ∩ Saturday', () => {
    const state = filter({
      chips: [
        { dimension: 'genre', value: 'horror' },
        { dimension: 'ip', value: 'star-wars' },
        { dimension: 'day', value: '2026-07-25' },
      ],
    })
    expect(filteredUids(ALL, state, MATCH_EVERYTHING)).toEqual([HORROR_SAT.uid, STARWARS_SAT.uid])
  })

  it('unions two interests rather than intersecting them', () => {
    const state = filter({
      chips: [
        { dimension: 'genre', value: 'horror' },
        { dimension: 'ip', value: 'star-wars' },
      ],
    })
    // Intersecting would return nothing: no fixture is both.
    expect(filteredUids(ALL, state, MATCH_EVERYTHING)).toEqual([
      HORROR_SAT.uid,
      HORROR_FRI.uid,
      STARWARS_SAT.uid,
    ])
  })

  it('intersects across constraint dimensions', () => {
    const state = filter({
      chips: [
        { dimension: 'day', value: '2026-07-25' },
        { dimension: 'venue', value: 'convention-center' },
      ],
    })
    expect(filteredUids(ALL, state, MATCH_EVERYTHING)).toEqual([HORROR_SAT.uid, STARWARS_SAT.uid])
  })

  it('unions within a single constraint dimension — Saturday or Friday, not both at once', () => {
    const state = filter({
      chips: [
        { dimension: 'day', value: '2026-07-25' },
        { dimension: 'day', value: '2026-07-24' },
      ],
    })
    expect(filteredUids(ALL, state, MATCH_EVERYTHING)).toHaveLength(4)
  })

  it('applies a negated constraint as an exclusion', () => {
    const state = filter({ chips: [{ dimension: 'venue', value: 'marriott', negated: true }] })
    expect(filteredUids(ALL, state, MATCH_EVERYTHING)).not.toContain(HORROR_FRI.uid)
    expect(filteredUids(ALL, state, MATCH_EVERYTHING)).toHaveLength(3)
  })

  it('conjoins several negations in one dimension instead of ORing them', () => {
    const state = filter({
      chips: [
        { dimension: 'venue', value: 'marriott', negated: true },
        { dimension: 'venue', value: 'hilton', negated: true },
      ],
    })
    expect(filteredUids(ALL, state, MATCH_EVERYTHING)).toEqual([HORROR_SAT.uid, STARWARS_SAT.uid])
  })

  it('matches everything when no filter is active', () => {
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true)
    expect(applyFilter(ALL, EMPTY_FILTER, MATCH_EVERYTHING)).toHaveLength(4)
  })
})

describe('non-chip inputs', () => {
  it('matches free text case-insensitively against the haystack', () => {
    expect(filteredUids(ALL, filter({ text: 'monsters' }), MATCH_EVERYTHING)).toEqual([
      HORROR_SAT.uid,
    ])
    expect(filteredUids(ALL, filter({ text: '  MONSTERS ' }), MATCH_EVERYTHING)).toEqual([
      HORROR_SAT.uid,
    ])
  })

  it('narrows to starred and to changed via the context, not the candidate', () => {
    const ctx = {
      isStarred: (uid: string) => uid === HORROR_FRI.uid,
      hasUnseenChanges: (uid: string) => uid === COMICS_SAT.uid,
    }
    expect(filteredUids(ALL, filter({ starredOnly: true }), ctx)).toEqual([HORROR_FRI.uid])
    expect(filteredUids(ALL, filter({ changedOnly: true }), ctx)).toEqual([COMICS_SAT.uid])
  })

  it('intersects a starred-only filter with the chips', () => {
    const ctx = {
      isStarred: (uid: string) => uid === HORROR_FRI.uid,
      hasUnseenChanges: () => false,
    }
    const state = filter({
      starredOnly: true,
      chips: [{ dimension: 'day', value: '2026-07-25' }],
    })
    expect(filteredUids(ALL, state, ctx)).toEqual([])
  })
})

describe('chip editing', () => {
  it('toggles a chip on and back off', () => {
    const chip = { dimension: 'genre', value: 'horror' }
    const on = toggleChip(EMPTY_FILTER, chip)
    expect(on.chips).toEqual([chip])
    expect(toggleChip(on, chip).chips).toEqual([])
  })

  it('replaces a chip with its own negation rather than holding both', () => {
    const on = addChip(EMPTY_FILTER, { dimension: 'venue', value: 'marriott' })
    const negated = addChip(on, { dimension: 'venue', value: 'marriott', negated: true })
    expect(negated.chips).toEqual([{ dimension: 'venue', value: 'marriott', negated: true }])
  })

  it('toggleChip on the opposite sign flips rather than stacking — the ⌥-click contract', () => {
    // The sidebar's tri-state chips lean on this: click targets the positive
    // twin, ⌥-click the negated one, and toggleChip does the rest.
    const pos = { dimension: 'venue', value: 'marriott' }
    const neg = { dimension: 'venue', value: 'marriott', negated: true }
    const included = toggleChip(EMPTY_FILTER, pos)
    const excluded = toggleChip(included, neg)
    expect(excluded.chips).toEqual([neg])
    const backToIncluded = toggleChip(excluded, pos)
    expect(backToIncluded.chips).toEqual([pos])
    expect(toggleChip(backToIncluded, pos).chips).toEqual([])
  })

  it('is a no-op when adding a chip that is already present', () => {
    const chip = { dimension: 'genre', value: 'horror' }
    const on = addChip(EMPTY_FILTER, chip)
    expect(addChip(on, chip)).toBe(on)
  })

  it('removes only the exact chip, leaving its siblings', () => {
    const state = filter({
      chips: [
        { dimension: 'genre', value: 'horror' },
        { dimension: 'genre', value: 'comics' },
      ],
    })
    expect(removeChip(state, { dimension: 'genre', value: 'horror' }).chips).toEqual([
      { dimension: 'genre', value: 'comics' },
    ])
  })
})

describe('describeFilter — what the zero-result state says out loud', () => {
  it('names every active input, chips and non-chips alike', () => {
    const state = filter({
      chips: [
        { dimension: 'genre', value: 'horror' },
        { dimension: 'venue', value: 'marriott', negated: true },
      ],
      text: 'lucas',
      starredOnly: true,
    })
    expect(describeFilter(state).map((p) => p.label)).toEqual([
      'Genre: Horror',
      'not Marriott',
      '"lucas"',
      'starred only',
    ])
  })

  it('describes nothing when nothing is active', () => {
    expect(describeFilter(EMPTY_FILTER)).toEqual([])
  })

  it('takes curated labels from the caller when it has them', () => {
    const state = filter({ chips: [{ dimension: 'day', value: '2026-07-25' }] })
    const labeled = describeFilter(state, (chip) =>
      chip.value === '2026-07-25' ? 'Saturday' : chip.value
    )
    expect(labeled[0]?.label).toBe('Day: Saturday')
  })
})

describe('relaxations — "removing X gives you N"', () => {
  it('offers the drops that actually produce results, largest first', () => {
    const state = filter({
      chips: [
        { dimension: 'genre', value: 'horror' },
        { dimension: 'day', value: '2026-07-25' },
        { dimension: 'venue', value: 'hilton' },
      ],
    })
    expect(applyFilter(ALL, state, MATCH_EVERYTHING)).toHaveLength(0)

    // Two single removals recover something, and they recover different events:
    // dropping the genre leaves the Hilton comics panel, dropping the venue
    // leaves the Saturday horror panel. Dropping the day recovers nothing.
    const hints = relaxations(ALL, state, MATCH_EVERYTHING)
    expect(hints.map((h) => h.part.chip)).toEqual([
      { dimension: 'genre', value: 'horror' },
      { dimension: 'venue', value: 'hilton' },
    ])
    expect(hints.every((h) => h.count === 1)).toBe(true)
  })

  it('offers nothing when no single removal helps', () => {
    const state = filter({ text: 'nothing-matches-this', starredOnly: true })
    expect(relaxations(ALL, state, MATCH_EVERYTHING)).toEqual([])
  })
})

describe('facetOptions — the chip counts', () => {
  it('counts values under the rest of the active filter', () => {
    const state = filter({ chips: [{ dimension: 'day', value: '2026-07-25' }] })
    expect(facetOptions(ALL, state, MATCH_EVERYTHING, 'genre')).toEqual([
      { dimension: 'genre', value: 'comics', count: 1 },
      { dimension: 'genre', value: 'horror', count: 1 },
      { dimension: 'genre', value: 'sf-fantasy', count: 1 },
    ])
  })

  it("ignores the dimension's own chips, so a second value never reads zero", () => {
    const state = filter({ chips: [{ dimension: 'day', value: '2026-07-25' }] })
    const days = facetOptions(ALL, state, MATCH_EVERYTHING, 'day')
    expect(days).toEqual([
      { dimension: 'day', value: '2026-07-25', count: 3 },
      { dimension: 'day', value: '2026-07-24', count: 1 },
    ])
  })

  it('returns nothing for a dimension with no data in the corpus', () => {
    expect(facetOptions(ALL, EMPTY_FILTER, MATCH_EVERYTHING, 'person')).toEqual([])
  })
})

describe('matchesFilter on a candidate with a missing dimension', () => {
  it('excludes an event that simply has no value for a constrained dimension', () => {
    const untagged = candidate('bare', { day: ['2026-07-25'] })
    const state = filter({ chips: [{ dimension: 'audience', value: 'kids' }] })
    expect(matchesFilter(untagged, state, MATCH_EVERYTHING)).toBe(false)
  })

  it('keeps it under a negated constraint — absence is not a violation', () => {
    const untagged = candidate('bare', { day: ['2026-07-25'] })
    const state = filter({ chips: [{ dimension: 'venue', value: 'marriott', negated: true }] })
    expect(matchesFilter(untagged, state, MATCH_EVERYTHING)).toBe(true)
  })
})
