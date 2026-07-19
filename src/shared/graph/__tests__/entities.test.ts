import { describe, expect, it } from 'vitest'
import { entitiesFor, humanizeId, normalizeEntityText } from '../entities'
import { record } from './fixtures'

describe('normalizeEntityText', () => {
  it('folds case, accents, and punctuation to one key', () => {
    expect(normalizeEntityText('Renée O’Hara-Smith')).toBe('renee o hara smith')
    expect(normalizeEntityText('Kekkaishi')).toBe(normalizeEntityText('kekkaishi'))
  })

  it('expands ampersands so "Dungeons & Dragons" matches "Dungeons and Dragons"', () => {
    expect(normalizeEntityText('Dungeons & Dragons')).toBe(normalizeEntityText('Dungeons and Dragons'))
  })
})

describe('humanizeId', () => {
  it('title-cases machine ids', () => {
    expect(humanizeId('star-wars')).toBe('Star Wars')
    expect(humanizeId('scifi-fantasy')).toBe('Scifi Fantasy')
  })
})

describe('people entities', () => {
  it('keys on the normalized name and labels with the surface spelling', () => {
    const [entity] = entitiesFor(record('x', { people: [{ name: 'Ada Vance' }] }), 'people')
    expect(entity).toEqual({ id: 'person:ada vance', label: 'Ada Vance', lens: 'people' })
  })

  it('drops fragments too short to be a name', () => {
    expect(entitiesFor(record('x', { people: [{ name: 'A.' }, { name: 'TV' }] }), 'people')).toEqual([])
  })

  it('deduplicates a person named twice in one description', () => {
    const entities = entitiesFor(
      record('x', { people: [{ name: 'Ada Vance', role: 'moderator' }, { name: 'ada vance' }] }),
      'people'
    )
    expect(entities).toHaveLength(1)
  })
})

describe('IP entities', () => {
  it('joins seeded franchises on the canonical id', () => {
    const [entity] = entitiesFor(
      record('x', { franchises: [{ surface_text: 'A New Hope', canonical: 'star-wars' }] }),
      'ip'
    )
    expect(entity).toMatchObject({ id: 'ip:star-wars', lens: 'ip' })
    expect(entity?.provisional).toBeUndefined()
  })

  it('never joins on the `other` bucket itself', () => {
    const entities = entitiesFor(
      record('x', {
        franchises: [
          { surface_text: 'Kekkaishi', canonical: 'other' },
          { surface_text: 'Boss Monster', canonical: 'other' },
        ],
      }),
      'ip'
    )
    expect(entities.map((e) => e.id)).toEqual(['ip~:kekkaishi', 'ip~:boss monster'])
    expect(entities.every((e) => e.provisional)).toBe(true)
  })

  it('gives an unseeded surface the same id across two spellings', () => {
    const a = entitiesFor(record('a', { franchises: [{ surface_text: 'Kekkaishi', canonical: 'other' }] }), 'ip')
    const b = entitiesFor(record('b', { franchises: [{ surface_text: 'kekkaishi', canonical: 'other' }] }), 'ip')
    expect(a[0]?.id).toBe(b[0]?.id)
  })
})

describe('facet entities', () => {
  it('uses the genre dimension and ignores every other one', () => {
    const entities = entitiesFor(
      record('x', { facets: { genre: ['horror'], format: ['panel'], venue: ['hilton'] } }),
      'facets'
    )
    expect(entities.map((e) => e.id)).toEqual(['genre:horror'])
  })
})

describe('offering entities', () => {
  it('produces nothing for a one-sitting offering', () => {
    expect(entitiesFor(record('x', { offeringKey: 'k', offeringSessions: 1 }), 'offering')).toEqual([])
  })

  it('produces the cluster entity for a repeated offering', () => {
    const [entity] = entitiesFor(
      record('x', { offeringKey: 'GAMES||boss monster', offeringTitle: 'Boss Monster', offeringSessions: 3 }),
      'offering'
    )
    expect(entity).toMatchObject({ id: 'offering:GAMES||boss monster', label: 'Boss Monster' })
  })
})
