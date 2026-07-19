/**
 * Synthetic records only — no Sched prose, per U1's committed-fixture rule.
 *
 * The shape mirrors what the live index produces: Programs events carry people
 * and canonical franchises, anime events carry unseeded surface franchises and
 * no people at all. Those are the real coverage profiles, so a builder that
 * passes here is exercised against the corpus's actual asymmetry rather than a
 * uniform world.
 */

import type { GraphRecord } from '../types'

export function record(uid: string, parts: Partial<GraphRecord> = {}): GraphRecord {
  return { uid, ...parts }
}

/** Two panels sharing a moderator and a franchise; a third sharing only genre. */
export const PROGRAM_RECORDS: GraphRecord[] = [
  record('p1', {
    people: [
      { name: 'Ada Vance', role: 'moderator' },
      { name: 'Bo Idris', role: 'panelist' },
    ],
    franchises: [{ surface_text: 'Star Wars', canonical: 'star-wars' }],
    facets: { genre: ['scifi-fantasy', 'movies'] },
  }),
  record('p2', {
    people: [{ name: 'ada vance', role: 'panelist' }],
    franchises: [{ surface_text: 'Star Wars', canonical: 'star-wars' }],
    facets: { genre: ['scifi-fantasy'] },
  }),
  record('p3', {
    people: [{ name: 'Cyd Okafor', role: 'panelist' }],
    franchises: [{ surface_text: 'Dune', canonical: 'dune' }],
    facets: { genre: ['scifi-fantasy'] },
  }),
]

/** The anime profile: no people, franchises that never made the seed enum. */
export const ANIME_RECORDS: GraphRecord[] = [
  record('a1', {
    franchises: [{ surface_text: 'Kekkaishi', canonical: 'other' }],
    facets: { genre: ['anime-manga'] },
  }),
  record('a2', {
    franchises: [{ surface_text: 'kekkaishi', canonical: 'other' }],
    facets: { genre: ['anime-manga'] },
  }),
  record('a3', {
    franchises: [{ surface_text: 'Saint Tail', canonical: 'other' }],
    facets: { genre: ['anime-manga'] },
  }),
]

/** `count` events all carrying one genre — the degenerate-density case. */
export function genreCrowd(count: number, value = 'comics', prefix = 'c'): GraphRecord[] {
  return Array.from({ length: count }, (_, i) => record(`${prefix}${i}`, { facets: { genre: [value] } }))
}
