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
 * - **"Also runs" is where the offering lens went.** The map once had a lens
 *   whose hubs meant "this event, again" — real structure (2,268 events sit in
 *   a repeat cluster), wrong surface: it deduped copies where every other lens
 *   relates different events. The question the cluster answers ("I can't make
 *   this sitting, is there another?") is asked while looking at one event, so
 *   it is answered here, on the event.
 * - **The metadata is the raw feed's, on purpose.** Subtypes and track come
 *   straight from Sched; people and franchises from the compiled extraction,
 *   trusted entries only. On the map this is what makes an isolated dot
 *   explicable: an event whose seven panelists each appear nowhere else *is*
 *   unconnected under People, and the card is where that stops looking like a
 *   bug and starts being information.
 */

import { useEffect, useMemo, type ReactNode } from 'react'
import { buildRow, dayLabel, formatTime, localParts, type RowState } from '@renderer/state/derive'
import { useEnrichmentSource } from '@renderer/state/enrichmentIndex'
import { useSpine } from '@renderer/state/spine'
import { StarButton } from '@renderer/views/schedule/StarButton'
import { buildOfferings, type EventClassification, type OfferingIndex } from '@shared/enrichment'
import { humanizeId } from '@shared/graph'
import type { ScheduleEvent } from '@shared/schedule'

/** `buildRow` reads classifications only for the duration label, which the card
 *  does not show — the row gutter already carries it in the list. */
const NO_CLASSES: ReadonlyMap<string, EventClassification> = new Map()

/** Chips shown before the rest collapse into "+N". Six covers 3,266 of the
 *  corpus's 3,474 events without truncation. */
const SUBTYPE_CHIP_LIMIT = 6

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

/** Module-level, not per-instance: every open card mounts this hook, and the
 *  cluster pass normalizes every title in the corpus. Same WeakMap-on-the-
 *  events-array pattern as `useSchedule`'s Layer 1. */
const offeringCache = new WeakMap<readonly ScheduleEvent[], OfferingIndex>()
const NO_EVENTS: readonly ScheduleEvent[] = []

function useOfferingIndex(): OfferingIndex {
  const { dataset } = useSpine()
  const events = dataset?.events ?? NO_EVENTS
  return useMemo(() => {
    const cached = offeringCache.get(events)
    if (cached) return cached
    const built = buildOfferings(events)
    offeringCache.set(events, built)
    return built
  }, [events])
}

/** "Thu 10:00a" — a sitting has to name its day, since repeats usually land on
 *  different ones. */
function whenLabel(iso: string | null): string {
  const parts = localParts(iso)
  const time = formatTime(iso)
  return parts ? `${dayLabel(parts.date).weekday} ${time}` : time
}

/** The feed's track strings carry a sort prefix ("1: PROGRAMS") that means
 *  nothing to a reader. */
function trackLabel(track: string | null): string | null {
  const label = (track ?? '').replace(/^\d+:\s*/, '').trim()
  return label || null
}

/** Seeded franchises get the curated name; unseeded ones are shown as
 *  extracted, deduped on the shown label. */
function franchiseLabels(
  franchises: readonly { surface_text: string; canonical: string }[],
): string[] {
  const out: string[] = []
  for (const franchise of franchises) {
    const canonical = franchise.canonical.trim()
    const label =
      canonical && canonical !== 'other' ? humanizeId(canonical) : franchise.surface_text.trim()
    if (label && !out.includes(label)) out.push(label)
  }
  return out
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10px] tracking-[0.12em] text-ink-faint">{children}</span>
  )
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
  const { dataset, status, stars, toggleStar, removeStar, setSelectedUid } = useSpine()
  const byUid = useEventLookup()
  const offerings = useOfferingIndex()
  const enrichment = useEnrichmentSource(dataset?.events)

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

  // The other sittings of this same program, in schedule order. Clicking one
  // re-selects it through the spine; the host swaps the card, and on the map
  // the pin moves with it. A sitting the host's scope cannot draw closes the
  // card instead (the map's no-card-without-a-dot rule) — accepted, since the
  // common case is browsing an unfiltered or interest-filtered corpus where
  // every sitting is in scope.
  const offeringKey = offerings.keyByUid.get(uid)
  const offering = offeringKey ? offerings.byKey.get(offeringKey) : undefined
  const siblings = (offering?.uids ?? [])
    .filter((other) => other !== uid)
    .map((other) => byUid.get(other))
    .filter((sibling): sibling is ScheduleEvent => sibling !== undefined)

  const entry = enrichment.entryFor(uid)
  const people = entry?.people ?? []
  const franchises = franchiseLabels(entry?.franchises ?? [])
  const track = trackLabel(event.track)

  // Deduped here as well as at the parser: a cached snapshot fetched before
  // the parser learned Sched doubles some tag lists still carries the doubles.
  // Capped because a 15-tag event is real ("No Capes Required" carries the
  // whole taxonomy) and a full wall of chips buries the prose — the rest ride
  // in the +N chip's tooltip.
  const subtypes = [...new Set(event.subtypes.map((s) => s.trim()).filter(Boolean))]
  const shownSubtypes = subtypes.slice(0, SUBTYPE_CHIP_LIMIT)
  const hiddenSubtypes = subtypes.slice(SUBTYPE_CHIP_LIMIT)

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

      {/* One scroll region for everything below the vitals. When the sections
          were separate shrink-0 blocks and only the description flexed, a
          15-tag event squeezed the prose to zero height — "no description" as
          a layout casualty. Now a tall card scrolls as a whole and the prose
          is merely below the fold, never gone. */}
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
        {siblings.length > 0 ? (
          <div className="mt-1.5 border-t border-line-soft pt-2" data-testid="also-runs">
            <SectionLabel>ALSO RUNS</SectionLabel>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {siblings.map((sibling) => (
                <button
                  key={sibling.uid}
                  type="button"
                  onClick={() => setSelectedUid(sibling.uid)}
                  title={`${sibling.title} — ${sibling.room || 'Room TBA'}`}
                  className="rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
                >
                  {whenLabel(sibling.start)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {track || shownSubtypes.length > 0 ? (
          <div
            className="mt-2.5 flex flex-wrap items-center gap-1.5"
            data-testid="event-source-tags"
          >
            {track ? (
              <span className="rounded border border-line px-1.5 py-px font-mono text-[9.5px] tracking-[0.08em] text-ink-dim">
                {track}
              </span>
            ) : null}
            {shownSubtypes.map((subtype) => (
              <span
                key={subtype}
                className="rounded border border-line-soft px-1.5 py-px font-mono text-[9.5px] text-ink-faint"
              >
                {subtype}
              </span>
            ))}
            {hiddenSubtypes.length > 0 ? (
              <span
                title={hiddenSubtypes.join(', ')}
                className="rounded border border-line-soft px-1.5 py-px font-mono text-[9.5px] text-ink-fringe"
              >
                +{hiddenSubtypes.length}
              </span>
            ) : null}
          </div>
        ) : null}

        {people.length > 0 ? (
          <div className="mt-2.5 border-t border-line-soft pt-2" data-testid="event-people">
            <SectionLabel>PEOPLE</SectionLabel>
            <ul className="mt-1 space-y-0.5">
              {people.map((person) => (
                <li
                  key={person.name}
                  className="flex items-baseline justify-between gap-2 text-[11.5px] leading-snug"
                >
                  <span className="min-w-0 truncate text-ink">{person.name}</span>
                  {person.role ? (
                    <span className="shrink-0 text-[10px] text-ink-faint">{person.role}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {franchises.length > 0 ? (
          <div className="mt-2.5 border-t border-line-soft pt-2" data-testid="event-franchises">
            <SectionLabel>IP</SectionLabel>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {franchises.map((label) => (
                <span
                  key={label}
                  className="rounded border border-line-soft px-1.5 py-px text-[10.5px] text-ink-dim"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {description ? (
          <div
            data-testid="event-description"
            className="mt-2.5 border-t border-line-soft pt-2.5"
          >
            <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-ink-dim">{description}</p>
          </div>
        ) : null}
      </div>
    </CardShell>
  )
}
