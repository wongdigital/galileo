/**
 * Ghost stars: starred events the feed no longer carries.
 *
 * Rendered struck-through and still visible, from the star's own snapshot
 * fields. This band exists because of what Sched does instead — the event
 * simply stops being there, and you find out when you walk to the room. The
 * snapshot is display-only; nothing here is ever merged back into live data.
 *
 * It sits above the day's rows rather than inline among them because a ghost is
 * not a plan you can act on, it is a plan that needs replacing.
 */

import type { GhostRow } from '@renderer/state/derive'

interface GhostBandProps {
  ghosts: GhostRow[]
  onRemove: (uid: string) => void
}

export function GhostBand({ ghosts, onRemove }: GhostBandProps) {
  if (ghosts.length === 0) return null

  return (
    <div className="border-b border-cancelled/25 bg-cancelled/5">
      <div className="flex items-center gap-2 px-4 pt-2.5 pb-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-cancelled">
          No longer in the schedule
        </span>
        <span className="font-mono text-[11px] text-ink-faint">{ghosts.length}</span>
      </div>

      {ghosts.map(({ star, time }) => (
        <div key={star.uid} className="flex items-center gap-3.5 px-4 pb-2">
          <span className="w-14 shrink-0 text-right font-mono text-[12px] text-ink-faint line-through">
            {time}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[13.5px] leading-tight text-ink-faint line-through decoration-cancelled">
              {star.title || star.uid}
            </span>
            <span className="truncate text-[11.5px] text-ink-faint">
              {star.room || 'Room unrecorded'} — starred, then pulled from the feed
            </span>
          </span>
          <button
            type="button"
            onClick={() => onRemove(star.uid)}
            title="Remove this star"
            className="shrink-0 rounded border border-line px-2 py-1 text-[11px] text-ink-faint transition-colors duration-150 hover:border-cancelled/50 hover:text-cancelled"
          >
            Clear
          </button>
        </div>
      ))}
    </div>
  )
}
