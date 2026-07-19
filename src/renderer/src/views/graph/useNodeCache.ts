/**
 * Object constancy: the thing that makes or breaks the map.
 *
 * d3-force keys identity on **object identity**, not on an id field. Every node
 * object carries its own `x`, `y`, `vx`, `vy`, and the simulation reads and
 * writes them in place. Hand it a freshly-mapped array — the obvious thing to do
 * in React — and every node is a new object with no position, so the entire
 * layout re-enters from nothing. That happens on every lens switch and, worse,
 * on every manual refresh with the map open: thousands of nodes fly in from the
 * origin and the constellation the user was reading is gone.
 *
 * So the cache is the contract:
 *
 * - a `Map<nodeId, nodeObject>` outlives every render,
 * - surviving ids are **mutated in place**, never rebuilt,
 * - objects are created only for genuinely new ids and deleted only for
 *   genuinely removed ones,
 * - a new node spawns near where it belongs rather than at the origin, so it
 *   eases outward instead of streaking across the canvas.
 *
 * ## Two kinds of node, and why only one of them counts
 *
 * The map draws events and entities from one id space (`event:`-prefixed uids
 * and lens-namespaced entity ids), and the two behave differently under a lens
 * switch. Event dots persist — their id does not mention the lens, so they are
 * cache hits and keep their positions, which is exactly R3's object constancy.
 * Hubs swap wholesale, because the lens *is* what an entity is.
 *
 * That asymmetry is why `nodesChanged` counts events only. A filter edit changes
 * the event population and the view should re-fit; a lens switch replaces every
 * hub and the view must not, because the reorganization is the thing the user is
 * watching and re-framing mid-flight fights it.
 *
 * A hub entering spawns at the **centroid of its member events** rather than at
 * a single neighbour: a hub belongs in the middle of its cluster, and easing out
 * from where that cluster already sits is what makes a lens switch read as the
 * same events regrouping rather than a new scene.
 *
 * Links, by contrast, are rebuilt every time on purpose: force-graph mutates
 * `source`/`target` from ids into node references, so reusing link objects
 * across a lens switch would hand the engine half-resolved leftovers.
 */

import { useMemo, useRef } from 'react'
import type { EntityMapNode } from '@renderer/state/useEntityMap'
import type { BipartiteLink } from '@shared/graph'

export interface GraphNodeObject {
  id: string
  model: EntityMapNode
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
}

export interface GraphLinkObject {
  source: string | GraphNodeObject
  target: string | GraphNodeObject
}

export interface CachedGraph {
  nodes: GraphNodeObject[]
  links: GraphLinkObject[]
  /**
   * True when the **event** population changed — a filter edit, a refresh that
   * added or removed events. False when only hubs swapped, which is a lens
   * switch. The view re-fits on this and nothing else.
   */
  nodesChanged: boolean
}

const JITTER = 24

export function useNodeCache(
  models: readonly EntityMapNode[],
  links: readonly BipartiteLink[],
): CachedGraph {
  const cache = useRef(new Map<string, GraphNodeObject>()).current

  return useMemo(() => {
    const wanted = new Set(models.map((m) => m.id))
    let nodesChanged = false

    for (const [id, node] of [...cache]) {
      if (wanted.has(id)) continue
      cache.delete(id)
      // A hub leaving is a lens switch doing its job; only a departing event
      // means the scope itself moved.
      if (node.model.kind === 'event') nodesChanged = true
    }

    // Adjacency from the incoming links, so a new node can be placed against
    // something already on screen instead of at the origin. Links run
    // event -> entity, but both directions are needed: an event looks for its
    // hubs, and a hub looks for its member events.
    const neighbours = new Map<string, string[]>()
    const connect = (from: string, to: string): void => {
      const bucket = neighbours.get(from)
      if (bucket) bucket.push(to)
      else neighbours.set(from, [to])
    }
    for (const link of links) {
      connect(link.source, link.target)
      connect(link.target, link.source)
    }

    const jitter = (): number => (Math.random() - 0.5) * JITTER

    /** The first neighbour that already has a position — good enough for an
     *  event dot, which has few hubs and belongs beside any of them. */
    const spawnNear = (id: string): { x: number; y: number } | null => {
      for (const other of neighbours.get(id) ?? []) {
        const node = cache.get(other)
        if (node?.x !== undefined && node.y !== undefined) {
          return { x: node.x + jitter(), y: node.y + jitter() }
        }
      }
      return null
    }

    /** A hub belongs in the middle of what it covers, not beside one member. */
    const spawnAtCentroid = (id: string): { x: number; y: number } | null => {
      let sumX = 0
      let sumY = 0
      let count = 0
      for (const other of neighbours.get(id) ?? []) {
        const node = cache.get(other)
        if (node?.x === undefined || node.y === undefined) continue
        sumX += node.x
        sumY += node.y
        count += 1
      }
      if (count === 0) return null
      return { x: sumX / count + jitter(), y: sumY / count + jitter() }
    }

    const nodes: GraphNodeObject[] = []
    for (const model of models) {
      const existing = cache.get(model.id)
      if (existing) {
        // In place. Replacing the object here is exactly the bug this file is
        // about — the star that just changed must not cost the node its position.
        existing.model = model
        nodes.push(existing)
        continue
      }

      const at =
        (model.kind === 'entity' ? spawnAtCentroid(model.id) : spawnNear(model.id)) ??
        // Nothing placed to anchor against: the first build, or a hub whose
        // members are all entering with it.
        { x: jitter(), y: jitter() }

      const created: GraphNodeObject = { id: model.id, model, ...at }
      cache.set(model.id, created)
      nodes.push(created)
      if (model.kind === 'event') nodesChanged = true
    }

    return {
      nodes,
      links: links.map((link) => ({ source: link.source, target: link.target })),
      nodesChanged,
    }
  }, [models, links, cache])
}
