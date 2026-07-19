/**
 * The Relatedness Graph (U6) — the discovery surface.
 *
 * Everything on screen comes off the same spine the 5-day view reads, so a star
 * set here is starred there before the user has finished switching (R10), and a
 * cancelled starred event carries the same two marks in both places (AE4).
 *
 * ## Force tuning, and one thing the plan asked for that the library will not do
 *
 * The plan specifies `d3ReheatSimulation()` at alpha ~0.4 rather than 1.0.
 * force-graph does not expose that: `d3ReheatSimulation()` is hard-coded to
 * `alpha(1)`, and any `graphData` change internally runs `stop().alpha(1)`
 * regardless. There is no public alpha setter. So the intent — a nudge, not a
 * re-anneal — is expressed the way the library does allow: `d3AlphaMin` stops
 * the simulation once alpha decays past a threshold, turning a full settle into
 * a bounded one, and object constancy means the nodes are re-annealing *from
 * where they already are* rather than from nothing. The visible result is what
 * alpha 0.4 was asking for; the mechanism is a floor rather than a ceiling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { useSpine } from '@renderer/state/spine'
import { useSchedule } from '@renderer/state/useSchedule'
import { SEED_CAP, useGraph } from '@renderer/state/useGraph'
import { LENSES, type GraphLink, type LensId } from '@shared/graph'
import { StarButton } from '@renderer/views/schedule/StarButton'
import { EdgeInspector } from './EdgeInspector'
import { LENS_HINT, LENS_LABEL, LensSelector } from './LensSelector'
import { SeedPrompt } from './SeedPrompt'
import { linkColor, linkWidth, paintNode } from './paint'
import { useNodeCache, type GraphLinkObject, type GraphNodeObject } from './useNodeCache'

/** Stop the settle early rather than running it to convergence — see above. */
const ALPHA_MIN = 0.12
const VELOCITY_DECAY = 0.35

/**
 * Ceiling on the post-fit zoom. A one-node neighbourhood has a zero-area
 * bounding box, and fitting that to the viewport magnifies a single dot into a
 * full-pane disc. Roughly "one node reads as a node, not as the background".
 */
const MAX_ZOOM = 2.5

/**
 * Measures the canvas host, and attaches to it via a **callback ref** rather
 * than a `useRef` object.
 *
 * The distinction is load-bearing. This component early-returns the seed prompt
 * when nothing is seeded, so the canvas element does not exist on first mount.
 * An effect keyed on a ref object would run once, find `ref.current === null`,
 * bail, and never run again — the ref's identity never changes, so seeding
 * later mounts the canvas with no observer watching it. Size stays 0, the
 * `size.width > 0` guard below keeps the graph unmounted, and you get a blank
 * pane that reports "showing 24 of 65" because the data layer was right all
 * along.
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

export function GraphView() {
  const { lens, setLens, seed, setSeed, selectedUid, setSelectedUid, toggleStar } = useSpine()
  const schedule = useSchedule()
  const graph = useGraph()

  const shellRef = useRef<HTMLDivElement>(null)
  const engine = useRef<ForceGraphMethods<GraphNodeObject, GraphLinkObject> | undefined>(undefined)
  const [canvasRef, size] = useSize()

  const [inspected, setInspected] = useState<GraphLink | null>(null)
  const [hovered, setHovered] = useState<GraphLink | null>(null)

  const { nodes, links, nodesChanged } = useNodeCache(graph.nodes, graph.links)

  const seedFrom = useCallback(
    (uids: string[], origin: 'selection' | 'stars' | 'filter') => {
      setSeed({ uids, lens, hops: 1, origin })
      if (uids.length === 1 && uids[0]) setSelectedUid(uids[0])
      setInspected(null)
    },
    [lens, setSeed, setSelectedUid],
  )

  // Arriving from the 5-day view with a row selected seeds from it. Toggling
  // views should land on the thing you were looking at, not on a prompt asking
  // you to pick it again.
  useEffect(() => {
    if (!seed && selectedUid && schedule.byUid.has(selectedUid)) {
      setSeed({ uids: [selectedUid], lens, hops: 1, origin: 'selection' })
    }
  }, [seed, selectedUid, schedule.byUid, lens, setSeed])

  // An inspected edge whose link no longer exists — after a lens switch, a
  // re-seed, or a refresh — must not linger describing a connection that is no
  // longer on screen.
  useEffect(() => {
    if (!inspected) return
    const key = `${inspected.source}|${inspected.target}`
    if (!links.some((l) => `${l.source}|${l.target}` === key)) setInspected(null)
  }, [links, inspected])

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links])

  // Re-fit only when the node set changed. A lens switch keeps the same nodes,
  // and re-fitting on every switch would fight the reorganization the user is
  // watching.
  //
  // The clamp matters more than it looks. `zoomToFit` scales the bounding box of
  // the nodes to the viewport, and a lone seed's bounding box is one dot — so a
  // zero-edge seed, which is a routine outcome under a narrow filter, gets
  // magnified until a single node fills the pane as a featureless disc. Fit,
  // then pull back to something a human would recognise as a graph.
  useEffect(() => {
    if (!nodesChanged || nodes.length === 0) return
    const id = window.setTimeout(() => {
      const view = engine.current
      if (!view) return
      view.zoomToFit(600, 90)
      // Applied after the fit animation, otherwise the fit overwrites it.
      window.setTimeout(() => {
        const current = view.zoom()
        if (current > MAX_ZOOM) view.zoom(MAX_ZOOM, 300)
      }, 650)
    }, 420)
    return () => window.clearTimeout(id)
  }, [nodesChanged, nodes.length])

  const titleFor = useCallback(
    (uid: string) => schedule.byUid.get(uid)?.title ?? uid,
    [schedule.byUid],
  )

  const seedEvent = seed?.uids.length === 1 ? schedule.byUid.get(seed.uids[0]!) : null
  // From the graph's own node model rather than the list's rows: the list only
  // builds the active day, and the seed is very often not on it.
  const seedStarred = seedEvent
    ? (graph.nodes.find((n) => n.uid === seedEvent.uid)?.starred ?? false)
    : false

  if (!graph.ready) {
    return <Centered>Loading the schedule…</Centered>
  }

  if (!seed || graph.nodes.length === 0) {
    return (
      <div ref={shellRef} className="flex min-h-0 flex-1 flex-col">
        <Toolbar
          lens={lens}
          setLens={setLens}
          degrees={[]}
          right={<span className="text-[11px] text-ink-fringe">nothing seeded</span>}
        />
        <SeedPrompt
          candidates={graph.candidates}
          filteredCount={schedule.filteredCount}
          filterActive={schedule.filterActive}
          cap={SEED_CAP}
          onSeedEvent={(uid) => seedFrom([uid], 'selection')}
          onSeedFilter={() => seedFrom(graph.filteredUids, 'filter')}
        />
      </div>
    )
  }

  const soloSeed = graph.nodes.length === 1
  const bestAlternative = [...graph.seedDegrees]
    .filter((d) => d.lens !== lens && d.degree > 0)
    .sort((a, b) => b.degree - a.degree)[0]

  return (
    <div ref={shellRef} className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        lens={lens}
        setLens={setLens}
        degrees={graph.seedDegrees}
        right={
          <div className="flex items-center gap-2.5">
            {graph.omitted > 0 ? (
              <span className="text-[11px] text-ink-faint">
                showing {graph.nodes.length - seed.uids.length} of{' '}
                {graph.nodes.length - seed.uids.length + graph.omitted}
              </span>
            ) : null}
            {seed.hops === 1 ? (
              <button
                type="button"
                onClick={() => setSeed({ ...seed, hops: 2 })}
                className="rounded-md border border-line px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
              >
                Expand
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSeed({ ...seed, hops: 1 })}
                className="rounded-md border border-line-strong px-2.5 py-1 text-[11.5px] text-ink transition-colors hover:text-ink-bright"
              >
                Collapse
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSeed(null)
                setInspected(null)
              }}
              className="rounded-md px-2 py-1 text-[11.5px] text-ink-faint transition-colors hover:text-ink-dim"
            >
              Clear
            </button>
          </div>
        }
      />

      {seedEvent ? (
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line-soft px-4 py-2">
          <StarButton
            starred={seedStarred}
            onToggle={() => void toggleStar(seedEvent)}
            label={seedEvent.title}
          />
          <span className="truncate text-[12.5px] text-ink-bright">{seedEvent.title}</span>
          <span className="shrink-0 text-[11px] text-ink-faint">
            {seedEvent.room || 'Room TBA'}
          </span>
        </div>
      ) : (
        <div className="shrink-0 border-b border-line-soft px-4 py-2 text-[11.5px] text-ink-dim">
          {seed.uids.length} seeded events
          {graph.seedTruncated
            ? ` — capped from ${graph.seedTruncated.requested.toLocaleString()}`
            : ''}
        </div>
      )}

      <div ref={canvasRef} className="relative min-h-0 flex-1">
        {size.width > 0 ? (
          <ForceGraph2D<GraphNodeObject, GraphLinkObject>
            ref={engine}
            width={size.width}
            height={size.height}
            graphData={graphData}
            backgroundColor="rgba(0,0,0,0)"
            d3AlphaMin={ALPHA_MIN}
            d3VelocityDecay={VELOCITY_DECAY}
            nodeRelSize={4}
            enableNodeDrag={false}
            nodeLabel={(node) => `${node.model.time} · ${node.model.title}`}
            nodeCanvasObject={(node, ctx, scale) =>
              paintNode(
                { ...node.model, x: node.x, y: node.y, selected: node.id === selectedUid },
                ctx,
                scale,
              )
            }
            nodePointerAreaPaint={(node, color, ctx) => {
              if (node.x === undefined || node.y === undefined) return
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(node.x, node.y, 9, 0, Math.PI * 2)
              ctx.fill()
            }}
            linkColor={(link) =>
              linkColor({
                strength: link.link.strength,
                hovered: link.link === hovered,
                inspected: link.link === inspected,
              })
            }
            linkWidth={(link) =>
              linkWidth({
                strength: link.link.strength,
                hovered: link.link === hovered,
                inspected: link.link === inspected,
              })
            }
            linkHoverPrecision={6}
            onNodeClick={(node) => seedFrom([node.id], 'selection')}
            onLinkClick={(link) => setInspected((current) => (current === link.link ? null : link.link))}
            onLinkHover={(link) => setHovered(link?.link ?? null)}
            onBackgroundClick={() => setInspected(null)}
          />
        ) : null}

        {soloSeed ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center">
            <div className="pointer-events-auto max-w-[380px] rounded-lg border border-line bg-ground-850/95 px-3.5 py-2.5 text-center text-[12px] leading-relaxed text-ink-dim backdrop-blur">
              No {LENS_LABEL(lens)} connections — nothing else here {LENS_HINT(lens)}.
              {bestAlternative ? (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => setLens(bestAlternative.lens)}
                    className="text-lumen underline-offset-2 hover:underline"
                  >
                    {LENS_LABEL(bestAlternative.lens)} has {bestAlternative.degree}
                  </button>
                  .
                </>
              ) : (
                ' No other lens connects it either.'
              )}
            </div>
          </div>
        ) : null}

        {inspected ? (
          <EdgeInspector
            link={inspected}
            sourceTitle={titleFor(inspected.source)}
            targetTitle={titleFor(inspected.target)}
            onDismiss={() => setInspected(null)}
          />
        ) : null}

        {!graph.indexReady ? (
          <span className="absolute top-3 left-4 font-mono text-[10px] text-ink-fringe">
            loading people and franchises…
          </span>
        ) : null}
      </div>
    </div>
  )
}

function Toolbar({
  lens,
  setLens,
  degrees,
  right,
}: {
  lens: LensId
  setLens: (lens: LensId) => void
  degrees: { lens: LensId; degree: number }[]
  right: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
      <LensSelector lenses={LENSES} active={lens} onSelect={setLens} degrees={degrees} />
      {right}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center text-[12px] text-ink-faint">{children}</div>
  )
}
