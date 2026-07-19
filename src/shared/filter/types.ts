/**
 * Filter state schema and the dimension registry.
 *
 * This lives in `src/shared/` rather than in the renderer because two callers
 * have to agree on it exactly: the sidebar chips, and (Phase B) the main-process
 * chat compiler that turns "horror and Star Wars, Saturday" into the same
 * object. R15's "chat produces the same state as the chips" then holds
 * definitionally instead of by convention.
 */

/**
 * The whole filter model turns on this one distinction.
 *
 * `interest` dimensions answer "what am I into" — genre, franchise, people.
 * Adding a second one should show you *more*, so they accumulate as a union.
 * `constraint` dimensions answer "what will I actually go to" — day, venue,
 * time, duration, audience. Adding one should show you *less*, so they narrow.
 *
 * Get this backwards and "Horror and Star Wars" returns the handful of horror
 * Star Wars panels rather than everything the user just said they liked.
 */
export type DimensionKind = 'interest' | 'constraint'

export interface FilterDimension {
  id: string
  label: string
  kind: DimensionKind
  /** Primary dimensions get the sidebar rail; the rest sit behind "more". */
  rail: 'primary' | 'more'
}

/**
 * The registry is the vocabulary, not the available values — a dimension listed
 * here with no data in the corpus simply renders no chips. `ip` and `person`
 * are registered before their data exists (U11's compile) so that the engine,
 * the chip UI, and the chat compiler never need a second release to agree that
 * those dimensions are unions.
 */
export const FILTER_DIMENSIONS: readonly FilterDimension[] = [
  { id: 'genre', label: 'Genre', kind: 'interest', rail: 'primary' },
  { id: 'ip', label: 'Franchise', kind: 'interest', rail: 'primary' },
  { id: 'person', label: 'People', kind: 'interest', rail: 'more' },
  { id: 'strand', label: 'Strand', kind: 'interest', rail: 'more' },
  { id: 'community', label: 'Community', kind: 'interest', rail: 'more' },
  { id: 'day', label: 'Day', kind: 'constraint', rail: 'primary' },
  { id: 'track', label: 'Track', kind: 'constraint', rail: 'primary' },
  { id: 'format', label: 'Format', kind: 'constraint', rail: 'more' },
  { id: 'venue', label: 'Venue', kind: 'constraint', rail: 'more' },
  { id: 'time', label: 'Time', kind: 'constraint', rail: 'more' },
  { id: 'duration', label: 'Duration', kind: 'constraint', rail: 'more' },
  { id: 'audience', label: 'Audience', kind: 'constraint', rail: 'more' },
  { id: 'accessibility', label: 'Accessibility', kind: 'constraint', rail: 'more' },
]

const KIND_BY_DIMENSION = new Map(FILTER_DIMENSIONS.map((d) => [d.id, d.kind]))

/**
 * Unknown dimensions resolve to `constraint`. An unrecognized term coming from
 * a future chat compiler narrowing too much is a visibly empty result the user
 * can undo; the same term widening the set silently pads results with events
 * that match nothing they asked for.
 */
export function dimensionKind(dimension: string): DimensionKind {
  return KIND_BY_DIMENSION.get(dimension) ?? 'constraint'
}

export function findDimension(dimension: string): FilterDimension | null {
  return FILTER_DIMENSIONS.find((d) => d.id === dimension) ?? null
}

export interface FilterChip {
  dimension: string
  value: string
  /** Constraints only: "not the Marriott". Negating an interest is meaningless
   *  in a union — it would remove nothing, since the union is additive. */
  negated?: boolean
}

export interface FilterState {
  chips: FilterChip[]
  /** Free-text chip, matched against title/room/track/description. */
  text: string
  starredOnly: boolean
  /** Only events carrying unacknowledged changes. */
  changedOnly: boolean
}

export const EMPTY_FILTER: FilterState = {
  chips: [],
  text: '',
  starredOnly: false,
  changedOnly: false,
}

/**
 * What the engine matches against: one flat bag of dimension values per event,
 * plus a prebuilt lowercase haystack. Deliberately not `EnrichedEvent` — the
 * engine should be testable with three lines of literal, and the mapping from
 * enrichment shape to this shape lives in `candidate.ts` where it can change
 * without touching match semantics.
 */
export interface FilterCandidate {
  uid: string
  dimensions: Record<string, string[]>
  haystack: string
}

/**
 * Star and change state are looked up rather than baked into the candidate, so
 * starring an event does not invalidate the whole candidate array.
 */
export interface MatchContext {
  isStarred: (uid: string) => boolean
  hasUnseenChanges: (uid: string) => boolean
}

export const MATCH_EVERYTHING: MatchContext = {
  isStarred: () => false,
  hasUnseenChanges: () => false,
}
