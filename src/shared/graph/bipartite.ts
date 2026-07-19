/**
 * The entity map's edge model: a bipartite graph of events and entities.
 *
 * An event links to each entity it carries, and nothing links event-to-event.
 * That is the whole difference from the ego model this replaced. There, a shared
 * entity became a clique — measured on the Comics slice under IP, 659 links and
 * a single 256-node component — and an event carrying Marvel *and* DC *and*
 * Star Wars was one dot torn between three groups, welding them together. Here
 * a multi-entity event grows several lines instead, and a person or franchise
 * becomes a dot you can point at, so "which programs is Mark Waid in" has a
 * visible shape.
 *
 * Links are one per event-entity pair, so they scale linearly with the corpus
 * rather than quadratically the way cliques do.
 *
 * Two rules are fixed here rather than exposed as options, because both are
 * judgments the spike existed to make and they are now made:
 *
 *   - An entity needs `MIN_ENTITY_DEGREE` in-scope events to be drawn (R4).
 *   - Every in-scope event is returned, hub-less ones marked `fringe` (R5).
 *
 * Scope comes from the active filter and nothing else (R2); this layer never
 * decides what is in scope, it only measures against what it is handed.
 */

import type { GraphEntity, LensIndex } from './types'

/** Events and entities share one id space on the canvas; entity ids are already
 *  lens-namespaced, so only events need a prefix to stay distinct. Event ids are
 *  therefore stable across lens switches, which is what makes object constancy
 *  free for the node cache (R3). */
const EVENT_PREFIX = 'event:'

export const eventNodeId = (uid: string): string => `${EVENT_PREFIX}${uid}`

/** The inverse — a node id back to its uid. Non-event ids pass through
 *  unchanged, so callers filtering a mixed id list can apply it blindly. */
export const eventUidOf = (nodeId: string): string =>
  nodeId.startsWith(EVENT_PREFIX) ? nodeId.slice(EVENT_PREFIX.length) : nodeId

/**
 * Entities covering fewer in-scope events than this are never drawn as hubs (R4).
 *
 * At 1 the long tail dominates: under IP over Comics, 532 franchises of which
 * only 94 cover two events or more. A franchise covering one event adds a dot
 * and a line that say nothing the event's own label does not.
 */
export const MIN_ENTITY_DEGREE = 2

export interface BipartiteNode {
  id: string
  kind: 'event' | 'entity'
  /**
   * Entities: the display label, first spelling wins. Events: the uid — this
   * layer has no titles, and the view model resolves them from the schedule.
   */
  label: string
  /** Events: hubs carried. Entities: in-scope events covered. Drives label
   *  size and visibility continuously (R12). */
  degree: number
  /** Events only — the key back into the schedule. */
  uid?: string
  /**
   * Events only — true when no surviving hub claims this event (R5). Always a
   * boolean on event nodes so callers can test it without falling through
   * `undefined`; absent on entity nodes, which are never fringe.
   */
  fringe?: boolean
  /** Entities only. */
  entity?: GraphEntity
}

export interface BipartiteLink {
  source: string
  target: string
}

export interface BipartiteGraph {
  nodes: BipartiteNode[]
  links: BipartiteLink[]
  /** Entities that cleared `MIN_ENTITY_DEGREE` and are drawn. */
  hubCount: number
  /** In-scope events carrying at least one hub. */
  connectedCount: number
  /** In-scope events carrying none — the halo (R5). Never hidden; with
   *  `connectedCount` this sums to the scope size exactly. */
  fringeCount: number
}

/**
 * An entity's members restricted to the scope, deduped. Overlapping source
 * records can list the same uid twice under one entity; deduping here keeps
 * degree honest and stops a doubled link. This is *the* hub-membership rule —
 * `buildBipartite` and `hubCount` both judge through it, so the overlay's
 * "People has 3" claim and what a lens switch actually draws cannot drift.
 */
const inScopeMembers = (uids: readonly string[], scope: ReadonlySet<string>): string[] => [
  ...new Set(uids.filter((uid) => scope.has(uid))),
]

/**
 * How many hubs a lens would draw over this scope — the same judgment
 * `buildBipartite` makes, without building the graph. The all-fringe overlay
 * quotes this for the lenses it is not showing.
 */
export function hubCount(index: LensIndex, scope: ReadonlySet<string>): number {
  let count = 0
  for (const uids of index.uidsByEntity.values()) {
    if (inScopeMembers(uids, scope).length >= MIN_ENTITY_DEGREE) count += 1
  }
  return count
}

export function buildBipartite(index: LensIndex, scopeUids: readonly string[]): BipartiteGraph {
  // Iterating the Set rather than the array dedupes a uid the caller passed
  // twice while preserving first-appearance order — one dot per event, always.
  const scope = new Set(scopeUids)

  // Entity degree is counted against the scope, not the corpus. A franchise
  // spanning 40 events schedule-wide but one event inside the current filter is
  // a single-event franchise *here*, and drawing it as a hub would lie.
  const membersByEntity = new Map<string, string[]>()
  for (const [entityId, uids] of index.uidsByEntity) {
    const inScope = inScopeMembers(uids, scope)
    if (inScope.length >= MIN_ENTITY_DEGREE) membersByEntity.set(entityId, inScope)
  }

  const nodes: BipartiteNode[] = []
  const links: BipartiteLink[] = []
  const eventDegree = new Map<string, number>()

  for (const [entityId, members] of membersByEntity) {
    const entity = index.entities.get(entityId)
    if (!entity) continue
    nodes.push({ id: entityId, kind: 'entity', label: entity.label, degree: members.length, entity })
    for (const uid of members) {
      links.push({ source: eventNodeId(uid), target: entityId })
      eventDegree.set(uid, (eventDegree.get(uid) ?? 0) + 1)
    }
  }

  const hubCount = nodes.length
  let fringeCount = 0

  for (const uid of scope) {
    const degree = eventDegree.get(uid) ?? 0
    const fringe = degree === 0
    if (fringe) fringeCount += 1
    nodes.push({ id: eventNodeId(uid), kind: 'event', label: uid, degree, uid, fringe })
  }

  return { nodes, links, hubCount, connectedCount: scope.size - fringeCount, fringeCount }
}
