/**
 * The Entity Map — the discovery surface.
 *
 * Events are dots, entities are hubs, and one link joins each event to each
 * entity it carries. Everything on screen comes off the same spine the 5-day
 * view reads, so a star set here is starred there before the user has finished
 * switching (R10), and a cancelled starred event carries the same two marks in
 * both places.
 *
 * ## The filter is the scope, and it is the only scope
 *
 * There is no seed, no expand/collapse, and no graph-local scope control (R2).
 * What the filter holds is what the map draws. That is what removed the seed
 * prompt: the map always has something to show, so it mounts straight to a
 * picture rather than to a question.
 *
 * ## One pin at a time, and hover is a preview of it
 *
 * "Card open = pinned" is the single rule. Pinning a hub clears `selectedUid`;
 * selecting an event clears the hub pin. Hovering anything temporarily previews
 * that neighbourhood and reverts on mouse-out, which keeps the
 * pin-one-hub-then-compare-its-neighbours loop alive without introducing a mode
 * (R6, R7).
 *
 * A `selectedUid` arriving from the list opens here as a full pin — dimming and
 * all — never as a card floating over an undimmed map.
 *
 * ## Two things the layout does that are not obvious
 *
 * **The halo** (R5) is a weak radial force scoped to fringe nodes rather than a
 * ring of pinned positions. Pinning would fight the simulation and hard-code a
 * radius; a force lets the core push outward naturally and leaves fringe dots as
 * hoverable as everything else. `forceRadial` is not re-exported by
 * react-force-graph-2d, which is why `d3-force` is a direct dependency.
 *
 * **The re-fit runs on engine stop, not on a timer.** The shipped ego view used
 * fixed 420ms/650ms delays, which worked at 60 nodes and do not at 4,000: at map
 * scale the settle outlasts any fixed delay, and fitting early frames a shape
 * still flying apart. It is also armed only by a *scope* change — a lens switch
 * swaps hubs and must not re-frame, because the reorganization is the thing the
 * user is watching (R3).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { forceRadial } from 'd3-force'
import { useSpine } from '@renderer/state/spine'
import { useEntityMap } from '@renderer/state/useEntityMap'
import { EventCard } from '@renderer/components/EventCard'
import { EntityCard } from '@renderer/components/EntityCard'
import { valueLabel } from '@renderer/sidebar/labels'
import {
  LENSES,
  MIN_ENTITY_DEGREE,
  eventNodeId,
  type GraphEntity,
  type LensId,
  type LensIndex,
} from '@shared/graph'
import { LENS_LABEL, LensSelector } from './LensSelector'
import { linkColor, linkWidth, nodeRadius, paintMapNode } from './paint'
import { useNodeCache, type GraphLinkObject, type GraphNodeObject } from './useNodeCache'

/** Stop the settle early rather than running it to convergence. Object
 *  constancy means nodes re-anneal from where they already are, so a bounded
 *  settle reads as a nudge rather than a re-entry. */
const ALPHA_MIN = 0.12
const VELOCITY_DECAY = 0.35

/**
 * Ceiling on the post-fit zoom. A two-node scope has a near-zero-area bounding
 * box, and fitting that to the viewport magnifies a pair of dots into full-pane
 * discs. Roughly "one node reads as a node, not as the background".
 */
const MAX_ZOOM = 2.5

/** Beyond this the corpus stops being a picture and starts being a texture, so
 *  charge and link distance both tighten. The split is the spike's, measured. */
const DENSE_NODE_COUNT = 900

/** Weak enough that the core still pushes the halo outward rather than the halo
 *  compressing the core. R5 asks for presence, not a perfect ring. */
const HALO_STRENGTH = 0.35

/**
 * Measures the canvas host, and attaches to it via a **callback ref** rather
 * than a `useRef` object.
 *
 * The distinction is load-bearing, and it is the reason a regression test exists
 * for it: any render path that mounts the canvas *after* first paint would, with
 * a ref object, run its size effect once against `null` and never again — the
 * ref's identity never changes. Size stays 0, the `size.width > 0` guard keeps
 * the graph unmounted, and you get a blank pane while the data layer cheerfully
 * reports the right counts.
 *
 * A callback ref is state, so mounting the element re-runs the effect.
 */
function useSize(): [(element: HTMLDivElement | null) => void, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [element, setElement] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!element) return
    if (typeof ResizeObserver === 'undefined') {
      // No observer (older webview, test env): take one measurement so the
      // graph still renders instead of silently staying blank.
      setSize({ width: element.clientWidth, height: element.clientHeight })
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return [setElement, size]
}

/** Genre entities carry machine ids, and the sidebar already owns the table that
 *  renders `scifi-fantasy` as "Sci-Fi & Fantasy". People and franchises arrive
 *  as prose and are shown as extracted. */
function entityLabel(entity: GraphEntity): string {
  return entity.lens === 'facets' ? valueLabel('genre', entity.id.replace(/^genre:/, '')) : entity.label
}

/** How many hubs a lens *would* draw over this scope. Cheap over the already
 *  built indexes, and the replacement for the ego view's per-seed degree hint. */
function hubCountFor(index: LensIndex, scope: ReadonlySet<string>): number {
  let count = 0
  for (const uids of index.uidsByEntity.values()) {
    // Deduped, because `buildBipartite` dedupes the same bucket before applying
    // the same threshold. Counting raw entries would let an entity whose bucket
    // lists one uid twice (overlapping source records) clear the bar here and be
    // pruned there — so the overlay would offer a way out that lands the user on
    // the identical all-fringe map, now pointing back where they came from.
    const inScope = new Set<string>()
    for (const uid of uids) {
      if (scope.has(uid)) inScope.add(uid)
      if (inScope.size >= MIN_ENTITY_DEGREE) break
    }
    if (inScope.size >= MIN_ENTITY_DEGREE) count += 1
  }
  return count
}

export function GraphView() {
  const { lens, setLens, selectedUid, setSelectedUid } = useSpine()
  const map = useEntityMap()

  const engine = useRef<ForceGraphMethods<GraphNodeObject, GraphLinkObject> | undefined>(undefined)
  const [canvasRef, size] = useSize()

  /** Graph-local: entities are not spine UIDs, and putting them in the spine
   *  would grow its contract for one view's transient state. */
  const [pinnedEntity, setPinnedEntity] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const cached = useNodeCache(map.nodes, map.links)
  const { nodes, links } = cached
  const graphData = useMemo(() => ({ nodes, links }), [nodes, links])

  /** Every drawn node id. The dimming rule reads it so a focus that is no longer
   *  on the canvas cannot black out the map — see `focused` below. */
  const drawnIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes])

  const hubsById = useMemo(() => new Map(map.hubs.map((h) => [h.id, h])), [map.hubs])

  // A hub that vanished under the new lens cannot keep a card open describing
  // it. Hubs swap wholesale on a lens switch (R3), so this fires routinely.
  useEffect(() => {
    if (pinnedEntity && !hubsById.has(pinnedEntity)) setPinnedEntity(null)
  }, [pinnedEntity, hubsById])

  const pinEntity = useCallback(
    (id: string) => {
      setPinnedEntity(id)
      // Mutual exclusion: one card at a time.
      setSelectedUid(null)
    },
    [setSelectedUid],
  )

  const pinEvent = useCallback(
    (uid: string) => {
      setSelectedUid(uid)
      setPinnedEntity(null)
    },
    [setSelectedUid],
  )

  const dismiss = useCallback(() => {
    setPinnedEntity(null)
    setSelectedUid(null)
  }, [setSelectedUid])

  const pinnedNodeId = pinnedEntity ?? (selectedUid ? eventNodeId(selectedUid) : null)

  const adjacency = useMemo(() => {
    const out = new Map<string, Set<string>>()
    const add = (a: string, b: string): void => {
      const bucket = out.get(a)
      if (bucket) bucket.add(b)
      else out.set(a, new Set([b]))
    }
    for (const link of map.links) {
      add(link.source, link.target)
      add(link.target, link.source)
    }
    return out
  }, [map.links])

  /**
   * Hover overrides the pin and reverts on mouse-out — the comparison loop.
   *
   * Both candidates are checked against what is actually drawn, and that check
   * is load-bearing rather than defensive. Neither id is guaranteed to survive a
   * data change: `hovered` is only ever cleared by a later `onNodeHover`, so a
   * node removed while the cursor sits on it leaves its id behind with no
   * pointer event coming to correct it; and `selectedUid` is spine state that a
   * filter edit can push out of scope entirely. An unresolvable focus makes
   * `lit` a one-element set that matches nothing, which paints *every* node at
   * `DIM_ALPHA` — a map that goes black for no visible reason.
   */
  const focused = useMemo(() => {
    if (hovered && drawnIds.has(hovered)) return hovered
    if (pinnedNodeId && drawnIds.has(pinnedNodeId)) return pinnedNodeId
    return null
  }, [hovered, pinnedNodeId, drawnIds])

  const lit = useMemo(() => {
    if (!focused) return null
    return new Set([focused, ...(adjacency.get(focused) ?? [])])
  }, [focused, adjacency])

  const memberUids = useMemo(() => {
    if (!pinnedEntity) return []
    const out: string[] = []
    for (const link of map.links) {
      if (link.target === pinnedEntity) out.push(link.source.replace(/^event:/, ''))
    }
    return out
  }, [pinnedEntity, map.links])

  /**
   * The armed re-fit. `nodesChanged` is true only when the *event* population
   * moved, so a lens switch never arms it.
   *
   * The effect is keyed on the cache *object*, not on `nodesChanged`. Keying on
   * the boolean looks equivalent and is not: two filter edits in a row both
   * report `true`, React's `Object.is` check sees no change, and the second edit
   * never re-arms — so every filter change after the first lands at whatever
   * zoom the previous scope ended on. The memo returns a fresh object on each
   * recompute, which is exactly the "something actually changed" signal wanted.
   */
  const refitArmed = useRef(false)
  useEffect(() => {
    if (cached.nodesChanged) refitArmed.current = true
  }, [cached])

  /** Cleared on unmount: the clamp fires 650ms after the fit, and switching
   *  views inside that window would otherwise call `zoom()` on a torn-down
   *  canvas. */
  const clampTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(clampTimer.current), [])

  const handleEngineStop = useCallback(() => {
    if (!refitArmed.current) return
    refitArmed.current = false
    const view = engine.current
    if (!view || nodes.length === 0) return
    view.zoomToFit(600, 90)
    // Applied after the fit animation, otherwise the fit overwrites it.
    window.clearTimeout(clampTimer.current)
    clampTimer.current = window.setTimeout(() => {
      if (engine.current && engine.current.zoom() > MAX_ZOOM) engine.current.zoom(MAX_ZOOM, 300)
    }, 650)
  }, [nodes.length])

  /**
   * Forces are re-tuned whenever the drawn set changes: charge has to weaken as
   * the node count climbs or a 4,000-node map flies apart faster than the
   * viewport can follow, and the halo has to learn the current fringe.
   *
   * `canvasMounted` is in the dependency list because `engine.current` is only
   * assigned when ForceGraph2D renders, and that is gated on a measured size.
   * Arriving from the schedule view with data already loaded, this effect would
   * otherwise run once against a null engine, bail, and never re-run — leaving
   * the map on force-graph's default charge with no halo force registered at
   * all, which is R5 silently not shipping.
   */
  const canvasMounted = size.width > 0 && map.events.length > 0
  useEffect(() => {
    const view = engine.current
    if (!view) return
    const dense = nodes.length > DENSE_NODE_COUNT
    view.d3Force('charge')?.strength(dense ? -14 : -40)
    view.d3Force('link')?.distance(dense ? 14 : 26)

    // Radius grows with the core so the halo clears it at every scale rather
    // than being swallowed by a large map or flung away from a small one.
    const radius = 140 + Math.sqrt(nodes.length) * 9
    view.d3Force(
      'halo',
      forceRadial<GraphNodeObject>(radius, 0, 0).strength((node) =>
        node.model.kind === 'event' && node.model.fringe ? HALO_STRENGTH : 0,
      ),
    )
  }, [nodes, canvasMounted])

  const paint = useCallback(
    (node: GraphNodeObject, ctx: CanvasRenderingContext2D, scale: number) => {
      const dimmed = lit ? !lit.has(node.id) : false
      const pinned = node.id === pinnedNodeId
      const model = node.model
      if (model.kind === 'entity') {
        paintMapNode(
          { kind: 'entity', x: node.x, y: node.y, label: entityLabel(model.entity), degree: model.degree, pinned, dimmed },
          ctx,
          scale,
        )
      } else {
        paintMapNode(
          {
            kind: 'event',
            x: node.x,
            y: node.y,
            title: model.title,
            fringe: model.fringe,
            starred: model.starred,
            states: model.states,
            pinned,
            dimmed,
          },
          ctx,
          scale,
        )
      }
    },
    [lit, pinnedNodeId],
  )

  const nodeTooltip = useCallback((node: GraphNodeObject) => {
    const model = node.model
    return model.kind === 'entity'
      ? `${entityLabel(model.entity)} · ${model.degree} events`
      : `${model.time} · ${model.title}`
  }, [])

  const onNodeClick = useCallback(
    (node: GraphNodeObject) => {
      if (node.model.kind === 'entity') pinEntity(node.id)
      else pinEvent(node.model.uid)
    },
    [pinEntity, pinEvent],
  )

  // Which lenses would draw hubs over this same scope — the all-fringe state's
  // way out, and the replacement for the deleted per-seed degree hint.
  const scopeSet = useMemo(() => new Set(map.scopeUids), [map.scopeUids])
  const lensesWithHubs = useMemo(() => {
    if (map.hubCount > 0 || map.events.length === 0) return []
    return [...map.indexes.entries()]
      .filter(([id]) => id !== lens)
      .map(([id, index]) => ({ lens: id, hubs: hubCountFor(index, scopeSet) }))
      .filter((entry) => entry.hubs > 0)
      .sort((a, b) => b.hubs - a.hubs)
  }, [map.hubCount, map.events.length, map.indexes, lens, scopeSet])

  if (!map.ready) {
    return <Centered>Loading the schedule…</Centered>
  }

  const pinnedHub = pinnedEntity ? hubsById.get(pinnedEntity) : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        lens={lens}
        setLens={setLens}
        right={
          map.events.length > 0 ? (
            <span
              data-testid="map-counts"
              className="font-mono text-[11px] text-ink-faint tabular-nums"
            >
              {`${plural(map.hubCount, 'hub')} · ${plural(map.events.length, 'event')}${
                map.fringeCount > 0 ? ` · ${map.fringeCount.toLocaleString()} unconnected` : ''
              }`}
            </span>
          ) : null
        }
      />

      <div ref={canvasRef} className="relative min-h-0 flex-1">
        {/* Absolute rather than `Centered`: the canvas host is a positioned
            block, not a flex container, so `flex-1` on a child is inert and the
            message would sit at the top of an otherwise empty pane. */}
        {map.events.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-[12px] text-ink-faint">
            {map.filterActive
              ? 'No events match the current filter — the map draws whatever the filter holds.'
              : 'No events to map yet.'}
          </div>
        ) : null}

        {canvasMounted ? (
          <ForceGraph2D<GraphNodeObject, GraphLinkObject>
            ref={engine}
            width={size.width}
            height={size.height}
            graphData={graphData}
            backgroundColor="rgba(0,0,0,0)"
            d3AlphaMin={ALPHA_MIN}
            d3VelocityDecay={VELOCITY_DECAY}
            cooldownTime={8000}
            nodeRelSize={4}
            enableNodeDrag={false}
            nodeLabel={nodeTooltip}
            nodeCanvasObject={paint}
            nodePointerAreaPaint={(node, color, ctx) => {
              if (node.x === undefined || node.y === undefined) return
              // Hit area tracks the drawn radius so a big hub is as easy to hit
              // as it looks, with a floor that keeps 2px event dots clickable.
              const r = Math.max(6, nodeRadius(node.model) + 3)
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
              ctx.fill()
            }}
            linkColor={(link) => {
              const active = lit ? lit.has(idOf(link.source)) && lit.has(idOf(link.target)) : false
              return linkColor(active, lit ? !active : false)
            }}
            linkWidth={(link) =>
              linkWidth(lit ? lit.has(idOf(link.source)) && lit.has(idOf(link.target)) : false)
            }
            onNodeHover={(node) => setHovered(node?.id ?? null)}
            onNodeClick={onNodeClick}
            onBackgroundClick={dismiss}
            onEngineStop={handleEngineStop}
          />
        ) : null}

        {lensesWithHubs.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center">
            <div className="pointer-events-auto max-w-[420px] rounded-lg border border-line bg-ground-850/95 px-3.5 py-2.5 text-center text-[12px] leading-relaxed text-ink-dim backdrop-blur">
              No {LENS_LABEL(lens)} hubs here — nothing in this scope shares one.{' '}
              {lensesWithHubs.slice(0, 2).map((entry, i) => (
                <span key={entry.lens}>
                  {i > 0 ? ', ' : ''}
                  <button
                    type="button"
                    onClick={() => setLens(entry.lens)}
                    className="text-lumen underline-offset-2 hover:underline"
                  >
                    {LENS_LABEL(entry.lens)} has {entry.hubs}
                  </button>
                </span>
              ))}
              .
            </div>
          </div>
        ) : null}

        {pinnedHub ? (
          <EntityCard
            label={entityLabel(pinnedHub.entity)}
            memberUids={memberUids}
            onSelectEvent={pinEvent}
            onDismiss={dismiss}
          />
        ) : selectedUid ? (
          <EventCard uid={selectedUid} onDismiss={dismiss} />
        ) : null}

        {!map.indexReady ? (
          <span className="absolute top-3 left-4 font-mono text-[10px] text-ink-fringe">
            loading people and franchises…
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** force-graph rewrites link endpoints from ids into node references once the
 *  simulation has run, so both shapes have to be handled on every read. */
function idOf(end: string | GraphNodeObject): string {
  return typeof end === 'string' ? end : end.id
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`
}

function Toolbar({
  lens,
  setLens,
  right,
}: {
  lens: LensId
  setLens: (lens: LensId) => void
  right: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
      <LensSelector lenses={LENSES} active={lens} onSelect={setLens} />
      {right}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-8 text-center text-[12px] text-ink-faint">
      {children}
    </div>
  )
}
