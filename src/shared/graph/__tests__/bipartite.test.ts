import { describe, expect, it } from 'vitest'
import { MIN_ENTITY_DEGREE, buildBipartite, eventNodeId, eventUidOf, hubCount } from '../bipartite'
import { buildLensIndex } from '../lensIndex'
import type { GraphRecord } from '../types'
import { ANIME_RECORDS, PROGRAM_RECORDS, genreCrowd, record } from './fixtures'

const uids = (records: readonly GraphRecord[]): string[] => records.map((r) => r.uid)

const hubs = (graph: ReturnType<typeof buildBipartite>) => graph.nodes.filter((n) => n.kind === 'entity')
const events = (graph: ReturnType<typeof buildBipartite>) => graph.nodes.filter((n) => n.kind === 'event')

describe('buildBipartite — hubs', () => {
  it('draws an entity covering three in-scope events as one hub with three links', () => {
    const records = [
      record('e1', { franchises: [{ surface_text: 'Star Wars', canonical: 'star-wars' }] }),
      record('e2', { franchises: [{ surface_text: 'Star Wars', canonical: 'star-wars' }] }),
      record('e3', { franchises: [{ surface_text: 'Star Wars', canonical: 'star-wars' }] }),
    ]
    const graph = buildBipartite(buildLensIndex(records, 'ip'), uids(records))

    expect(hubs(graph)).toHaveLength(1)
    expect(hubs(graph)[0]).toMatchObject({ id: 'ip:star-wars', kind: 'entity', degree: 3 })
    expect(graph.links).toHaveLength(3)
    expect(graph.links.map((l) => l.source).sort()).toEqual(['event:e1', 'event:e2', 'event:e3'])
    expect(graph.links.every((l) => l.target === 'ip:star-wars')).toBe(true)
  })

  it('counts an event once and links it to each entity it carries (AE2)', () => {
    // e1 carries three people, each of whom also appears on one other event —
    // so all three qualify as hubs and e1 sits at their intersection.
    const records = [
      record('e1', {
        people: [{ name: 'Ada Vance' }, { name: 'Bo Idris' }, { name: 'Cyd Okafor' }],
      }),
      record('e2', { people: [{ name: 'Ada Vance' }] }),
      record('e3', { people: [{ name: 'Bo Idris' }] }),
      record('e4', { people: [{ name: 'Cyd Okafor' }] }),
    ]
    const graph = buildBipartite(buildLensIndex(records, 'people'), uids(records))

    const e1Nodes = graph.nodes.filter((n) => n.uid === 'e1')
    expect(e1Nodes).toHaveLength(1)
    expect(e1Nodes[0]).toMatchObject({ kind: 'event', degree: 3, fringe: false })

    expect(hubs(graph)).toHaveLength(3)
    expect(graph.links.filter((l) => l.source === eventNodeId('e1'))).toHaveLength(3)
    expect(graph.links).toHaveLength(6)
  })

  it('carries the entity through on the hub node so the card can name it', () => {
    const graph = buildBipartite(buildLensIndex(PROGRAM_RECORDS, 'ip'), uids(PROGRAM_RECORDS))
    const hub = hubs(graph).find((n) => n.id === 'ip:star-wars')

    expect(hub?.label).toBe('Star Wars')
    expect(hub?.entity).toMatchObject({ id: 'ip:star-wars', lens: 'ip' })
  })
})

describe('buildBipartite — pruning (R4)', () => {
  it('never draws a hub for an entity with a single in-scope event', () => {
    // `dune` covers exactly one Programs event, so it says nothing p3's own
    // label does not already say.
    const graph = buildBipartite(buildLensIndex(PROGRAM_RECORDS, 'ip'), uids(PROGRAM_RECORDS))

    expect(hubs(graph).map((n) => n.id)).toEqual(['ip:star-wars'])
    expect(graph.hubCount).toBe(1)
  })

  it('counts degree against the scope, not the corpus', () => {
    // `genre:comics` spans five events corpus-wide; one of them is in scope, so
    // here it is a single-event entity and must not be drawn.
    const records = genreCrowd(5)
    const graph = buildBipartite(buildLensIndex(records, 'facets'), ['c0'])

    expect(hubs(graph)).toHaveLength(0)
    expect(events(graph)).toHaveLength(1)
    expect(events(graph)[0]).toMatchObject({ uid: 'c0', fringe: true, degree: 0 })
  })

  it('pins the threshold at two', () => {
    expect(MIN_ENTITY_DEGREE).toBe(2)
  })
})

describe('buildBipartite — fringe accounting (R5, AE1)', () => {
  it('returns hub-less in-scope events marked fringe rather than dropping them', () => {
    const graph = buildBipartite(buildLensIndex(PROGRAM_RECORDS, 'ip'), uids(PROGRAM_RECORDS))
    const p3 = events(graph).find((n) => n.uid === 'p3')

    expect(p3).toBeDefined()
    expect(p3).toMatchObject({ fringe: true, degree: 0 })
  })

  it('accounts for every in-scope event exactly once: connected + fringe = scope', () => {
    const graph = buildBipartite(buildLensIndex(PROGRAM_RECORDS, 'ip'), uids(PROGRAM_RECORDS))

    expect(graph.connectedCount + graph.fringeCount).toBe(PROGRAM_RECORDS.length)
    expect(events(graph)).toHaveLength(PROGRAM_RECORDS.length)
    expect(graph.connectedCount).toBe(2)
    expect(graph.fringeCount).toBe(1)
  })

  it('marks connected events fringe: false, so the halo test is never truthiness on undefined', () => {
    const graph = buildBipartite(buildLensIndex(PROGRAM_RECORDS, 'ip'), uids(PROGRAM_RECORDS))
    const connected = events(graph).filter((n) => !n.fringe)

    expect(connected.map((n) => n.uid).sort()).toEqual(['p1', 'p2'])
    expect(connected.every((n) => n.fringe === false)).toBe(true)
  })
})

describe('buildBipartite — degenerate scopes', () => {
  it('returns an empty graph for an empty scope without throwing', () => {
    const graph = buildBipartite(buildLensIndex(PROGRAM_RECORDS, 'ip'), [])

    expect(graph.nodes).toEqual([])
    expect(graph.links).toEqual([])
    expect(graph).toMatchObject({ hubCount: 0, connectedCount: 0, fringeCount: 0 })
  })

  it('makes every event fringe when no entity qualifies', () => {
    // Three events, three distinct one-off franchises — nothing to join on.
    const records = [
      record('e1', { franchises: [{ surface_text: 'Dune', canonical: 'dune' }] }),
      record('e2', { franchises: [{ surface_text: 'Star Wars', canonical: 'star-wars' }] }),
      record('e3', { franchises: [{ surface_text: 'Alien', canonical: 'alien' }] }),
    ]
    const graph = buildBipartite(buildLensIndex(records, 'ip'), uids(records))

    expect(hubs(graph)).toHaveLength(0)
    expect(graph.links).toEqual([])
    expect(graph.fringeCount).toBe(3)
    expect(events(graph).every((n) => n.fringe)).toBe(true)
  })

  it('tolerates a scope uid the lens index has never seen', () => {
    const graph = buildBipartite(buildLensIndex(PROGRAM_RECORDS, 'ip'), ['p1', 'p2', 'ghost'])
    const ghost = events(graph).find((n) => n.uid === 'ghost')

    expect(ghost).toMatchObject({ fringe: true, degree: 0 })
    expect(graph.connectedCount + graph.fringeCount).toBe(3)
  })
})

describe('buildBipartite — identity', () => {
  it('collapses overlapping records into one hub with deduped links and the first spelling', () => {
    // The same uid reaching the index twice (overlapping source records) must not
    // inflate the hub's degree or draw the same line twice.
    const records = [
      record('d1', { franchises: [{ surface_text: 'Star Wars', canonical: 'star-wars' }] }),
      record('d1', { franchises: [{ surface_text: 'star wars', canonical: 'star-wars' }] }),
      record('d2', { franchises: [{ surface_text: 'STAR WARS', canonical: 'star-wars' }] }),
    ]
    const graph = buildBipartite(buildLensIndex(records, 'ip'), ['d1', 'd2'])

    expect(hubs(graph)).toHaveLength(1)
    expect(hubs(graph)[0]).toMatchObject({ label: 'Star Wars', degree: 2 })
    expect(graph.links).toHaveLength(2)
    expect(events(graph)).toHaveLength(2)
  })

  it('draws one event node per uid even when the scope repeats it', () => {
    const graph = buildBipartite(buildLensIndex(PROGRAM_RECORDS, 'ip'), ['p1', 'p2', 'p1'])

    expect(events(graph)).toHaveLength(2)
    expect(graph.connectedCount + graph.fringeCount).toBe(2)
  })

  it('folds surface-spelling variants of an unseeded franchise into one hub', () => {
    const graph = buildBipartite(buildLensIndex(ANIME_RECORDS, 'ip'), uids(ANIME_RECORDS))

    expect(hubs(graph)).toHaveLength(1)
    expect(hubs(graph)[0]).toMatchObject({ label: 'Kekkaishi', degree: 2 })
    expect(events(graph).find((n) => n.uid === 'a3')).toMatchObject({ fringe: true })
  })

  it('gives events a stable id across lenses so the node cache can hold them', () => {
    const ip = buildBipartite(buildLensIndex(PROGRAM_RECORDS, 'ip'), uids(PROGRAM_RECORDS))
    const people = buildBipartite(buildLensIndex(PROGRAM_RECORDS, 'people'), uids(PROGRAM_RECORDS))

    expect(events(ip).map((n) => n.id).sort()).toEqual(events(people).map((n) => n.id).sort())
  })

  it('inverts eventNodeId, and passes non-event ids through untouched', () => {
    expect(eventUidOf(eventNodeId('p1'))).toBe('p1')
    expect(eventUidOf('ip:star-wars')).toBe('ip:star-wars')
  })
})

/**
 * `hubCount` is the overlay's promise: "People has 3" must be the number of
 * hubs a switch to People actually draws. So every case here asserts it against
 * `buildBipartite` itself, not against a hand-computed constant — the two share
 * the membership rule, and this is the proof they cannot drift.
 */
describe('hubCount — the overlay quote', () => {
  const scope = (ids: readonly string[]): ReadonlySet<string> => new Set(ids)

  it('matches what buildBipartite draws over the same scope', () => {
    const index = buildLensIndex(PROGRAM_RECORDS, 'ip')
    const ids = uids(PROGRAM_RECORDS)

    expect(hubCount(index, scope(ids))).toBe(buildBipartite(index, ids).hubCount)
    expect(hubCount(index, scope(ids))).toBe(1)
  })

  it('counts degree against the scope, matching R4 pruning', () => {
    const index = buildLensIndex(genreCrowd(5), 'facets')

    // One in-scope member is below MIN_ENTITY_DEGREE — no hub, here or drawn.
    expect(hubCount(index, scope(['c0']))).toBe(buildBipartite(index, ['c0']).hubCount)
    expect(hubCount(index, scope(['c0']))).toBe(0)
    expect(hubCount(index, scope(['c0', 'c1']))).toBe(1)
  })

  it('dedupes overlapping records the way the builder does', () => {
    // The same uid listed twice under one entity: counting raw entries would
    // let it clear the bar here while the builder prunes it — the overlay
    // would offer a lens that lands on the identical all-fringe map.
    const records = [
      record('d1', { franchises: [{ surface_text: 'Star Wars', canonical: 'star-wars' }] }),
      record('d1', { franchises: [{ surface_text: 'star wars', canonical: 'star-wars' }] }),
    ]
    const index = buildLensIndex(records, 'ip')

    expect(hubCount(index, scope(['d1']))).toBe(buildBipartite(index, ['d1']).hubCount)
    expect(hubCount(index, scope(['d1']))).toBe(0)
  })

  it('is zero over an empty scope', () => {
    expect(hubCount(buildLensIndex(PROGRAM_RECORDS, 'ip'), scope([]))).toBe(0)
  })
})
