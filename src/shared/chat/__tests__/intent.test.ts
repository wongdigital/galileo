import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, type FilterState } from '../../filter/types'
import { applyFilterIntent, resolveFacetValue } from '../intent'

const base: FilterState = {
  chips: [{ dimension: 'genre', value: 'Horror' }],
  text: '',
  starredOnly: false,
  changedOnly: false,
}

describe('applyFilterIntent', () => {
  it('adds interest chips as a union alongside existing chips', () => {
    const next = applyFilterIntent(base, {
      add: [{ dimension: 'ip', value: 'Star Wars' }],
    })
    expect(next.chips).toEqual([
      { dimension: 'genre', value: 'Horror' },
      { dimension: 'ip', value: 'Star Wars' },
    ])
  })

  it('keeps negation on a constraint chip', () => {
    const next = applyFilterIntent(EMPTY_FILTER, {
      add: [{ dimension: 'venue', value: 'Marriott', negated: true }],
    })
    expect(next.chips).toEqual([{ dimension: 'venue', value: 'Marriott', negated: true }])
  })

  it('strips negation from an interest chip — a negated union member is a no-op the engine ignores', () => {
    const next = applyFilterIntent(EMPTY_FILTER, {
      add: [{ dimension: 'ip', value: 'Star Wars', negated: true }],
    })
    expect(next.chips).toEqual([{ dimension: 'ip', value: 'Star Wars' }])
  })

  it('removes a chip regardless of its sign', () => {
    const withNeg: FilterState = {
      ...EMPTY_FILTER,
      chips: [{ dimension: 'venue', value: 'Marriott', negated: true }],
    }
    const next = applyFilterIntent(withNeg, {
      remove: [{ dimension: 'venue', value: 'Marriott' }],
    })
    expect(next.chips).toEqual([])
  })

  it('removes a chip case-insensitively — model emits "horror", chip stored "Horror"', () => {
    const next = applyFilterIntent(base, {
      remove: [{ dimension: 'genre', value: 'horror' }],
    })
    expect(next.chips).toEqual([])
  })

  it('clear resets to empty before applying the rest', () => {
    const next = applyFilterIntent(base, {
      clear: true,
      add: [{ dimension: 'genre', value: 'Comedy' }],
    })
    expect(next.chips).toEqual([{ dimension: 'genre', value: 'Comedy' }])
  })

  it('sets and clears the free-text chip', () => {
    expect(applyFilterIntent(base, { text: 'lucasfilm' }).text).toBe('lucasfilm')
    expect(applyFilterIntent({ ...base, text: 'x' }, { text: null }).text).toBe('')
    expect(applyFilterIntent({ ...base, text: 'x' }, { text: '' }).text).toBe('')
  })

  it('leaves text untouched when the intent omits it', () => {
    expect(applyFilterIntent({ ...base, text: 'keep' }, { starredOnly: true }).text).toBe('keep')
  })

  it('toggles the starred and changed flags', () => {
    const next = applyFilterIntent(base, { starredOnly: true, changedOnly: true })
    expect(next.starredOnly).toBe(true)
    expect(next.changedOnly).toBe(true)
  })

  it('a no-op intent returns the same state reference', () => {
    expect(applyFilterIntent(base, {})).toBe(base)
  })

  it('does not duplicate a chip that is already present', () => {
    const next = applyFilterIntent(base, { add: [{ dimension: 'genre', value: 'Horror' }] })
    expect(next.chips).toEqual([{ dimension: 'genre', value: 'Horror' }])
  })
})

describe('resolveFacetValue', () => {
  const values = ['Star Wars', 'The Walking Dead', 'Star Trek', 'Marvel']

  it('matches case-insensitively on the exact token', () => {
    expect(resolveFacetValue('star wars', values)).toBe('Star Wars')
    expect(resolveFacetValue('MARVEL', values)).toBe('Marvel')
  })

  it('resolves a unique substring to the full value', () => {
    expect(resolveFacetValue('walking dead', values)).toBe('The Walking Dead')
  })

  it('returns null when a substring is ambiguous rather than guessing', () => {
    // "star" is inside both "Star Wars" and "Star Trek".
    expect(resolveFacetValue('star', values)).toBeNull()
  })

  it('returns null for no match and for empty input', () => {
    expect(resolveFacetValue('pokemon', values)).toBeNull()
    expect(resolveFacetValue('   ', values)).toBeNull()
  })

  it('prefers an exact match over a substring collision', () => {
    // "Star Trek" is exact even though "star" alone would be ambiguous.
    expect(resolveFacetValue('Star Trek', values)).toBe('Star Trek')
  })

  it('matches a spoken name against a canonical slug, and back', () => {
    // The enrichment index stores franchise ids as slugs; the model speaks in
    // names. Separators must not defeat the match in either direction.
    const slugs = ['star-wars', 'star-wars-lego', 'the-walking-dead']
    expect(resolveFacetValue('Star Wars', slugs)).toBe('star-wars')
    expect(resolveFacetValue('star wars lego', slugs)).toBe('star-wars-lego')
    expect(resolveFacetValue('the walking dead', values)).toBe('The Walking Dead')
  })

  it('resolves a unique substring across separator styles', () => {
    expect(resolveFacetValue('lego', ['star-wars', 'star-wars-lego'])).toBe('star-wars-lego')
  })

  it('keeps word boundaries when normalizing, so fragments cannot bridge words', () => {
    // Collapsing separators to nothing would put "art" inside "startrek";
    // collapsing to a space keeps it out.
    expect(resolveFacetValue('art', ['star-trek', 'art-illustration'])).toBe('art-illustration')
  })
})
