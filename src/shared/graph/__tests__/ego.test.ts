import { describe, expect, it } from 'vitest'
import { buildLensIndex, buildLensIndexes, degreeFor, degreesByLens } from '../lensIndex'
import { expandEgo, fringeUids, linksWithin, specificity } from '../ego'
import { LENSES } from '../types'
import { ANIME_RECORDS, GAMES_RECORDS, PROGRAM_RECORDS, genreCrowd, record } from './fixtures'

const ALL = [...PROGRAM_RECORDS, ...ANIME_RECORDS, ...GAMES_RECORDS]

describe('specificity', () => {
  it('is 1 for a pair and approaches 0 for a hub', () => {
    expect(specificity(2)).toBe(1)
    expect(specificity(1)).toBe(0)
    expect(specificity(487)).toBeLessThan(0.01)
  })
})

describe('buildLensIndex', () => {
  it('indexes entity -> uids and back', () => {
    const index = buildLensIndex(PROGRAM_RECORDS, 'people')
    expect(index.uidsByEntity.get('person:ada vance')).toEqual(['p1', 'p2'])
    expect(index.entitiesByUid.get('p1')).toContain('person:bo idris')
  })

  it('omits events carrying no entity under the lens', () => {
    const index = buildLensIndex(ANIME_RECORDS, 'people')
    expect(index.entitiesByUid.size).toBe(0)
  })
})

describe('degrees', () => {
  it('counts distinct neighbours, not shared entities', () => {
    const index = buildLensIndex(PROGRAM_RECORDS, 'people')
    expect(degreeFor(index, 'p1')).toBe(1)
    expect(degreeFor(index, 'p3')).toBe(0)
  })

  it('reports per-lens counts for the zero-edge escape hatch', () => {
    const indexes = buildLensIndexes(ALL, LENSES)
    const byLens = Object.fromEntries(degreesByLens(indexes, 'a1').map((d) => [d.lens, d.degree]))
    // The anime profile: no people at all, one franchise neighbour, two genre.
    expect(byLens.people).toBe(0)
    expect(byLens.ip).toBe(1)
    expect(byLens.facets).toBe(2)
  })
})

describe('expandEgo', () => {
  it('admits neighbours that share an entity with the seed', () => {
    const index = buildLensIndex(PROGRAM_RECORDS, 'people')
    expect(expandEgo(index, ['p1']).uids).toEqual(['p1', 'p2'])
  })

  it('leaves a seed with no shared entity alone', () => {
    const index = buildLensIndex(PROGRAM_RECORDS, 'people')
    const result = expandEgo(index, ['p3'])
    expect(result.uids).toEqual(['p3'])
    expect(result.omitted).toBe(0)
  })

  it('ranks specific entities above hub entities', () => {
    // One co-panelist, plus 40 events sharing only the seed's genre. The
    // co-panelist has to be first, or the lens is just a genre filter.
    const records = [
      record('seed', { people: [{ name: 'Ada Vance' }], facets: { genre: ['comics'] } }),
      record('mate', { people: [{ name: 'Ada Vance' }], facets: { genre: ['comics'] } }),
      ...genreCrowd(40),
    ]
    const index = buildLensIndex(records, 'facets')
    const people = buildLensIndex(records, 'people')
    expect(expandEgo(people, ['seed']).uids).toEqual(['seed', 'mate'])
    // Under facets the crowd is admitted but capped, and the count of what was
    // left out is what the UI needs to offer "show more".
    const facets = expandEgo(index, ['seed'], { hop1Limit: 10 })
    expect(facets.uids).toHaveLength(11)
    expect(facets.omitted).toBe(31)
  })

  it('caps total nodes even at two hops', () => {
    const records = genreCrowd(200)
    const index = buildLensIndex(records, 'facets')
    const result = expandEgo(index, ['c0'], { hops: 2, maxNodes: 30 })
    expect(result.uids.length).toBeLessThanOrEqual(30)
    expect(new Set(result.uids).size).toBe(result.uids.length)
  })

  it('is deterministic across runs', () => {
    const index = buildLensIndex(genreCrowd(50), 'facets')
    const a = expandEgo(index, ['c0'], { hop1Limit: 12 })
    const b = expandEgo(index, ['c0'], { hop1Limit: 12 })
    expect(a.uids).toEqual(b.uids)
  })

  it('accepts multiple seeds, which is how a filter result seeds the graph', () => {
    const index = buildLensIndex(ALL, 'ip')
    const result = expandEgo(index, ['p1', 'a1'])
    expect(result.seeds).toEqual(['p1', 'a1'])
    expect(result.uids).toEqual(expect.arrayContaining(['p1', 'p2', 'a1', 'a2']))
  })
})

describe('linksWithin', () => {
  it('names every entity a pair shares on one merged edge', () => {
    const index = buildLensIndex(PROGRAM_RECORDS, 'people')
    const [link] = linksWithin(index, ['p1', 'p2'])
    expect(link).toMatchObject({ source: 'p1', target: 'p2' })
    expect(link?.entities.map((e) => e.label)).toEqual(['Ada Vance'])
  })

  it('merges two shared entities into one edge rather than two', () => {
    const records = [
      record('x', { people: [{ name: 'Ada Vance' }, { name: 'Bo Idris' }] }),
      record('y', { people: [{ name: 'Ada Vance' }, { name: 'Bo Idris' }] }),
    ]
    const links = linksWithin(buildLensIndex(records, 'people'), ['x', 'y'])
    expect(links).toHaveLength(1)
    expect(links[0]?.entities).toHaveLength(2)
  })

  it('joins the anime track on unseeded surface text', () => {
    const index = buildLensIndex(ANIME_RECORDS, 'ip')
    const links = linksWithin(index, ['a1', 'a2', 'a3'])
    expect(links).toHaveLength(1)
    expect(links[0]?.entities[0]?.provisional).toBe(true)
    expect(fringeUids(['a1', 'a2', 'a3'], links)).toEqual(['a3'])
  })

  it('connects the sittings of a repeated offering and leaves the one-off out', () => {
    const index = buildLensIndex(GAMES_RECORDS, 'offering')
    const uids = ['g1', 'g2', 'g3', 'g4']
    const links = linksWithin(index, uids)
    expect(links).toHaveLength(3)
    expect(fringeUids(uids, links)).toEqual(['g4'])
  })

  it('degrades a wide clique to a ring instead of a solid disc', () => {
    const records = genreCrowd(40)
    const index = buildLensIndex(records, 'facets')
    const uids = records.map((r) => r.uid)
    const links = linksWithin(index, uids, { maxCliqueMembers: 12 })
    // A 40-node clique would be 780 edges; the ring is 40, and every member is
    // still connected, so the fringe stays a real statement (R8).
    expect(links).toHaveLength(40)
    expect(fringeUids(uids, links)).toEqual([])
  })

  it('draws the full clique when the entity is narrow enough to be readable', () => {
    const records = genreCrowd(5)
    const index = buildLensIndex(records, 'facets')
    const links = linksWithin(index, records.map((r) => r.uid), { maxCliqueMembers: 12 })
    expect(links).toHaveLength(10)
  })

  it('caps total links and keeps the strongest', () => {
    const records = [
      record('x', { people: [{ name: 'Ada Vance' }] }),
      record('y', { people: [{ name: 'Ada Vance' }] }),
      ...genreCrowd(20, 'comics', 'z').map((r) => ({ ...r, people: [{ name: 'Hub Person' }] })),
    ]
    const index = buildLensIndex(records, 'people')
    const links = linksWithin(index, records.map((r) => r.uid), { maxLinks: 5 })
    expect(links).toHaveLength(5)
    expect(links[0]?.entities[0]?.label).toBe('Ada Vance')
  })

  it('recomputes links for a fixed node set when the lens changes', () => {
    const indexes = buildLensIndexes(ALL, LENSES)
    const uids = ['p1', 'p2', 'p3']
    const people = linksWithin(indexes.get('people')!, uids)
    const ip = linksWithin(indexes.get('ip')!, uids)
    const facets = linksWithin(indexes.get('facets')!, uids)

    // Same three nodes throughout — the node set is what persists across a lens
    // switch; only the links and therefore the fringe change.
    expect(people).toHaveLength(1)
    expect(ip).toHaveLength(1)
    expect(facets).toHaveLength(3)
    expect(fringeUids(uids, people)).toEqual(['p3'])
    expect(fringeUids(uids, facets)).toEqual([])
  })
})
