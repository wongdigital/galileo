/**
 * SPIKE (task #9) — the event↔entity graph, for looking at.
 *
 * The shipped model in `ego.ts` draws events only, and connects two events when
 * they share an entity. That makes a shared entity a clique, and it makes an
 * event carrying Marvel *and* DC *and* Star Wars a single dot pulled between
 * three groups — welding them into one component. Measured on the Comics slice
 * under the IP lens: 659 links, largest component 256 nodes, 215 isolates.
 *
 * Here both kinds of thing are drawn. An event links to each entity it carries,
 * and nothing links event-to-event. A multi-entity event grows several lines
 * instead of being torn between clusters, and a person or franchise becomes a
 * dot you can point at — which is the question this spike exists to answer:
 * "which programs is Mark Waid in" has a visible shape.
 *
 * Links are one per event-entity pair, so they scale linearly with the corpus
 * rather than quadratically the way cliques do.
 *
 * Nothing here is load-bearing yet. If the picture works, the model it implies
 * gets designed properly and this file is replaced; if it does not, this file
 * gets deleted. Either way it should not grow features in the meantime.
 */

import type { GraphEntity, LensIndex } from './types'

/** Events and entities share one id space on the canvas; entity ids are already
 *  lens-namespaced, so only events need a prefix to stay distinct. */
const EVENT_PREFIX = 'event:'

export const eventNodeId = (uid: string): string => `${EVENT_PREFIX}${uid}`

export interface BipartiteNode {
  id: string
  kind: 'event' | 'entity'
  label: string
  /** Events: entities carried. Entities: in-scope events covered. */
  degree: number
  /** Events only — the key back into the schedule. */
  uid?: string
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
  /** Entities that fell below `minEntityDegree`. */
  prunedEntities: number
  /** In-scope events left carrying no surviving entity. */
  droppedEvents: number
}

export interface BipartiteOptions {
  /**
   * Entities covering fewer in-scope events than this are dropped. At 1 the
   * long tail dominates — under IP over Comics, 532 franchises of which only 94
   * cover two events or more, and a franchise covering one event adds a dot and
   * a line that say nothing the event's own label does not.
   */
  minEntityDegree?: number
  /** Keep events that carry no surviving entity, as unattached dots. */
  includeIsolatedEvents?: boolean
}

export function buildBipartite(
  index: LensIndex,
  scopeUids: readonly string[],
  options: BipartiteOptions = {},
): BipartiteGraph {
  const { minEntityDegree = 2, includeIsolatedEvents = false } = options

  const scope = new Set(scopeUids)

  // Entity degree is counted against the scope, not the corpus. A franchise
  // spanning 40 events schedule-wide but one event inside the current filter is
  // a single-event franchise *here*, and drawing it as a hub would lie.
  const membersByEntity = new Map<string, string[]>()
  for (const [entityId, uids] of index.uidsByEntity) {
    const inScope = uids.filter((uid) => scope.has(uid))
    if (inScope.length >= minEntityDegree) membersByEntity.set(entityId, inScope)
  }

  const prunedEntities = index.uidsByEntity.size - membersByEntity.size

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

  let droppedEvents = 0
  for (const uid of scopeUids) {
    const degree = eventDegree.get(uid) ?? 0
    if (degree === 0) {
      droppedEvents += 1
      if (!includeIsolatedEvents) continue
    }
    nodes.push({ id: eventNodeId(uid), kind: 'event', label: uid, degree, uid })
  }

  return { nodes, links, prunedEntities, droppedEvents }
}
