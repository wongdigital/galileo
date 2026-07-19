/**
 * Synthetic candidates for the engine tests. Written as literals rather than
 * built through `buildCandidate`, so a change to the enrichment→candidate
 * mapping can never quietly rewrite what the match semantics are asserted to be.
 */

import type { FilterCandidate } from '../types'

export function candidate(
  uid: string,
  dimensions: Record<string, string[]>,
  haystack = ''
): FilterCandidate {
  return { uid, dimensions, haystack: haystack.toLowerCase() }
}

/** Horror, Saturday. Matches both halves of the canonical example. */
export const HORROR_SAT = candidate(
  'h-sat',
  { genre: ['horror'], day: ['2026-07-25'], venue: ['convention-center'], time: ['evening'] },
  'Drawing Monsters'
)

/** Horror, Friday. Matches the interest, fails the constraint. */
export const HORROR_FRI = candidate(
  'h-fri',
  { genre: ['horror'], day: ['2026-07-24'], venue: ['marriott'], time: ['morning'] },
  'Night Terrors Panel'
)

/** Star Wars, Saturday. Matches the other interest and the constraint. */
export const STARWARS_SAT = candidate(
  'sw-sat',
  { genre: ['sf-fantasy'], ip: ['star-wars'], day: ['2026-07-25'], venue: ['convention-center'] },
  'A Galaxy Retrospective'
)

/** Neither interest, right day. The union has to exclude this one. */
export const COMICS_SAT = candidate(
  'c-sat',
  { genre: ['comics'], day: ['2026-07-25'], venue: ['hilton'], time: ['morning'] },
  'Inking Techniques'
)

export const ALL = [HORROR_SAT, HORROR_FRI, STARWARS_SAT, COMICS_SAT]
