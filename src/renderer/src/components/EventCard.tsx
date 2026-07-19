/**
 * The event card — the first place in this app where Sched's own prose is
 * readable (R9), and the one component both views share (R11).
 *
 * Docked, not modal, for the same reason the edge inspector was: the map
 * underneath stays live, so a click on another node replaces the card's
 * contents rather than stacking a second thing to dismiss. The host owns
 * placement and dismissal; the card only ever *asks* to be dismissed.
 *
 * Two rules this file exists to hold:
 *
 * - **Badges come from the diff engine, not from Sched.** `buildRow` already
 *   folds both sources into `RowState`, and `moved` — the state that catches a
 *   room change Sched never flagged — only exists there. Reading `event.flags`
 *   here would reintroduce exactly the blind spot the snapshot diff was built
 *   to close.
 * - **A UID can resolve to nothing.** Events leave the feed with no CANCELLED
 *   flag first (two did in a 31-hour window; see
 *   docs/solutions/2026-07-18-uid-is-the-identity-key.md). A starred UID that
 *   vanished renders from the star record's snapshot, which is the only record
 *   the plan ever existed. An unstarred one dismisses. Neither throws, and
 *   neither leaves a blank shell on screen.
 */

import { useEffect, useMemo, type ReactNode } from 'react'
import { buildRow, formatTime, type RowState } from '@renderer/state/derive'
import { useSpine } from '@renderer/state/spine'
import { StarButton } from '@renderer/views/schedule/StarButton'
import type { EventClassification } from '@shared/enrichment'
import type { ScheduleEvent } from '@shared/schedule'

/** `buildRow` reads classifications only for the duration label, which the card
 *  does not show — the row gutter already carries it in the list. */
const NO_CLASSES: ReadonlyMap<string, EventClassification> = new Map()

const STATE_STYLE: Record<RowState, { label: string; className: string }> = {
  new: { label: 'NEW', className: 'text-new border-new/40 bg-new/10' },
  moved: { label: 'MOVED', className: 'text-moved border-moved/40 bg-moved/10' },
  updated: { label: 'UPDATED', className: 'text-moved border-moved/30 bg-moved/5' },
  cancelled: { label: 'CANCELLED', className: 'text-cancelled border-cancelled/50 bg-cancelled/10' },
}

/** Same treatment as the list row's badge. It lives here rather than being
 *  imported because `EventRow` keeps its copy private; when that file is next
 *  touched, the two should collapse into this one. */
export function StateBadge({ state }: { state: RowState }) {
  const style = STATE_STYLE[state]
  return (
    <span
      className={`rounded border px-1.5 py-px font-mono text-[9px] font-medium tracking-[0.1em] ${style.className}`}
    >
      {style.label}
    </span>
  )
}

/** Live events by UID. Rebuilt only when the dataset swaps, so a star click or
 *  a hover does not walk 3,474 events. */
export function useEventLookup(): ReadonlyMap<string, ScheduleEvent> {
  const { dataset } = useSpine()
  const events = dataset?.events
  return useMemo(() => new Map((events ?? []).map((event) => [event.uid, event])), [events])
}

interface CardShellProps {
  eyebrow: string
  dismissLabel: string
  onDismiss: () => void
  children: ReactNode
}

/**
 * The docked panel itself. Bounded height with the scroll living *inside*, so a
 * 900-word Sched description scrolls in place rather than growing the card off
 * the bottom of whichever view is hosting it.
 */
export function CardShell({ eyebrow, dismissLabel, onDismiss, children }: CardShellProps) {
  return (
    <aside
      className="pointer-events-auto absolute right-4 bottom-4 z-10 flex max-h-[min(70%,28rem)] w-[320px] flex-col rounded-xl border border-line-strong bg-ground-850/95 p-3.5 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur"
      // The canvas sits underneath and stays interactive; a click inside the
      // panel must not travel down and re-pin whatever is behind it.
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 items-start justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.12em] text-ink-faint">{eyebrow}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="-m-1 rounded p-1 text-ink-faint transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {children}
    </aside>
  )
}

interface EventCardProps {
  /** The event to describe. Host-supplied — in the list this is `selectedUid`,
   *  on the map it is the pinned event dot. */
  uid: string
  /** Called when the card has nothing left to show, and when the user closes
   *  it. The host owns the pin; the card never clears it itself (R7). */
  onDismiss: () => void
}

export function EventCard({ uid, onDismiss }: EventCardProps) {
  const { dataset, status, stars, toggleStar, removeStar } = useSpine()
  const byUid = useEventLookup()

  const event = byUid.get(uid)
  const star = stars.find((s) => s.uid === uid) ?? null

  const starredUids = useMemo(() => new Set(stars.map((s) => s.uid)), [stars])

  // A UID with no event and no star describes nothing at all — ask the host to
  // let go of it rather than render an empty frame.
  //
  // Gated on a loaded dataset, because during the first frames *every* uid
  // resolves to nothing and an ungated check would throw the pin away before
  // the data it referred to had arrived. The narrower race — dataset in hand
  // while `stars.get` is still in flight, which would dismiss a ghost that is
  // about to become renderable — is not worth guarding: a uid only reaches this
  // card by being clicked on something already drawn, so the dismissal path
  // fires mid-session, long after the star file has been read.
  const loaded = status === 'ready' && dataset !== null
  const orphaned = loaded && !event && !star
  useEffect(() => {
    if (orphaned) onDismiss()
  }, [orphaned, onDismiss])

  if (!event) {
    if (!star) return null

    // Ghost: everything on screen comes from the star's display-only snapshot,
    // which is deliberately never merged back into live event data.
    return (
      <CardShell eyebrow="EVENT" dismissLabel="Close event card" onDismiss={onDismiss}>
        <div className="mt-1.5 flex shrink-0 items-start gap-2">
          <h2 className="min-w-0 flex-1 text-[15px] leading-snug text-ink-faint line-through decoration-cancelled">
            {star.title || 'Untitled event'}
          </h2>
          <StarButton starred muted onToggle={() => void removeStar(uid)} label={star.title} />
        </div>
        <div className="mt-1 flex shrink-0 items-center gap-2 text-[11.5px] text-ink-faint">
          <span className="font-mono">{formatTime(star.start)}</span>
          <span className="text-ink-fringe">·</span>
          <span className="truncate">{star.room || 'Room TBA'}</span>
        </div>
        <p className="mt-2.5 shrink-0 border-t border-line-soft pt-2.5 text-[11.5px] leading-snug text-cancelled">
          NO LONGER LISTED — Sched has dropped this event. This is what you starred.
        </p>
      </CardShell>
    )
  }

  // One event, so no memo earns its keep here — and computing it after the
  // guard is what keeps the live branch free of non-null assertions.
  const row = buildRow(event, {
    classes: NO_CLASSES,
    changes: dataset?.changes ?? {},
    starredUids,
  })
  const cancelled = row.states.includes('cancelled')
  const description = event.description.trim()

  return (
    <CardShell eyebrow="EVENT" dismissLabel="Close event card" onDismiss={onDismiss}>
      <div className="mt-1.5 flex shrink-0 items-start gap-2">
        <h2
          className={[
            'min-w-0 flex-1 text-[15px] leading-snug',
            cancelled ? 'text-ink-faint line-through decoration-cancelled' : 'text-ink-bright',
          ].join(' ')}
        >
          {event.title}
        </h2>
        <StarButton starred={row.starred} onToggle={() => void toggleStar(event)} label={event.title} />
      </div>

      <div className="mt-1 flex shrink-0 flex-wrap items-center gap-2 text-[11.5px] text-ink-faint">
        <span className={`font-mono ${cancelled ? 'text-cancelled/70' : 'text-ink-dim'}`}>{row.time}</span>
        <span className="text-ink-fringe">·</span>
        <span className="truncate">{event.room || 'Room TBA'}</span>
        {row.states.map((state) => (
          <StateBadge key={state} state={state} />
        ))}
      </div>

      {description ? (
        <div
          data-testid="event-description"
          className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-line-soft pt-2.5"
        >
          <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-ink-dim">{description}</p>
        </div>
      ) : null}
    </CardShell>
  )
}
