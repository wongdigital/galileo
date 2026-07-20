/**
 * The navigator — a Photoshop-style inset: the whole constellation at a
 * glance, a rectangle showing where the viewport sits inside it, and drag or
 * click to move that rectangle.
 *
 * Deliberately inert as far as React is concerned. It renders one <canvas> and
 * never sets state: node positions are mutated in place by the simulation (the
 * object-constancy contract the node cache holds), so a timer reads them
 * straight off the same objects the main canvas draws. No props churn per
 * frame, no re-renders, and in jsdom — which has no 2D context — every draw
 * guards on `getContext` returning null and the component degrades to an
 * inert box the tests can still find.
 *
 * The viewport rectangle is derived from the engine's own zoom and center
 * getters rather than tracked separately, so it cannot drift from what the
 * main canvas actually shows — pans, wheel zooms, and programmatic fits all
 * land here for free on the next tick.
 */

import { useEffect, useRef, type RefObject } from 'react'
import { useTheme } from '@renderer/state/theme'
import type { ForceGraphMethods } from 'react-force-graph-2d'
import { palette, withAlpha } from './paint'
import type { GraphLinkObject, GraphNodeObject } from './useNodeCache'

const WIDTH = 168
const HEIGHT = 112
const PADDING = 8

/** Position-reading cadence. Fast enough that the rectangle tracks a drag on
 *  the main canvas without visible lag; slow enough that redrawing ~4,000
 *  dots stays a rounding error next to the simulation itself. */
const REDRAW_MS = 120

type Engine = ForceGraphMethods<GraphNodeObject, GraphLinkObject>

interface MiniMapProps {
  /** The drawn nodes — the cache's array, whose objects carry live x/y. */
  nodes: readonly GraphNodeObject[]
  engine: RefObject<Engine | undefined>
  /** The main canvas size, for the viewport rectangle. */
  viewWidth: number
  viewHeight: number
}

/** Canvas-pixel -> graph mapping of the last draw, kept for pointer events. */
interface Mapping {
  scale: number
  centerX: number
  centerY: number
}

export function MiniMap({ nodes, engine, viewWidth, viewHeight }: MiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const mapping = useRef<Mapping | null>(null)
  const dragging = useRef(false)
  // A theme switch redefines the tokens this canvas painted with; reading the
  // theme here puts it in the draw effect's deps so the mini-map repaints.
  const { theme } = useTheme()

  useEffect(() => {
    const draw = (): void => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return

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

      ctx.clearRect(0, 0, WIDTH, HEIGHT)
      if (minX === Infinity) {
        mapping.current = null
        return
      }

      const scale = Math.min(
        (WIDTH - PADDING * 2) / Math.max(1, maxX - minX),
        (HEIGHT - PADDING * 2) / Math.max(1, maxY - minY),
      )
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2
      mapping.current = { scale, centerX, centerY }

      const toMiniX = (x: number): number => WIDTH / 2 + (x - centerX) * scale
      const toMiniY = (y: number): number => HEIGHT / 2 + (y - centerY) * scale

      const colors = palette()
      // Dots only, hubs after events so they read on top. Labels have no
      // business at this size.
      for (const node of nodes) {
        if (node.x === undefined || node.y === undefined) continue
        if (node.model.kind !== 'event') continue
        ctx.fillStyle =
          node.model.fringe ? withAlpha(colors.fringe, 0.45) : withAlpha(colors.nodeEvent, 0.8)
        ctx.fillRect(toMiniX(node.x) - 0.75, toMiniY(node.y) - 0.75, 1.5, 1.5)
      }
      for (const node of nodes) {
        if (node.x === undefined || node.y === undefined) continue
        if (node.model.kind !== 'entity') continue
        ctx.fillStyle = colors.nodeHub
        ctx.fillRect(toMiniX(node.x) - 1.25, toMiniY(node.y) - 1.25, 2.5, 2.5)
      }

      // The viewport, from the engine's own transform.
      const view = engine.current
      if (!view || viewWidth <= 0) return
      const zoom = view.zoom()
      const center = view.centerAt()
      if (!zoom || !center) return
      const w = (viewWidth / zoom) * scale
      const h = (viewHeight / zoom) * scale
      // White, not lumen — the viewport rectangle has to read against a field
      // of blue hub dots, and a blue outline disappears into them.
      ctx.strokeStyle = withAlpha(colors.inkBright, 0.95)
      ctx.lineWidth = 1
      ctx.strokeRect(toMiniX(center.x) - w / 2, toMiniY(center.y) - h / 2, w, h)
      ctx.fillStyle = withAlpha(colors.inkBright, 0.08)
      ctx.fillRect(toMiniX(center.x) - w / 2, toMiniY(center.y) - h / 2, w, h)
    }

    draw()
    const timer = window.setInterval(draw, REDRAW_MS)
    return () => window.clearInterval(timer)
  }, [nodes, engine, viewWidth, viewHeight, theme])

  /** A press is a jump, a drag is a continuous pan — both are just "center the
   *  view where the pointer says", instantly (0ms: an animated pan would lag
   *  the pointer and then fight its next move). */
  const panTo = (clientX: number, clientY: number): void => {
    const canvas = canvasRef.current
    const map = mapping.current
    const view = engine.current
    if (!canvas || !map || !view) return
    const rect = canvas.getBoundingClientRect()
    const graphX = (clientX - rect.left - WIDTH / 2) / map.scale + map.centerX
    const graphY = (clientY - rect.top - HEIGHT / 2) / map.scale + map.centerY
    view.centerAt(graphX, graphY, 0)
  }

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      data-testid="minimap"
      aria-label="Map navigator"
      className="absolute bottom-4 left-4 z-10 cursor-crosshair rounded-lg border border-line bg-ground-850/90 backdrop-blur"
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        panTo(e.clientX, e.clientY)
      }}
      onPointerMove={(e) => {
        if (dragging.current) panTo(e.clientX, e.clientY)
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
    />
  )
}
