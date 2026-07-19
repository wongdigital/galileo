/**
 * SPIKE (task #9) — the event↔entity graph, rendered so it can be judged.
 *
 * Not shippable and not tested: it exists so the "is 860 nodes too many to look
 * at" question gets answered by looking rather than by arithmetic. Knobs are
 * exposed in the bar rather than tuned to a guess, because which pruning
 * threshold reads well is exactly what is unknown.
 *
 * Deliberately self-contained — its own painter, its own layout params, no reuse
 * of `useNodeCache` or `paint.ts`'s node encodings. When the model this implies
 * gets designed for real (task #10), this file is replaced, not extended.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { useSpine } from '@renderer/state/spine'
import { useSchedule } from '@renderer/state/useSchedule'
import { useGraph } from '@renderer/state/useGraph'
import { buildBipartite, type BipartiteNode } from '@shared/graph'
import { palette } from './paint'

interface NodeObject extends BipartiteNode {
  x?: number
  y?: number
}
interface LinkObject {
  source: string | NodeObject
  target: string | NodeObject
}

const DEGREE_CHOICES = [1, 2, 3, 5] as const

function useSize(): [(el: HTMLDivElement | null) => void, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!element) return
    if (typeof ResizeObserver === 'undefined') {
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

export function BipartiteSpike() {
  const { lens, selectedUid, setSelectedUid } = useSpine()
  const schedule = useSchedule()
  const graph = useGraph()

  const [minDegree, setMinDegree] = useState(2)
  const [wholeCorpus, setWholeCorpus] = useState(false)
  const [showIsolated, setShowIsolated] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)

  const engine = useRef<ForceGraphMethods<NodeObject, LinkObject> | undefined>(undefined)
  const [canvasRef, size] = useSize()

  const scopeUids = useMemo(
    () => (wholeCorpus ? [...schedule.byUid.keys()] : schedule.filteredUids),
    [wholeCorpus, schedule.byUid, schedule.filteredUids],
  )

  const built = useMemo(() => {
    const index = graph.indexes.get(lens)
    if (!index) return null
    return buildBipartite(index, scopeUids, {
      minEntityDegree: minDegree,
      includeIsolatedEvents: showIsolated,
    })
  }, [graph.indexes, lens, scopeUids, minDegree, showIsolated])

  // Titles are resolved here rather than in the builder so the pure layer stays
  // free of the schedule.
  const graphData = useMemo(() => {
    if (!built) return { nodes: [], links: [] }
    return {
      nodes: built.nodes.map((node) => ({
        ...node,
        label: node.kind === 'event' ? (schedule.byUid.get(node.uid!)?.title ?? node.label) : node.label,
      })),
      links: built.links.map((link) => ({ ...link })),
    }
  }, [built, schedule.byUid])

  // Hovering an entity is the whole point of the spike: it should light up every
  // program that entity appears in, which is the question the event-only graph
  // could not answer.
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>()
    if (!built) return map
    const add = (a: string, b: string) => {
      const bucket = map.get(a)
      if (bucket) bucket.add(b)
      else map.set(a, new Set([b]))
    }
    for (const link of built.links) {
      add(link.source, link.target)
      add(link.target, link.source)
    }
    return map
  }, [built])

  const lit = useMemo(() => {
    if (!hovered) return null
    const set = neighbours.get(hovered) ?? new Set<string>()
    return new Set([hovered, ...set])
  }, [hovered, neighbours])

  // Charge has to scale down as the node count climbs or a 2,000-node set flies
  // apart faster than the viewport can follow.
  useEffect(() => {
    const view = engine.current
    if (!view) return
    const count = graphData.nodes.length
    view.d3Force('charge')?.strength(count > 900 ? -14 : -40)
    view.d3Force('link')?.distance(count > 900 ? 14 : 26)
  }, [graphData.nodes.length])

  const paint = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, scale: number) => {
      const { x, y } = node
      if (x === undefined || y === undefined) return
      const colors = palette()
      const entity = node.kind === 'entity'
      const dim = lit ? !lit.has(node.id) : false

      const radius = entity ? Math.min(14, 3 + Math.sqrt(node.degree) * 1.7) : 2.2

      ctx.save()
      ctx.globalAlpha = dim ? 0.12 : 1

      if (entity && !dim) {
        ctx.shadowColor = colors.lumen
        ctx.shadowBlur = Math.min(24, 6 + node.degree)
      }
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = entity ? colors.lumenBright : colors.inkDim
      ctx.fill()
      ctx.shadowBlur = 0

      if (!entity && node.uid === selectedUid) {
        ctx.beginPath()
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2)
        ctx.strokeStyle = colors.star
        ctx.lineWidth = 1.2
        ctx.stroke()
      }

      // Entity labels ride the node size: the hubs stay readable zoomed out,
      // everything else waits for the user to come closer.
      const labelled = entity ? node.degree >= 6 || scale > 1.1 : scale > 2.6
      if (labelled && !dim) {
        const size = Math.max(8, (entity ? 12 : 10) / scale)
        ctx.font = `${size}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = entity ? colors.ink : colors.fringe
        const max = entity ? 34 : 26
        const text = node.label.length <= max ? node.label : `${node.label.slice(0, max - 1)}…`
        ctx.fillText(text, x, y + radius + 3)
      }

      ctx.restore()
    },
    [lit, selectedUid],
  )

  const counts = built
    ? {
        entities: built.nodes.filter((n) => n.kind === 'entity').length,
        events: built.nodes.filter((n) => n.kind === 'event').length,
      }
    : { entities: 0, events: 0 }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5 text-[11.5px] text-ink-dim">
        <label className="flex items-center gap-1.5">
          <span className="text-ink-faint">min entity size</span>
          {DEGREE_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setMinDegree(n)}
              className={[
                'rounded px-1.5 py-0.5 tabular-nums transition-colors',
                minDegree === n ? 'bg-ground-700 text-ink-bright' : 'text-ink-faint hover:text-ink',
              ].join(' ')}
            >
              {n}
            </button>
          ))}
        </label>

        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={wholeCorpus} onChange={(e) => setWholeCorpus(e.target.checked)} />
          whole schedule
        </label>

        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={showIsolated} onChange={(e) => setShowIsolated(e.target.checked)} />
          unconnected events
        </label>

        <span className="ml-auto font-mono text-[11px] text-ink-faint tabular-nums">
          {counts.entities} entities · {counts.events} events · {built?.links.length ?? 0} links
          {built && built.droppedEvents > 0 && !showIsolated ? ` · ${built.droppedEvents} hidden` : ''}
        </span>
      </div>

      <div ref={canvasRef} className="relative min-h-0 flex-1">
        {size.width > 0 ? (
          <ForceGraph2D<NodeObject, LinkObject>
            ref={engine}
            width={size.width}
            height={size.height}
            graphData={graphData}
            backgroundColor="rgba(0,0,0,0)"
            d3AlphaMin={0.05}
            d3VelocityDecay={0.4}
            cooldownTime={4000}
            // Fit when the layout stops rather than on a timer: at these node
            // counts the settle outlasts any fixed delay, and fitting early
            // frames a shape that is still flying apart.
            onEngineStop={() => engine.current?.zoomToFit(400, 60)}
            enableNodeDrag={false}
            nodeLabel={(node) => (node.kind === 'entity' ? `${node.label} — ${node.degree} events` : node.label)}
            nodeCanvasObject={paint}
            nodePointerAreaPaint={(node, color, ctx) => {
              if (node.x === undefined || node.y === undefined) return
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(node.x, node.y, node.kind === 'entity' ? 12 : 6, 0, Math.PI * 2)
              ctx.fill()
            }}
            linkColor={() => (lit ? '#ffffff14' : '#ffffff22')}
            linkWidth={0.5}
            onNodeHover={(node) => setHovered(node?.id ?? null)}
            onNodeClick={(node) => {
              if (node.kind === 'event' && node.uid) setSelectedUid(node.uid)
            }}
          />
        ) : null}

        {graphData.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-faint">
            Nothing survives this threshold under {lens}.
          </div>
        ) : null}
      </div>
    </div>
  )
}
