/**
 * Empty and loading are states of the instrument, not blank panes (U9). Every
 * one of them shows the same small constellation — the app's own subject
 * matter, drawn quiet — over an eyebrow naming the surface and a body line
 * saying what is true right now.
 *
 * Loading pulses the constellation's dots in slow sequence, like a signal
 * arriving; the CSS keeps the animation, so `prefers-reduced-motion` freezes
 * it at mid-brightness without a JS branch. Empty states hold the mark static
 * and dimmer — the instrument is fine, the sky is just clear.
 *
 * The SVG is decorative (`aria-hidden`); when `loading`, the text container is
 * a `role="status"` live region so the state change is announced once.
 */

import type { ReactNode } from 'react'

/** The constellation: one hub, five satellites, drawn from the same visual
 *  vocabulary as the entity map so the blank pane still names the product. */
const DOTS = [
  { cx: 60, cy: 32, r: 4 },
  { cx: 24, cy: 14, r: 2 },
  { cx: 34, cy: 52, r: 2.5 },
  { cx: 88, cy: 12, r: 2.5 },
  { cx: 102, cy: 42, r: 2 },
  { cx: 12, cy: 38, r: 1.5 },
] as const

const EDGES = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 5],
] as const

interface InstrumentStateProps {
  /** Names the surface — rendered as a mono uppercase eyebrow. */
  eyebrow: string
  /** Pulse the constellation and announce via a live region. */
  loading?: boolean
  children: ReactNode
}

export function InstrumentState({ eyebrow, loading = false, children }: InstrumentStateProps) {
  return (
    <div
      role={loading ? 'status' : undefined}
      className="flex flex-col items-center gap-4 px-8 text-center"
    >
      <svg
        aria-hidden="true"
        width="116"
        height="60"
        viewBox="0 0 116 60"
        className={loading ? 'state-loading' : undefined}
      >
        <g stroke="var(--color-line-strong)" strokeWidth="1">
          {EDGES.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              x1={DOTS[a].cx}
              y1={DOTS[a].cy}
              x2={DOTS[b].cx}
              y2={DOTS[b].cy}
            />
          ))}
        </g>
        <g fill={loading ? 'var(--color-node-glow)' : 'var(--color-ink-fringe)'}>
          {DOTS.map((dot) => (
            <circle key={`${dot.cx}-${dot.cy}`} className="state-dot" {...dot} />
          ))}
        </g>
      </svg>
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-dim">
          {eyebrow}
        </span>
        <p className="max-w-[380px] text-[13px] leading-relaxed text-ink-faint">{children}</p>
      </div>
    </div>
  )
}
