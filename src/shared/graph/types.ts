/**
 * The entity map's pure layer.
 *
 * A lens is a rule for what an event is *about*. Each one reduces an event to a
 * set of **entities** — a person, a franchise, a genre. Nothing here knows
 * about d3, canvas, or React; the whole model is a set-membership problem over
 * strings, which is why it can be tested without a DOM.
 *
 * There is no offering lens, and there was one. Repeat clusters ("this same
 * thing runs N times") are real structure — 2,268 events sit in one — but a
 * hub meaning "this event, again" relates nothing to anything else; it dedups
 * copies where every other lens joins *different* events. The scheduling
 * question the cluster answers ("is there another sitting?") is asked while
 * looking at one event, so the event card answers it, and the lens roster
 * holds only rules that connect.
 *
 * The map never materializes pairs of events. The corpus makes that impossible
 * to ignore: `genre:comics` alone covers 486 events, which is 117,855 pairs for
 * one value of one dimension — and the ego model that did draw those pairs is
 * exactly what the bipartite map replaced. Here the index stores entity -> uids
 * and the map draws one link per event-entity pair, so links scale linearly with
 * the corpus rather than quadratically.
 */

export type LensId = 'people' | 'ip' | 'facets'

export const LENSES: readonly LensId[] = ['ip', 'people', 'facets']

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
}

export interface LensIndex {
  lens: LensId
  /** Entity id -> the uids carrying it, deduped, in input order. */
  uidsByEntity: Map<string, string[]>
  /** uid -> entity ids. The inverse, kept because expansion walks both ways. */
  entitiesByUid: Map<string, string[]>
  entities: Map<string, GraphEntity>
}
