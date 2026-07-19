/**
 * The entity card — what a hub actually contains (R8). Graph-only: entities are
 * not spine UIDs, so nothing in the list has one to show.
 *
 * Props are deliberately primitive — a label and a list of UIDs — rather than
 * the map's node type. The card is downstream of whatever built the hub, and
 * keeping it that way means the entity map's view model can change shape
 * without touching this file.
 *
 * The row list is height-bounded and scrolls internally. That is not a hedge:
 * at whole-corpus scope the largest IP hubs carry dozens of member events, well
 * past what fits, and an unbounded list would push the docked panel off the
 * bottom of the view hosting it.
 *
 * Clicking a row hands the UID back to the host, which per the pin-precedence
 * rule swaps the dock to that event's card — one card at a time, always.
 */

import { useMemo } from 'react'
import { formatTime } from '@renderer/state/derive'
import { useSpine } from '@renderer/state/spine'
import { StarButton } from '@renderer/views/schedule/StarButton'
import { CardShell, useEventLookup } from './EventCard'

interface EntityCardProps {
  /** The hub's display name, already resolved by the host — genre ids become
   *  prose upstream, so nothing here needs the sidebar's label table. */
  label: string
  /** In-scope member UIDs. The host owns scope; the card just counts and lists
   *  what it was handed. */
  memberUids: readonly string[]
  /** Re-pin: the host swaps the dock to this event's card. */
  onSelectEvent: (uid: string) => void
  onDismiss: () => void
}

export function EntityCard({ label, memberUids, onSelectEvent, onDismiss }: EntityCardProps) {
  const { stars, toggleStar } = useSpine()
  const byUid = useEventLookup()

  const starredUids = useMemo(() => new Set(stars.map((s) => s.uid)), [stars])

  // A member UID that no longer resolves is dropped rather than rendered as an
  // empty row: unlike the event card, there is no snapshot to fall back to and
  // no single subject the card is *about*.
  const members = useMemo(() => {
    const resolved = memberUids.flatMap((uid) => {
      const event = byUid.get(uid)
      return event ? [event] : []
    })
    return resolved.sort(
      (a, b) => (a.start ?? '').localeCompare(b.start ?? '') || a.room.localeCompare(b.room),
    )
  }, [memberUids, byUid])

  return (
    <CardShell eyebrow="ENTITY" dismissLabel="Close entity card" onDismiss={onDismiss}>
      <div className="mt-1.5 flex shrink-0 items-baseline justify-between gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[15px] leading-snug text-ink-bright" title={label}>
          {label}
        </h2>
        <span className="shrink-0 font-mono text-[11px] text-ink-faint">
          {members.length} {members.length === 1 ? 'event' : 'events'}
        </span>
      </div>

      <ul className="mt-2.5 max-h-56 min-h-0 flex-1 overflow-y-auto border-t border-line-soft pt-1.5">
        {members.length === 0 ? (
          // Every member vanished from the feed between the map being built and
          // this render. Rare, but a silently empty panel reads as a bug.
          <li className="px-1 py-1 text-[11.5px] text-ink-faint">No events left in scope.</li>
        ) : null}
        {members.map((event) => (
          <li key={event.uid}>
            <div
              role="button"
              tabIndex={0}
              aria-label={event.title}
              onClick={() => onSelectEvent(event.uid)}
              onKeyDown={(e) => {
                // Only keys aimed at the row itself. The star button inside is
                // a real <button> whose Enter/Space arrive here by bubbling —
                // `preventDefault()` on those would cancel its native
                // activation and re-pin instead of starring, making the star
                // unreachable by keyboard. (The mouse path has the same shape
                // and is guarded by the star's own `stopPropagation`.)
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectEvent(event.uid)
                }
              }}
              className="group flex cursor-default items-center gap-2 rounded px-1 py-1 transition-colors hover:bg-ground-800"
            >
              <span className="w-12 shrink-0 text-right font-mono text-[11px] text-ink-dim">
                {formatTime(event.start)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] leading-snug text-ink">
                {event.title}
              </span>
              <StarButton
                starred={starredUids.has(event.uid)}
                onToggle={() => void toggleStar(event)}
                label={event.title}
              />
            </div>
          </li>
        ))}
      </ul>
    </CardShell>
  )
}
