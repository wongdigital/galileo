/**
 * One list row. Fixed height, because the virtualizer measuring every row is
 * work the list does not need to do at 1,000 rows — the design commits to a
 * two-line row and truncates instead of reflowing.
 */

import type { RowModel, RowState } from '@renderer/state/derive'
import { trackKey } from '@shared/enrichment'
import { StarButton } from './StarButton'

export const ROW_HEIGHT = 64

const STATE_STYLE: Record<RowState, { label: string; className: string }> = {
  new: { label: 'NEW', className: 'text-new border-new/40 bg-new/10' },
  moved: { label: 'MOVED', className: 'text-moved border-moved/40 bg-moved/10' },
  updated: { label: 'UPDATED', className: 'text-moved border-moved/30 bg-moved/5' },
  cancelled: { label: 'CANCELLED', className: 'text-cancelled border-cancelled/50 bg-cancelled/10' },
}

function StateBadge({ state }: { state: RowState }) {
  const style = STATE_STYLE[state]
  return (
    <span
      className={`rounded border px-1.5 py-px font-mono text-[10px] font-medium tracking-[0.1em] ${style.className}`}
    >
      {style.label}
    </span>
  )
}

/** Describes what moved, when the diff recorded enough to say. Coarse flags are
 *  what the sprint ships; the field-level story is Phase B. */
function changeDetail(row: RowModel): string | null {
  for (const change of row.changes) {
    if (change.kind === 'moved-room' && change.from) return `was ${change.from}`
    if (change.kind === 'moved-start' && change.from) return 'time changed'
  }
  return null
}

interface EventRowProps {
  row: RowModel
  selected: boolean
  onSelect: () => void
  onToggleStar: () => void
  onAcknowledge: () => void
}

export function EventRow({ row, selected, onSelect, onToggleStar, onAcknowledge }: EventRowProps) {
  const cancelled = row.states.includes('cancelled')
  const detail = changeDetail(row)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      style={{ height: ROW_HEIGHT }}
      className={[
        'group flex cursor-default items-center gap-3.5 border-l-2 px-4 transition-colors duration-150',
        selected ? 'border-l-lumen bg-ground-800' : 'border-l-transparent hover:bg-ground-850',
        // Starred + cancelled is loud on purpose: it is a plan that stopped
        // being a plan, and a quiet badge is exactly how you miss that (AE4).
        row.loud ? 'bg-cancelled/10 shadow-[inset_0_0_0_1px_var(--color-cancelled)]' : '',
      ].join(' ')}
    >
      <span
        className={`w-14 shrink-0 text-right font-mono text-[12px] ${
          cancelled ? 'text-cancelled/70' : 'text-ink-dim'
        }`}
      >
        {row.time}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span
            className={[
              'truncate text-[13.5px] leading-tight',
              cancelled ? 'text-ink-faint line-through decoration-cancelled' : '',
              !cancelled && selected ? 'text-ink-bright' : '',
              !cancelled && !selected ? 'text-ink' : '',
            ].join(' ')}
          >
            {row.event.title}
          </span>
          {row.states.map((state) => (
            <StateBadge key={state} state={state} />
          ))}
        </span>
        <span className="flex items-center gap-2 truncate text-[11.5px] text-ink-faint">
          <span className="truncate">{row.event.room || 'Room TBA'}</span>
          {row.duration ? <span className="text-ink-fringe">·</span> : null}
          {row.duration ? <span>{row.duration}</span> : null}
          {row.event.track ? <span className="text-ink-fringe">·</span> : null}
          {row.event.track ? <span className="truncate">{trackKey(row.event.track)}</span> : null}
          {detail ? <span className="text-moved">· {detail}</span> : null}
        </span>
      </span>

      {row.changes.length > 0 ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onAcknowledge()
          }}
          title="Dismiss this change flag"
          className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-faint opacity-0 transition-opacity duration-150 hover:border-line-strong hover:text-ink-dim group-hover:opacity-100"
        >
          Seen
        </button>
      ) : null}

      <StarButton starred={row.starred} onToggle={onToggleStar} label={row.event.title} />
    </div>
  )
}
