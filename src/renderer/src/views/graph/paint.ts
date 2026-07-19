/**
 * Canvas painting for the graph.
 *
 * Colours are read from the Observatory custom properties at first paint rather
 * than hard-coded — the tokens in `observatory.css` are the single source, and a
 * canvas that carried its own hex values would be the one surface that quietly
 * stopped matching the rest of the app.
 *
 * The node encodings are lens-independent and mean exactly what they mean in the
 * 5-day list, so a starred-and-cancelled event is as loud here as it is there
 * (AE4): star is a warm ring, updated/moved is an amber mark, cancelled is
 * desaturated and struck through.
 */

import type { RowState } from '@renderer/state/derive'

export interface Palette {
  lumen: string
  lumenBright: string
  lumenDim: string
  star: string
  moved: string
  cancelled: string
  new: string
  fringe: string
  ink: string
  inkDim: string
  line: string
}

let cached: Palette | null = null

/** Read once, after stylesheets have applied. Cheap enough to be lazy and
 *  wrong enough to be worth not doing at module scope. */
export function palette(): Palette {
  if (cached) return cached
  const style = getComputedStyle(document.documentElement)
  const token = (name: string): string => style.getPropertyValue(name).trim()
  cached = {
    lumen: token('--color-lumen'),
    lumenBright: token('--color-lumen-bright'),
    lumenDim: token('--color-lumen-dim'),
    star: token('--color-star'),
    moved: token('--color-moved'),
    cancelled: token('--color-cancelled'),
    new: token('--color-new'),
    fringe: token('--color-ink-fringe'),
    ink: token('--color-ink'),
    inkDim: token('--color-ink-dim'),
    line: token('--color-line-strong'),
  }
  return cached
}

export interface PaintNode {
  x?: number
  y?: number
  seed: boolean
  fringe: boolean
  starred: boolean
  states: RowState[]
  title: string
  selected: boolean
}

const RADIUS = { seed: 7, normal: 4.5, fringe: 2.5 } as const

function nodeRadius(node: PaintNode): number {
  if (node.seed) return RADIUS.seed
  return node.fringe ? RADIUS.fringe : RADIUS.normal
}

function nodeColor(node: PaintNode, colors: Palette): string {
  if (node.states.includes('cancelled')) return colors.cancelled
  if (node.fringe) return colors.fringe
  if (node.seed) return colors.lumenBright
  return colors.lumen
}

/**
 * Glow via `shadowBlur` — the Observatory's luminous-node look, and the reason
 * the ground is a blue-cast near-black rather than pure #000. Fringe nodes get
 * none of it, which is what makes them read as receding to the rim.
 */
export function paintNode(node: PaintNode, ctx: CanvasRenderingContext2D, scale: number): void {
  const { x, y } = node
  if (x === undefined || y === undefined) return
  const colors = palette()
  const r = nodeRadius(node)
  const color = nodeColor(node, colors)

  ctx.save()

  if (!node.fringe) {
    ctx.shadowColor = node.seed ? colors.lumen : colors.lumenDim
    ctx.shadowBlur = node.seed ? 22 : 10
  }
  ctx.globalAlpha = node.fringe ? 0.55 : 1
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.globalAlpha = 1

  // The user's own mark sits outside the node so it survives every lens.
  if (node.starred) {
    ctx.beginPath()
    ctx.arc(x, y, r + 3, 0, Math.PI * 2)
    ctx.strokeStyle = colors.star
    ctx.lineWidth = 1.4
    ctx.stroke()
  }

  if (node.selected) {
    ctx.beginPath()
    ctx.arc(x, y, r + 6.5, 0, Math.PI * 2)
    ctx.strokeStyle = colors.lumenBright
    ctx.lineWidth = 0.8
    ctx.setLineDash([2, 2])
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (node.states.includes('cancelled')) {
    // Struck through, the same gesture the list row uses.
    ctx.beginPath()
    ctx.moveTo(x - r - 3, y + r + 3)
    ctx.lineTo(x + r + 3, y - r - 3)
    ctx.strokeStyle = colors.cancelled
    ctx.lineWidth = 1.4
    ctx.stroke()
  } else if (node.states.includes('moved') || node.states.includes('updated')) {
    ctx.beginPath()
    ctx.arc(x + r + 2, y - r - 2, 2, 0, Math.PI * 2)
    ctx.fillStyle = colors.moved
    ctx.fill()
  } else if (node.states.includes('new')) {
    ctx.beginPath()
    ctx.arc(x + r + 2, y - r - 2, 2, 0, Math.PI * 2)
    ctx.fillStyle = colors.new
    ctx.fill()
  }

  // Labels appear as you zoom in, and always on the seed. A constellation at
  // low zoom is shapes; reading it is what zooming is for.
  if (node.seed || scale > 1.6) {
    const size = Math.max(9, 11 / scale)
    ctx.font = `${size}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = node.seed ? colors.ink : colors.inkDim
    ctx.fillText(truncate(node.title, node.seed ? 42 : 28), x, y + r + 4)
  }

  ctx.restore()
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export interface PaintLink {
  strength: number
  hovered: boolean
  inspected: boolean
}

/** Stronger edges are brighter and thicker: a shared co-panelist should look
 *  like more than a shared genre, because it is. */
export function linkColor(link: PaintLink): string {
  const colors = palette()
  if (link.inspected) return colors.lumenBright
  if (link.hovered) return colors.lumen
  const alpha = Math.min(0.5, 0.12 + link.strength * 0.5)
  return withAlpha(colors.lumenDim, alpha)
}

export function linkWidth(link: PaintLink): number {
  if (link.inspected) return 2.2
  return Math.min(1.8, 0.5 + link.strength * 1.5)
}

/** The tokens are hex; canvas needs an alpha channel, and appending one is
 *  cheaper than duplicating every colour as an rgb triple in the theme. */
function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return hex
  const byte = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
  return `#${clean}${byte}`
}
