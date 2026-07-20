import { dayLabel, formatTime, localParts } from '@renderer/state/derive'
import type { ProposedAction } from '@shared/chat'

function whenLabel(iso: string | null): string {
  const parts = localParts(iso)
  const time = formatTime(iso)
  return parts ? `${dayLabel(parts.date).weekday} ${time}` : time
}

export function ActionCard({
  action,
  state,
  resultNote,
  onConfirm,
  onDismiss,
}: {
  action: ProposedAction
  state: 'pending' | 'done' | 'cancelled'
  /** Set after a confirm that did not fully succeed (partial star, empty export). */
  resultNote?: string
  onConfirm: () => void
  onDismiss: () => void
}) {
  const verb = action.kind === 'star' ? 'Star' : 'Export'
  return (
    <div className="rounded-lg border border-line bg-ground-900 px-3 py-2.5">
      {action.note ? <p className="mb-1.5 text-[11.5px] text-ink-dim">{action.note}</p> : null}
      <ul className="mb-2 flex flex-col gap-0.5">
        {action.events.map((e) => (
          <li key={e.uid} className="truncate text-[11.5px] text-ink">
            {e.title} <span className="text-ink-faint">· {whenLabel(e.start)}</span>
          </li>
        ))}
      </ul>
      {state === 'pending' ? (
        <>
          {resultNote ? <p className="mb-1.5 text-[11px] text-cancelled">{resultNote}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-md border border-lumen-dim bg-lumen/10 px-2.5 py-1 text-[11.5px] text-ink-bright hover:bg-lumen/20"
            >
              {verb} {action.events.length}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md px-2.5 py-1 text-[11.5px] text-ink-faint hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        </>
      ) : (
        <p className="text-[11px] text-ink-faint">
          {state === 'done'
            ? resultNote ?? (verb === 'Star' ? 'Starred.' : 'Exported.')
            : 'Dismissed.'}
        </p>
      )}
    </div>
  )
}
