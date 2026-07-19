/**
 * Object constancy: the thing that makes or breaks the graph.
 *
 * d3-force keys identity on **object identity**, not on an id field. Every node
 * object carries its own `x`, `y`, `vx`, `vy`, and the simulation reads and
 * writes them in place. Hand it a freshly-mapped array — the obvious thing to do
 * in React — and every node is a new object with no position, so the entire
 * layout re-enters from nothing. That happens on every lens switch and, worse,
 * on every manual refresh with the graph open: 60 nodes fly in from the origin
 * and the constellation the user was reading is gone.
 *
 * So the cache is the contract:
 *
 * - a `Map<uid, nodeObject>` outlives every render,
 * - surviving UIDs are **mutated in place**, never rebuilt,
 * - objects are created only for genuinely new UIDs and deleted only for
 *   genuinely removed ones,
 * - a new node spawns at a neighbour's position rather than at the origin, so
 *   it eases outward from where it belongs instead of streaking across the
 *   canvas.
 *
 * Links, by contrast, are rebuilt every time on purpose: force-graph mutates
 * `source`/`target` from ids into node references, so reusing link objects
 * across a lens switch would hand the engine half-resolved leftovers.
 */

import { useMemo, useRef } from 'react'
import type { GraphNodeModel } from '@renderer/state/useGraph'
import type { GraphLink } from '@shared/graph'

export interface GraphNodeObject {
  id: string
  model: GraphNodeModel
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
  link: GraphLink
}

export interface CachedGraph {
  nodes: GraphNodeObject[]
  links: GraphLinkObject[]
  /** True when the node set itself changed, as opposed to only its links. A
   *  lens switch is the second case, and it does not need a re-fit. */
  nodesChanged: boolean
}

const JITTER = 24

export function useNodeCache(models: readonly GraphNodeModel[], links: readonly GraphLink[]): CachedGraph {
  const cache = useRef(new Map<string, GraphNodeObject>()).current

  return useMemo(() => {
    const wanted = new Set(models.map((m) => m.uid))
    let nodesChanged = false

    for (const uid of [...cache.keys()]) {
      if (!wanted.has(uid)) {
        cache.delete(uid)
        nodesChanged = true
      }
    }

    // Adjacency from the incoming links, so a new node can be placed next to
    // something already on screen instead of at the origin.
    const neighbours = new Map<string, string[]>()
    const link2 = (from: string, to: string): void => {
      const bucket = neighbours.get(from)
      if (bucket) bucket.push(to)
      else neighbours.set(from, [to])
    }
    for (const link of links) {
      link2(link.source, link.target)
      link2(link.target, link.source)
    }

    const spawnNear = (uid: string): { x: number; y: number } => {
      for (const other of neighbours.get(uid) ?? []) {
        const node = cache.get(other)
        if (node?.x !== undefined && node.y !== undefined) {
          return { x: node.x + (Math.random() - 0.5) * JITTER, y: node.y + (Math.random() - 0.5) * JITTER }
        }
      }
      return { x: (Math.random() - 0.5) * JITTER, y: (Math.random() - 0.5) * JITTER }
    }

    const nodes: GraphNodeObject[] = []
    for (const model of models) {
      const existing = cache.get(model.uid)
      if (existing) {
        // In place. Replacing the object here is exactly the bug this file is
        // about — the star that just changed must not cost the node its position.
        existing.model = model
        nodes.push(existing)
      } else {
        const at = spawnNear(model.uid)
        const created: GraphNodeObject = { id: model.uid, model, ...at }
        cache.set(model.uid, created)
        nodes.push(created)
        nodesChanged = true
      }
    }

    // A single seed is pinned so the view has a fixed centre to read outward
    // from; a multi-seed set is left free, because pinning thirty events in a
    // ring is a layout decision the force engine makes better than we can.
    const seeds = models.filter((m) => m.seed)
    for (const node of nodes) {
      const pin = seeds.length === 1 && node.model.seed
      if (pin) {
        node.fx = 0
        node.fy = 0
        node.x ??= 0
        node.y ??= 0
      } else {
        node.fx = undefined
        node.fy = undefined
      }
    }

    return {
      nodes,
      links: links.map((link) => ({ source: link.source, target: link.target, link })),
      nodesChanged,
    }
  }, [models, links, cache])
}
