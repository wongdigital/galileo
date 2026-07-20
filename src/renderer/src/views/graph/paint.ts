/**
 * Canvas painting for the entity map.
 *
 * Colours are read from the Observatory custom properties at first paint rather
 * than hard-coded — the tokens in `observatory.css` are the single source, and a
 * canvas that carried its own hex values would be the one surface that quietly
 * stopped matching the rest of the app.
 *
 * ## Two kinds of mark
 *
 * **Event dots** are small and uniform. Their encodings are lens-independent and
 * mean exactly what they mean in the 5-day list and on the card, so a
 * starred-and-cancelled event is as loud here as it is there (R10): star is a
 * warm ring, updated/moved is an amber mark, cancelled is desaturated and struck
 * through. Fringe dots — events no hub claims — keep every one of those marks and
 * lose only the glow, which is what makes them read as receding to the rim
 * without ever being hidden (R5).
 *
 * **Entity hubs** are sized by how many in-scope events they cover. Radius goes
 * as the square root of degree so that *area* tracks the count rather than
 * radius doing it — a hub covering four events looks twice the hub covering one,
 * not four times, which is the honest reading of a circle.
 *
 * ## Labels scale, they do not switch on (R12) — and events opt out entirely
 *
 * There is no degree threshold at which a hub label appears. Instead every hub
 * carries a zoom at which its label becomes readable, and that zoom falls
 * continuously as degree climbs: the biggest hubs are labelled at any zoom, the
 * smallest wait until the user comes closer. The dense core therefore thins out
 * gradually as you zoom rather than flipping between "no labels" and "all
 * labels, overlapping".
 *
 * Event titles paint only on the pinned dot. They once appeared past a deep
 * zoom, and the feel pass showed what that costs: hundreds of grey titles
 * fogging the layer the lens is actually about (the people, the franchises).
 * A dot is never anonymous for the lack of them — hover names it in the
 * tooltip, the click names it on the card — so the painted title's one job is
 * anchoring the open card to its dot.
 *
 * Dimming is a single `globalAlpha` multiplier rather than a second palette,
 * so a dimmed node keeps its own colour and simply recedes (R6/R13).
 */

import type { RowState } from '@renderer/state/derive'

export interface Palette {
  lumen: string
  lumenBright: string
  lumenDim: string
  /** Node marks decouple from the lumen text scale: text darkens in the light
   *  theme for contrast, nodes stay light — an instrument draws light marks. */
  nodeHub: string
  nodeGlow: string
  nodeGlowSoft: string
  nodeEvent: string
  star: string
  moved: string
  cancelled: string
  new: string
  fringe: string
  ink: string
  inkBright: string
  inkDim: string
  line: string
}

let cached: Palette | null = null

/** Theme switches change the tokens under us; the next palette() call
 *  re-reads. The force simulation repaints every frame, so the canvas picks
 *  the new palette up within a tick of the switch. */
export function resetPalette(): void {
  cached = null
}

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
    nodeHub: token('--color-node-hub'),
    nodeGlow: token('--color-node-glow'),
    nodeGlowSoft: token('--color-node-glow-soft'),
    nodeEvent: token('--color-node-event'),
    star: token('--color-star'),
    moved: token('--color-moved'),
    cancelled: token('--color-cancelled'),
    new: token('--color-new'),
    fringe: token('--color-ink-fringe'),
    ink: token('--color-ink'),
    inkBright: token('--color-ink-bright'),
    inkDim: token('--color-ink-dim'),
    line: token('--color-line-strong'),
  }
  return cached
}

export interface PaintEventNode {
  kind: 'event'
  x?: number
  y?: number
  title: string
  /** No hub claims it — the halo (R5). Present, dimmer, still fully encoded. */
  fringe: boolean
  starred: boolean
  states: RowState[]
  /** This event's card is open. */
  pinned: boolean
  dimmed: boolean
}

export interface PaintHubNode {
  kind: 'entity'
  x?: number
  y?: number
  label: string
  /** In-scope events covered. Drives size and label legibility (R12). */
  degree: number
  pinned: boolean
  dimmed: boolean
}

export type PaintMapNode = PaintEventNode | PaintHubNode

const EVENT_RADIUS = { core: 2.4, fringe: 1.8 } as const
const DIM_ALPHA = 0.1
const FRINGE_ALPHA = 0.5

/** Area-proportional in degree, capped so one enormous hub cannot swallow the
 *  view. Exported because the pointer hit area has to agree with it. */
export function hubRadius(degree: number): number {
  return Math.min(16, 3.5 + Math.sqrt(degree) * 1.7)
}

/**
 * Takes only what sizing actually depends on, so the hit-area painter can pass
 * the map's own node model without first dressing it up as a paint node.
 */
export function nodeRadius(
  node: { kind: 'entity'; degree: number } | { kind: 'event'; fringe: boolean },
): number {
  if (node.kind === 'entity') return hubRadius(node.degree)
  return node.fringe ? EVENT_RADIUS.fringe : EVENT_RADIUS.core
}

/**
 * The zoom at which a hub's label becomes readable — continuous in degree, no
 * threshold (R12). A 200-event hub is labelled while zoomed all the way out; a
 * 2-event hub waits until the user is well inside its neighbourhood.
 */
function hubLabelZoom(degree: number): number {
  return 2.6 / Math.sqrt(degree + 1)
}


export function paintMapNode(
  node: PaintMapNode,
  ctx: CanvasRenderingContext2D,
  scale: number,
): void {
  const { x, y } = node
  if (x === undefined || y === undefined) return
  const colors = palette()
  const r = nodeRadius(node)

  ctx.save()
  ctx.globalAlpha = node.dimmed ? DIM_ALPHA : 1

  if (node.kind === 'entity') paintHub(node, ctx, scale, r, colors)
  else paintEvent(node, ctx, scale, r, colors)

  ctx.restore()
}

function paintHub(
  node: PaintHubNode,
  ctx: CanvasRenderingContext2D,
  scale: number,
  r: number,
  colors: Palette,
): void {
  const { x = 0, y = 0 } = node

  // The shipped Observatory glow, scaled by degree. Designing a *new* light
  // treatment is U9's brief (R13) — this only decides how much of the existing
  // one a given hub gets.
  if (!node.dimmed) {
    ctx.shadowColor = colors.nodeGlow
    ctx.shadowBlur = Math.min(24, 6 + node.degree)
  }
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = colors.nodeHub
  ctx.fill()
  ctx.shadowBlur = 0

  if (node.pinned) {
    ctx.beginPath()
    ctx.arc(x, y, r + 4, 0, Math.PI * 2)
    ctx.strokeStyle = colors.nodeHub
    ctx.lineWidth = 1.2
    ctx.setLineDash([2, 2])
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (node.dimmed || scale < hubLabelZoom(node.degree)) return

  const size = Math.max(8.5, (9 + Math.sqrt(node.degree)) / scale)
  ctx.font = `${size}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = colors.ink
  ctx.fillText(truncate(node.label, 34), x, y + r + 3)
}

function paintEvent(
  node: PaintEventNode,
  ctx: CanvasRenderingContext2D,
  scale: number,
  r: number,
  colors: Palette,
): void {
  const { x = 0, y = 0 } = node
  const cancelled = node.states.includes('cancelled')

  // Fringe dots recede by losing the glow and half their opacity — never by
  // being dropped. R5 is explicit that they stay hoverable.
  if (!node.fringe && !node.dimmed) {
    ctx.shadowColor = colors.nodeGlowSoft
    ctx.shadowBlur = 8
  }
  if (node.fringe) ctx.globalAlpha *= FRINGE_ALPHA

  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = cancelled ? colors.cancelled : node.fringe ? colors.fringe : colors.nodeEvent
  ctx.fill()
  ctx.shadowBlur = 0

  // The user's own mark sits outside the node so it survives every lens.
  if (node.starred) {
    ctx.beginPath()
    ctx.arc(x, y, r + 2.5, 0, Math.PI * 2)
    ctx.strokeStyle = colors.star
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  if (node.pinned) {
    ctx.beginPath()
    ctx.arc(x, y, r + 5.5, 0, Math.PI * 2)
    ctx.strokeStyle = colors.nodeHub
    ctx.lineWidth = 0.8
    ctx.setLineDash([2, 2])
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (cancelled) {
    // Struck through, the same gesture the list row uses.
    ctx.beginPath()
    ctx.moveTo(x - r - 2.5, y + r + 2.5)
    ctx.lineTo(x + r + 2.5, y - r - 2.5)
    ctx.strokeStyle = colors.cancelled
    ctx.lineWidth = 1.2
    ctx.stroke()
  } else if (node.states.includes('moved') || node.states.includes('updated')) {
    changeDot(ctx, x + r + 2, y - r - 2, colors.moved)
  } else if (node.states.includes('new')) {
    changeDot(ctx, x + r + 2, y - r - 2, colors.new)
  }

  // Only the pinned dot is titled — see the header. `dimmed` still wins: a
  // pinned event under someone else's hover preview recedes whole.
  if (node.dimmed || !node.pinned) return

  const size = Math.max(8, 10 / scale)
  ctx.font = `${size}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = colors.fringe
  ctx.fillText(truncate(node.title, 26), x, y + r + 3)
}

function changeDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.beginPath()
  ctx.arc(x, y, 1.8, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * Links carry no weight of their own here — one event-entity pair is one fact,
 * and the hub's size already says how many of them it collects. So a link is
 * either part of the neighbourhood under the cursor or it is background.
 */
export function linkColor(active: boolean, dimmed: boolean): string {
  const colors = palette()
  if (dimmed) return withAlpha(colors.lumenDim, 0.04)
  return active ? withAlpha(colors.lumen, 0.75) : withAlpha(colors.lumenDim, 0.16)
}

export function linkWidth(active: boolean): number {
  return active ? 1.4 : 0.5
}

/** The tokens are hex; canvas needs an alpha channel, and appending one is
 *  cheaper than duplicating every colour as an rgb triple in the theme. */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return hex
  const byte = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
  return `#${clean}${byte}`
}
