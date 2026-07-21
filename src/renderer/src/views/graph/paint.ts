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
  /** Daylight theme active — community hues trade luminosity for pigment. */
  light: boolean
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
    light: document.documentElement.dataset.theme === 'light',
  }
  return cached
}

/**
 * ## Community colour (U9)
 *
 * In a bipartite map every hub *is* a community — its spokes are the whole
 * membership — so "community-coloured edges" means each hub's edges share a
 * hue, and the map reads as constellations instead of one undifferentiated
 * lumen web.
 *
 * The hue derives from the hub id, not from insertion order: it has to
 * survive lens switches, filter edits, and app restarts, or the colours
 * would reshuffle under the user mid-comparison. The wheel is curated
 * rather than a full-spectrum hash — it runs green → cyan → violet →
 * magenta and deliberately skips the warm band, which the signal colours
 * own (star gold, moved amber, cancelled red must never be mistaken for
 * mere membership).
 */
const COMMUNITY_HUES = [95, 130, 165, 185, 205, 225, 250, 275, 300, 325] as const

/** FNV-1a, 32-bit. Stable, cheap, and spreads short prefixed ids well. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Pure — exported for the stability test; the colour functions wrap it. */
export function communityHue(id: string): number {
  const hue = COMMUNITY_HUES[fnv1a(id) % COMMUNITY_HUES.length]
  return hue ?? COMMUNITY_HUES[0]
}

/**
 * Light marks on the dark instrument, pigment on paper — the same law the
 * node tokens follow, applied to a generated hue.
 */
export function communityColor(id: string, alpha: number): string {
  const hue = communityHue(id)
  return palette().light
    ? `hsla(${hue}, 45%, 46%, ${alpha})`
    : `hsla(${hue}, 70%, 68%, ${alpha})`
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
  /** The hub's node id — the community key. Edges hash the same id, so a
   *  hub's nebula and its spokes always agree on a hue. */
  id: string
  label: string
  /** In-scope events covered. Drives size and label legibility (R12). */
  degree: number
  pinned: boolean
  dimmed: boolean
}

export type PaintMapNode = PaintEventNode | PaintHubNode

/** Canvas font shorthand cannot read CSS vars — this mirrors --font-sans in
 *  observatory.css. Keep the two in step if the family ever changes. */
const LABEL_FONT = "'IBM Plex Sans', -apple-system, system-ui, sans-serif"

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


export function paintMapNode(node: PaintMapNode, ctx: CanvasRenderingContext2D): void {
  const { x, y } = node
  if (x === undefined || y === undefined) return
  const colors = palette()
  const r = nodeRadius(node)

  ctx.save()
  ctx.globalAlpha = node.dimmed ? DIM_ALPHA : 1

  if (node.kind === 'entity') paintHub(node, ctx, r, colors)
  else paintEvent(node, ctx, r, colors)

  ctx.restore()
}

function paintHub(
  node: PaintHubNode,
  ctx: CanvasRenderingContext2D,
  r: number,
  colors: Palette,
): void {
  const { x = 0, y = 0 } = node

  // The designed glow (U9, R13): a painted nebula in the hub's community hue
  // rather than the canvas's stock shadowBlur. Two stops shape the falloff —
  // a lit inner shell that hugs the disc, dying to nothing at a degree-scaled
  // radius — so big hubs sit in wide auroras and small ones carry a tight
  // corona. A gradient is also what shadowBlur never was: cheap (no blur
  // convolution per mark) and tuneable per stop.
  if (!node.dimmed) {
    // Daylight alphas run at half the dark theme's weight: pigment on paper
    // accumulates where light on black dissipates, so the same nebula reads
    // twice as heavy there (Roger's call: turned down ~50%).
    const glowRadius = r + Math.min(30, 9 + node.degree * 0.5)
    const nebula = ctx.createRadialGradient(x, y, r * 0.4, x, y, glowRadius)
    nebula.addColorStop(0, communityColor(node.id, colors.light ? 0.25 : 0.42))
    nebula.addColorStop(0.55, communityColor(node.id, colors.light ? 0.1 : 0.16))
    nebula.addColorStop(1, communityColor(node.id, 0))
    ctx.beginPath()
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2)
    ctx.fillStyle = nebula
    ctx.fill()
  }
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = colors.nodeHub
  ctx.fill()

  if (node.pinned) {
    ctx.beginPath()
    ctx.arc(x, y, r + 4, 0, Math.PI * 2)
    ctx.strokeStyle = colors.nodeHub
    ctx.lineWidth = 1.2
    ctx.setLineDash([2, 2])
    ctx.stroke()
    ctx.setLineDash([])
  }

}

function paintEvent(
  node: PaintEventNode,
  ctx: CanvasRenderingContext2D,
  r: number,
  colors: Palette,
): void {
  const { x = 0, y = 0 } = node
  const cancelled = node.states.includes('cancelled')

  // Fringe dots recede by losing the glow and half their opacity — never by
  // being dropped. R5 is explicit that they stay hoverable.
  if (node.fringe) ctx.globalAlpha *= FRINGE_ALPHA

  // The dot's glow is two translucent shells rather than a gradient: at four
  // thousand dots per frame the gradient allocation is real money, and at a
  // 2.4px radius antialiasing melts the steps into a soft corona anyway.
  if (!node.fringe && !node.dimmed) {
    const glow = cancelled ? colors.cancelled : colors.nodeGlowSoft
    ctx.beginPath()
    ctx.arc(x, y, r + 4, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(glow, 0.09)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, r + 1.6, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(glow, 0.2)
    ctx.fill()
  }

  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = cancelled ? colors.cancelled : node.fringe ? colors.fringe : colors.nodeEvent
  ctx.fill()

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
}

/**
 * ## The label pass (U9)
 *
 * Labels do not paint with their nodes. They paint once per frame, after every
 * mark, in a single pass that owns a collision registry — because a label's
 * one failure mode is another label, and nodes painting blind to each other is
 * how the zoomed-out map became a fog of overprinted names.
 *
 * Priority is legibility's order, not paint order: the pinned title first (it
 * anchors an open card and must never lose its name), then hubs loudest-first,
 * so when space runs out it is the small hubs that go quiet. A candidate whose
 * rectangle intersects any claimed rectangle is skipped whole — a name is
 * either readable or absent, never a layered smear. Zooming in shrinks label
 * rectangles in graph space, so the skipped names surface as room appears;
 * R12's continuous-legibility rule keeps working, this pass just adds "and
 * never on top of each other".
 */
export type LabelCandidate =
  | { kind: 'hub'; x: number; y: number; r: number; label: string; degree: number; pinned: boolean }
  /** Only the pinned dot ever titles — see the header. */
  | { kind: 'event'; x: number; y: number; r: number; title: string }

interface Rect {
  x1: number
  y1: number
  x2: number
  y2: number
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1

export function paintMapLabels(
  candidates: readonly LabelCandidate[],
  ctx: CanvasRenderingContext2D,
  scale: number,
): void {
  const colors = palette()
  const ordered = [...candidates].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1
    if (a.kind === 'hub' && b.kind === 'hub') {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.degree - a.degree
    }
    return 0
  })

  const claimed: Rect[] = []
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  for (const c of ordered) {
    const hub = c.kind === 'hub'
    // The pinned hub bypasses the zoom threshold: its card is open, and a card
    // pointing at an unnamed dot reads as a broken pointer.
    if (hub && !c.pinned && scale < hubLabelZoom(c.degree)) continue

    const size = hub ? Math.max(8.5, (9 + Math.sqrt(c.degree)) / scale) : Math.max(8, 10 / scale)
    ctx.font = `${size}px ${LABEL_FONT}`
    const text = truncate(hub ? c.label : c.title, hub ? 34 : 26)
    const width = ctx.measureText(text).width
    const top = c.y + c.r + 3
    // Breathing room so two names that merely touch still refuse to kiss.
    const rect: Rect = {
      x1: c.x - width / 2 - size * 0.3,
      y1: top - size * 0.15,
      x2: c.x + width / 2 + size * 0.3,
      y2: top + size * 1.15,
    }
    const anchored = !hub || c.pinned
    if (!anchored && claimed.some((taken) => overlaps(rect, taken))) continue

    claimed.push(rect)
    ctx.fillStyle = hub ? colors.ink : colors.fringe
    ctx.fillText(text, c.x, top)
  }

  ctx.restore()
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
 * and the hub's size already says how many of them it collects. What a link
 * *does* carry is membership: at rest it wears its hub's community hue (U9),
 * so adjacent constellations separate at a glance instead of merging into one
 * lumen web. The focused neighbourhood still lights in lumen — focus is the
 * instrument's light, not a community's.
 */
export function linkColor(active: boolean, dimmed: boolean, hubId?: string): string {
  const colors = palette()
  if (dimmed) return hubId ? communityColor(hubId, 0.05) : withAlpha(colors.lumenDim, 0.04)
  if (active) return withAlpha(colors.lumen, 0.75)
  if (hubId) return communityColor(hubId, colors.light ? 0.3 : 0.2)
  return withAlpha(colors.lumenDim, 0.16)
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
