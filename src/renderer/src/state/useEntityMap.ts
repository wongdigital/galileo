/**
 * The entity map's view model — the same derived-selector discipline as
 * `useSchedule`, over the same spine.
 *
 * Layers, ordered by what invalidates them:
 *
 * 1. **Records** — dataset + compiled index. The expensive pass.
 * 2. **Lens indexes** — all four, built once per dataset. Building every lens
 *    up front is what makes switching instant, and it is also what lets the
 *    all-fringe state quote hub counts for the lenses it is *not* showing.
 * 3. **Bipartite graph** — `buildBipartite` under the active lens over the
 *    active filter. There is no seed and no graph-local scope: the filter is
 *    the scope and nothing else (R2).
 * 4. **Resolved nodes** — the pure layer has no titles, so hubs and events are
 *    joined back to the schedule here. Event nodes are built from `buildRow`,
 *    the same function the 5-day list rows come from, so "starred", "moved",
 *    and "cancelled" mean exactly one thing across all three surfaces (R10).
 *
 * Identity is the load-bearing property of every array returned from here. A
 * force layout keyed on rebuilt data restarts, so an array that comes back
 * fresh on an unrelated render — a hover, a selection — is a graph that resets
 * itself under the user's cursor. That was a real regression (`1900183`,
 * `filteredUids` built inside a return literal), and the tests assert `toBe`
 * rather than `toEqual` because contents were never the thing at risk.
 */

import { useMemo, useRef } from 'react'

import { buildOfferings } from '@shared/enrichment'
import {
  LENSES,
  buildBipartite,
  buildLensIndexes,
  type BipartiteGraph,
  type BipartiteLink,
  type GraphEntity,
  type GraphRecord,
  type LensId,
  type LensIndex,
} from '@shared/graph'
import type { ScheduleEvent } from '@shared/schedule'
import { useSpine } from './spine'
import { useSchedule } from './useSchedule'
import { useEnrichmentSource } from './enrichmentIndex'
import { buildRow, type RowState } from './derive'

/** A drawn entity — an entity that cleared `MIN_ENTITY_DEGREE` in scope. */
export interface EntityMapHub {
  id: string
  kind: 'entity'
  label: string
  /** In-scope events covered. Drives label size and visibility (R12). */
  degree: number
  entity: GraphEntity
}

export interface EntityMapEvent {
  /** `event:`-prefixed, so it never collides with a lens-namespaced entity id
   *  and stays stable across lens switches — the node cache holds it by id. */
  id: string
  kind: 'event'
  uid: string
  event: ScheduleEvent
  title: string
  time: string
  room: string
  /** Lens-independent encodings, identical in meaning to the list's (R10). */
  starred: boolean
  states: RowState[]
  /** Hubs carried under the active lens. */
  degree: number
  /** No hub claims this event — it belongs to the halo (R5). */
  fringe: boolean
}

export type EntityMapNode = EntityMapHub | EntityMapEvent

export interface EntityMapModel {
  ready: boolean
  /** True once the compiled index has loaded; people/IP are empty before it. */
  indexReady: boolean
  lens: LensId
  /** All four, so the all-fringe state can count hubs under the lenses it is
   *  not showing without rebuilding anything. */
  indexes: ReadonlyMap<LensId, LensIndex>
  hubs: EntityMapHub[]
  events: EntityMapEvent[]
  /** Hubs then events, in one array — what the canvas is handed. */
  nodes: EntityMapNode[]
  links: BipartiteLink[]
  hubCount: number
  connectedCount: number
  fringeCount: number
  /** The scope the map was built over. Identity-stable, and the signal the view
   *  re-fits on: a filter edit changes it, a lens switch does not. */
  scopeUids: string[]
  /** Surfaced here so the view can explain an empty scope without mounting a
   *  second `useSchedule` — its layers are per-instance, so a second call would
   *  re-run `classifyAll` and `applyFacets` over the whole corpus. */
  filterActive: boolean
}

/** Returned whenever there is no index to build from, so "no lens yet" does not
 *  churn identities on every render the way a fresh literal would. */
const EMPTY_GRAPH: BipartiteGraph = {
  nodes: [],
  links: [],
  hubCount: 0,
  connectedCount: 0,
  fringeCount: 0,
}

const sameStates = (a: readonly RowState[], b: readonly RowState[]): boolean =>
  a.length === b.length && a.every((state, i) => state === b[i])

/**
 * Whether a freshly derived event node says anything a previously derived one
 * did not. `event` is compared by reference on purpose: it comes from
 * `schedule.byUid`, which only swaps when the dataset does.
 */
const sameEvent = (a: EntityMapEvent, b: EntityMapEvent): boolean =>
  a.event === b.event &&
  a.title === b.title &&
  a.time === b.time &&
  a.room === b.room &&
  a.starred === b.starred &&
  a.degree === b.degree &&
  a.fringe === b.fringe &&
  sameStates(a.states, b.states)

export function useEntityMap(): EntityMapModel {
  const { dataset, lens, stars } = useSpine()
  const schedule = useSchedule()
  const enrichment = useEnrichmentSource(dataset?.events)

  const events = dataset?.events
  const changes = dataset?.changes

  // Layer 1 — records. Facets and offerings are deterministic and always
  // present; people and franchises arrive only for entries the hash vouches for.
  const records = useMemo<GraphRecord[]>(() => {
    const list = events ?? []
    const offerings = buildOfferings(list)
    return list.map((event) => {
      const entry = enrichment.entryFor(event.uid)
      const key = offerings.keyByUid.get(event.uid) ?? ''
      const offering = offerings.byKey.get(key)
      return {
        uid: event.uid,
        people: entry?.people ?? [],
        franchises: entry?.franchises ?? [],
        facets: schedule.facetsByUid.get(event.uid)?.facets ?? {},
        offeringKey: key,
        offeringTitle: offering?.title,
        offeringSessions: offering?.sessionCount ?? 1,
      }
    })
  }, [events, enrichment, schedule.facetsByUid])

  // Layer 2 — all four lenses at once.
  const indexes = useMemo(() => buildLensIndexes(records, LENSES), [records])

  const starredUids = useMemo(() => new Set(stars.map((s) => s.uid)), [stars])

  /**
   * The scope, restricted to uids the schedule can actually resolve.
   *
   * `filteredUids` is derived from the same dataset `byUid` is, so the two
   * cannot disagree — but restricting here rather than dropping unresolvable
   * event nodes below is what makes that structural: the builder's counts and
   * links describe exactly the nodes that get drawn, with no dangling link
   * pointing at an event the view never received.
   *
   * The comparison against the previous scope is not an optimization, it is the
   * identity contract. `useSchedule` rebuilds `filteredUids` whenever `stars` or
   * `changes` move — `applyFilter` is a `.filter()` call and always allocates —
   * so a single star toggle hands this hook a *new array with identical
   * contents*. Passing that straight through would invalidate the graph memo,
   * rebuild every link object, and reheat the simulation: the user stars one dot
   * and watches the constellation re-anneal under the cursor. Holding the
   * previous array when nothing actually moved is what stops that.
   */
  const scopeRef = useRef<string[]>([])
  const scopeUids = useMemo(() => {
    const live = schedule.filteredUids.filter((uid) => schedule.byUid.has(uid))
    const previous = scopeRef.current
    if (previous.length === live.length && previous.every((uid, i) => uid === live[i])) {
      return previous
    }
    scopeRef.current = live
    return live
  }, [schedule.filteredUids, schedule.byUid])

  // Layer 3 — the map itself, under the active lens over the active filter.
  const graph = useMemo(() => {
    const index = indexes.get(lens)
    return index ? buildBipartite(index, scopeUids) : EMPTY_GRAPH
  }, [indexes, lens, scopeUids])

  // Layer 4a — hubs. These swap wholesale on a lens switch; that reorganization
  // is the point (R3), so there is nothing to preserve across one.
  const hubs = useMemo<EntityMapHub[]>(() => {
    const out: EntityMapHub[] = []
    for (const node of graph.nodes) {
      if (node.kind !== 'entity' || !node.entity) continue
      out.push({
        id: node.id,
        kind: 'entity',
        label: node.label,
        degree: node.degree,
        entity: node.entity,
      })
    }
    return out
  }, [graph])

  /**
   * Layer 4b — events, with the previous pass's objects reused wherever nothing
   * about them moved.
   *
   * A lens switch rebuilds the graph, but most event dots are unchanged by it:
   * only `degree` and `fringe` are lens-dependent, and an event that was fringe
   * under IP and is still fringe under People is the same dot in every respect.
   * Handing back a new object for it would churn identities the canvas layer
   * exists to keep — hence the cache keyed by node id, pruned to the current
   * scope each pass so a narrowing filter does not leak the events it dropped.
   */
  const cache = useRef(new Map<string, EntityMapEvent>())
  const eventNodes = useMemo<EntityMapEvent[]>(() => {
    const previous = cache.current
    const next = new Map<string, EntityMapEvent>()
    const out: EntityMapEvent[] = []

    for (const node of graph.nodes) {
      if (node.kind !== 'event' || !node.uid) continue
      const event = schedule.byUid.get(node.uid)
      if (!event) continue
      const row = buildRow(event, {
        classes: schedule.classes,
        changes: changes ?? {},
        starredUids,
      })
      const fresh: EntityMapEvent = {
        id: node.id,
        kind: 'event',
        uid: node.uid,
        event,
        title: event.title,
        time: row.time,
        room: event.room,
        starred: row.starred,
        states: row.states,
        degree: node.degree,
        fringe: node.fringe === true,
      }
      const prior = previous.get(node.id)
      const kept = prior && sameEvent(prior, fresh) ? prior : fresh
      next.set(node.id, kept)
      out.push(kept)
    }

    cache.current = next
    return out
  }, [graph, schedule.byUid, schedule.classes, changes, starredUids])

  const nodes = useMemo<EntityMapNode[]>(() => [...hubs, ...eventNodes], [hubs, eventNodes])

  return {
    ready: !!events,
    indexReady: enrichment.ready,
    lens,
    indexes,
    hubs,
    events: eventNodes,
    nodes,
    links: graph.links,
    hubCount: graph.hubCount,
    connectedCount: graph.connectedCount,
    fringeCount: graph.fringeCount,
    scopeUids,
    filterActive: schedule.filterActive,
  }
}
