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
import { forceCollide, forceRadial, forceX, forceY } from 'd3-force'
import { useSpine } from '@renderer/state/spine'
import { useEntityMap } from '@renderer/state/useEntityMap'
import { CardPresence } from '@renderer/components/CardPresence'
import { InstrumentState } from '@renderer/components/InstrumentState'
import { EventCard } from '@renderer/components/EventCard'
import { EntityCard } from '@renderer/components/EntityCard'
import { valueLabel } from '@renderer/sidebar/labels'
import {
  LENSES,
  eventNodeId,
  eventUidOf,
  hubCount,
  type GraphEntity,
  type LensId,
} from '@shared/graph'
import { LENS_LABEL, LensSelector } from './LensSelector'
import { MiniMap } from './MiniMap'
import { linkColor, linkWidth, nodeRadius, paintMapLabels, paintMapNode, type LabelCandidate } from './paint'
import { useTheme } from '@renderer/state/theme'
import { useNodeCache, type GraphLinkObject, type GraphNodeObject } from './useNodeCache'

/** Stop the settle early rather than running it to convergence. Object
 *  constancy means nodes re-anneal from where they already are, so a bounded
 *  settle reads as a nudge rather than a re-entry. */
const ALPHA_MIN = 0.12
const VELOCITY_DECAY = 0.35

/**
 * Ceiling on the fit's target zoom, applied *before* the animation starts. A
 * two-node scope has a near-zero-area bounding box, and fitting that to the
 * viewport magnifies a pair of dots into full-pane discs. Roughly "one node
 * reads as a node, not as the background".
 */
const MAX_ZOOM = 2.5

/** Beyond this the corpus stops being a picture and starts being a texture, so
 *  charge and link distance both tighten. The split is the spike's, measured. */
const DENSE_NODE_COUNT = 900

/** Weak enough that the core still pushes the halo outward rather than the halo
 *  compressing the core. R5 asks for presence, not a perfect ring. */
const HALO_STRENGTH = 0.35

/**
 * Everything gets a faint pull toward the origin. Without it, a self-contained
 * cluster — a hub plus its few events, sharing nothing with the core — has no
 * attractive tether at all: charge pushes it out until repulsion equalizes,
 * and its distance from center is a force-balance artifact that *reads* like
 * meaning ("why is that group exiled?") while carrying none. The pull is an
 * order of magnitude weaker than the halo force, so distance now roughly
 * tracks connectedness without the ring collapsing inward.
 */
const GRAVITY_STRENGTH = 0.04

/**
 * Breathing room for hub labels, added to the drawn radius in the collision
 * force. A circle cannot track a zoom-dependent text rectangle exactly — label
 * screen size is near-constant while graph-space size shrinks as the user
 * zooms in — so this is clearance for the zoom band where a hub's label first
 * appears, tuned by feel and capped so a long-named hub cannot demand a
 * parking lot.
 */
const hubLabelClearance = (labelLength: number): number => Math.min(22, 4 + labelLength * 0.6)

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

export function GraphView() {
  const { lens, setLens, selectedUid, setSelectedUid } = useSpine()
  // Read so a theme switch re-renders this view and repaints both canvases
  // (see the `paint` dependency note and MiniMap's draw effect).
  const { theme } = useTheme()
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

  // The event-pin analog: a pinned dot pushed out of scope — a filter edit, or
  // unstarring it from its own card under a stars-only filter — cannot keep its
  // card floating over an undimmed map, which is exactly the state the header
  // rules out. `EventCard`'s dataset-wide lookup would happily keep rendering
  // it; the map's contract is narrower than the card's. Gated on `ready`
  // because before the dataset lands *every* uid is undrawn, and a selection
  // arriving from the list must survive those frames.
  useEffect(() => {
    if (map.ready && selectedUid && !drawnIds.has(eventNodeId(selectedUid))) setSelectedUid(null)
  }, [map.ready, selectedUid, drawnIds, setSelectedUid])

  // Hover is only ever *written* by pointer events, so a node removed while the
  // cursor sits on it leaves its id behind with no event coming to correct it.
  // Cleared here rather than merely guarded in `focused`: a guard alone lets
  // the id lie dormant and re-activate as a phantom hover — dimming the map to
  // a neighbourhood the cursor is nowhere near — the moment a lens switch back
  // redraws that node.
  useEffect(() => {
    if (hovered && !drawnIds.has(hovered)) setHovered(null)
  }, [hovered, drawnIds])

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
   * Both candidates are checked against what is actually drawn. The cleanup
   * effects above clear a stale hover or selection, but effects run *after* the
   * render that removed the node — without this check that one frame paints an
   * unresolvable focus, which makes `lit` a one-element set matching nothing
   * and dims *every* node to `DIM_ALPHA`: a map that flashes black for no
   * visible reason.
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
      if (link.target === pinnedEntity) out.push(eventUidOf(link.source))
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

  // An arm that outlives its cause is a bug: filter edit arms, user switches
  // lens before the settle finishes, and the *reorganization's* engine stop
  // would consume the stale arm — yanking the viewport mid-transition, the one
  // thing R3 forbids. The lens switch is a statement about what the user is
  // now watching, so it cancels whatever re-fit an earlier scope change owed.
  // Declared after the arming effect so that on any render doing both (there
  // isn't one today), the disarm wins.
  useEffect(() => {
    refitArmed.current = false
  }, [lens])

  /**
   * The fit is computed here rather than delegated to `zoomToFit`, for one
   * reason: the ceiling. `zoomToFit` on a near-zero-area scope — two clustered
   * dots — animates to an effectively unbounded magnification, and a clamp
   * applied *afterwards* means a second of full-pane discs before the map
   * shrinks back (and a timer that could just as well yank back a wheel-zoom
   * the user made in that window). Capping the target before animating is the
   * whole difference; the box-fit arithmetic is otherwise exactly what
   * `zoomToFit(600, 90)` did.
   *
   * Shared by the engine-stop re-fit and the toolbar's Fit all — one framing
   * rule, however the user got lost.
   */
  const fitAll = useCallback(() => {
    const view = engine.current
    if (!view || nodes.length === 0) return

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const node of nodes) {
      if (node.x === undefined || node.y === undefined) continue
      if (node.x < minX) minX = node.x
      if (node.x > maxX) maxX = node.x
      if (node.y < minY) minY = node.y
      if (node.y > maxY) maxY = node.y
    }
    if (minX === Infinity) return

    const PADDING = 90
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(0.05, (size.width - PADDING * 2) / Math.max(1, maxX - minX)),
      Math.max(0.05, (size.height - PADDING * 2) / Math.max(1, maxY - minY)),
    )
    view.centerAt((minX + maxX) / 2, (minY + maxY) / 2, 600)
    view.zoom(zoom, 600)
  }, [nodes, size.width, size.height])

  const handleEngineStop = useCallback(() => {
    if (!refitArmed.current) return
    refitArmed.current = false
    fitAll()
  }, [fitAll])

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
  // Keyed on the *count*, not the array: everything tuned here is a function of
  // how many nodes there are, and the simulation re-initializes the registered
  // forces itself whenever the drawn population changes. Keying on the array
  // would re-register the halo on every star toggle — the nodes array is
  // rebuilt each pass even when no node entered or left — which is O(n) d3
  // re-initialization per click at whole-corpus scope, for values that cannot
  // have moved.
  const nodeCount = nodes.length
  useEffect(() => {
    const view = engine.current
    if (!view) return
    const dense = nodeCount > DENSE_NODE_COUNT
    view.d3Force('charge')?.strength(dense ? -14 : -40)
    view.d3Force('link')?.distance(dense ? 14 : 26)

    // Radius grows with the core so the halo clears it at every scale rather
    // than being swallowed by a large map or flung away from a small one.
    const radius = 140 + Math.sqrt(nodeCount) * 9
    view.d3Force(
      'halo',
      forceRadial<GraphNodeObject>(radius, 0, 0).strength((node) =>
        node.model.kind === 'event' && node.model.fringe ? HALO_STRENGTH : 0,
      ),
    )

    // The tether for untethered clusters — see GRAVITY_STRENGTH.
    view.d3Force('gravityX', forceX<GraphNodeObject>(0).strength(GRAVITY_STRENGTH))
    view.d3Force('gravityY', forceY<GraphNodeObject>(0).strength(GRAVITY_STRENGTH))

    // Space accommodates labels: hubs claim clearance for theirs, events only
    // their own dot. Radii are read once per re-initialization (a d3-force
    // property), which is exactly when the drawn population changes.
    view.d3Force(
      'collide',
      forceCollide<GraphNodeObject>((node) =>
        node.model.kind === 'entity'
          ? nodeRadius(node.model) + hubLabelClearance(entityLabel(node.model.entity).length)
          : nodeRadius(node.model) + 1.5,
      ),
    )
  }, [nodeCount, canvasMounted])

  const paint = useCallback(
    (node: GraphNodeObject, ctx: CanvasRenderingContext2D) => {
      const dimmed = lit ? !lit.has(node.id) : false
      const pinned = node.id === pinnedNodeId
      const model = node.model
      if (model.kind === 'entity') {
        paintMapNode(
          {
            kind: 'entity',
            x: node.x,
            y: node.y,
            id: node.id,
            label: entityLabel(model.entity),
            degree: model.degree,
            pinned,
            dimmed,
          },
          ctx,
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
        )
      }
    },
    // `theme` is not read in the body — it is here because the library's
    // autoPauseRedraw idles the canvas once the simulation settles, and a new
    // callback identity is the prop change that wakes it. Without it a theme
    // switch leaves the settled graph painted in the old palette until the
    // next pan or hover.
    [lit, pinnedNodeId, theme],
  )

  /**
   * The label pass — every frame, after all marks, one collision-culled pass
   * (see paintMapLabels). Dimmed nodes contribute no candidate: their names
   * receding with them is the existing dimming contract.
   */
  const paintLabels = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      const candidates: LabelCandidate[] = []
      for (const node of nodes) {
        if (node.x === undefined || node.y === undefined) continue
        if (lit && !lit.has(node.id)) continue
        const model = node.model
        if (model.kind === 'entity') {
          candidates.push({
            kind: 'hub',
            x: node.x,
            y: node.y,
            r: nodeRadius(model),
            label: entityLabel(model.entity),
            degree: model.degree,
            pinned: node.id === pinnedNodeId,
          })
        } else if (node.id === pinnedNodeId) {
          candidates.push({
            kind: 'event',
            x: node.x,
            y: node.y,
            r: nodeRadius(model),
            title: model.title,
          })
        }
      }
      paintMapLabels(candidates, ctx, scale)
    },
    [nodes, lit, pinnedNodeId],
  )

  const nodeTooltip = useCallback((node: GraphNodeObject) => {
    const model = node.model
    return model.kind === 'entity'
      ? `${entityLabel(model.entity)} · ${model.degree.toLocaleString()} events`
      : `${model.time} · ${model.title}`
  }, [])

  const onNodeClick = useCallback(
    (node: GraphNodeObject) => {
      if (node.model.kind === 'entity') pinEntity(node.id)
      else pinEvent(node.model.uid)
    },
    [pinEntity, pinEvent],
  )

  // The all-fringe state: a drawn scope in which the current lens found no
  // hubs. Suppressed while the enrichment chunk is still loading — in that
  // window the people/IP indexes are *empty*, not measured, and "nothing in
  // this scope shares one" would be an assertion about data that has not
  // arrived (the loading marker below already narrates that state). Hubs
  // appearing seconds after the overlay swore there were none is exactly the
  // misinformation this gate exists to prevent.
  const allFringe = map.indexReady && map.hubCount === 0 && map.events.length > 0

  // Which lenses would draw hubs over this same scope — the all-fringe state's
  // way out, and the replacement for the deleted per-seed degree hint.
  const scopeSet = useMemo(() => new Set(map.scopeUids), [map.scopeUids])
  const lensesWithHubs = useMemo(() => {
    if (!allFringe) return []
    return [...map.indexes.entries()]
      .filter(([id]) => id !== lens)
      .map(([id, index]) => ({ lens: id, hubs: hubCount(index, scopeSet) }))
      .filter((entry) => entry.hubs > 0)
      .sort((a, b) => b.hubs - a.hubs)
  }, [allFringe, map.indexes, lens, scopeSet])

  if (!map.ready) {
    return (
      <Centered>
        <InstrumentState eyebrow="Entity map" loading>
          Loading the schedule…
        </InstrumentState>
      </Centered>
    )
  }

  const pinnedHub = pinnedEntity ? hubsById.get(pinnedEntity) : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        lens={lens}
        setLens={setLens}
        right={
          map.events.length > 0 ? (
            <span className="flex items-center gap-3">
              <span
                data-testid="map-counts"
                className="font-mono text-[11px] text-ink-faint tabular-nums"
              >
                {`${plural(map.hubCount, 'hub')} · ${plural(map.events.length, 'event')}${
                  map.fringeCount > 0 ? ` · ${map.fringeCount.toLocaleString()} unconnected` : ''
                }`}
              </span>
              <button
                type="button"
                onClick={fitAll}
                title="Frame every drawn node"
                className="rounded border border-line px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
              >
                Fit all
              </button>
            </span>
          ) : null
        }
      />

      <div ref={canvasRef} className="relative min-h-0 flex-1">
        {/* Absolute rather than `Centered`: the canvas host is a positioned
            block, not a flex container, so `flex-1` on a child is inert and the
            message would sit at the top of an otherwise empty pane. */}
        {map.events.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <InstrumentState eyebrow={map.filterActive ? 'Nothing in scope' : 'Entity map'}>
              {map.filterActive
                ? 'No events match the current filter—the map draws whatever the filter holds.'
                : 'No events to map yet.'}
            </InstrumentState>
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
              // The target end is always the hub — its id keys the community hue.
              return linkColor(active, lit ? !active : false, idOf(link.target))
            }}
            linkWidth={(link) =>
              linkWidth(lit ? lit.has(idOf(link.source)) && lit.has(idOf(link.target)) : false)
            }
            onRenderFramePost={paintLabels}
            onNodeHover={(node) => setHovered(node?.id ?? null)}
            onNodeClick={onNodeClick}
            onBackgroundClick={dismiss}
            onEngineStop={handleEngineStop}
          />
        ) : null}

        {allFringe ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center">
            <div className="pointer-events-auto max-w-[420px] rounded-lg border border-line bg-ground-850/95 px-3.5 py-2.5 text-center text-[12px] leading-relaxed text-ink-dim backdrop-blur">
              No hubs under {LENS_LABEL(lens)}—nothing in this scope shares one.{' '}
              {lensesWithHubs.length > 0 ? (
                <>
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
                </>
              ) : (
                // A narrow filter routinely leaves a scope no lens can connect.
                // Saying so is the difference between "the map is broken" and
                // "these events genuinely share nothing" — the overlay must not
                // simply vanish and leave scattered dim dots unexplained.
                'No other lens connects these events either.'
              )}
            </div>
          </div>
        ) : null}

        {canvasMounted ? (
          <MiniMap nodes={nodes} engine={engine} viewWidth={size.width} viewHeight={size.height} />
        ) : null}

        {/* One presence slot for both card kinds: swapping hub card for event
            card is a content change, not a close — only a real dismissal (or
            opening from nothing) plays the wipe. */}
        <CardPresence>
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
        </CardPresence>

        {!map.indexReady ? (
          <span role="status" className="absolute top-3 left-4 font-mono text-[10px] text-ink-faint">
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
    // h-rail: the graph's chrome row sits on the same 52px beat as the
    // sidebar tab row and the schedule's day rail.
    <div className="flex h-rail shrink-0 items-center justify-between gap-3 border-b border-line px-4">
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
