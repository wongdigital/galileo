/**
 * The relatedness graph's pure layer (U6).
 *
 * A lens is a rule for what "related" means. Each one reduces an event to a set
 * of **entities** — a person, a franchise, a genre, an offering cluster — and two
 * events are related under that lens when they carry the same entity. Nothing
 * here knows about d3, canvas, or React; the whole edge model is a set-membership
 * problem over strings, which is why it can be tested without a DOM.
 *
 * The graph never materializes all pairs. The corpus makes that impossible to
 * ignore: `genre:comics` alone covers 486 events, which is 117,855 pairs for one
 * value of one dimension. Instead the index stores entity -> uids, and edges are
 * computed only within a bounded node set (see `ego.ts`). That is the difference
 * between a lens that answers "what else is like this" and one that renders a
 * hairball.
 */

export type LensId = 'people' | 'ip' | 'facets' | 'offering'

export const LENSES: readonly LensId[] = ['ip', 'people', 'facets', 'offering']

/**
 * A shared thing two events have in common. `id` is namespaced by lens so
 * entities from different lenses can never collide in one map; `label` is what
 * the edge inspector shows the user.
 */
export interface GraphEntity {
  id: string
  label: string
  lens: LensId
  /**
   * True when the identity came from an unseeded franchise surface string rather
   * than a curated canonical id. Kept distinguishable because the two carry
   * different confidence — see `entities.ts`.
   */
  provisional?: boolean
}

/**
 * The minimum an event has to offer the graph. Deliberately structural rather
 * than importing `EnrichedEvent`: the renderer assembles this from the compiled
 * index and the runtime facet pass, and tests assemble it from a literal.
 */
export interface GraphRecord {
  uid: string
  people?: readonly { name: string; role?: string }[]
  franchises?: readonly { surface_text: string; canonical: string }[]
  /** Curated facet dimensions, as `applyFacets` produces them. */
  facets?: Readonly<Record<string, readonly string[]>>
  /** Offering cluster key from `buildOfferings`. */
  offeringKey?: string
  /** Display title for the cluster, and how many sittings it has. */
  offeringTitle?: string
  offeringSessions?: number
}

export interface LensIndex {
  lens: LensId
  /** Entity id -> the uids carrying it, deduped, in input order. */
  uidsByEntity: Map<string, string[]>
  /** uid -> entity ids. The inverse, kept because expansion walks both ways. */
  entitiesByUid: Map<string, string[]>
  entities: Map<string, GraphEntity>
}

/** One undirected edge, carrying every entity the pair has in common — the
 *  inspector's whole job is to name those. */
export interface GraphLink {
  source: string
  target: string
  entities: GraphEntity[]
  /** Sum of per-entity specificity; see `specificity` in `ego.ts`. */
  strength: number
}
