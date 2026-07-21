/**
 * View-model derivation for the 5-day view.
 *
 * Every function here is pure and takes the spine's inputs as arguments. That
 * is not stylistic: the derived-state rule says ghosts, flags, and filtered sets
 * are selectors over the spine and never stored copies, and the cheapest way to
 * keep that true is to make the derivation impossible to hold onto — no state,
 * no memo cache, no class instance. It also means the interesting logic runs in
 * the node test suite without a DOM.
 */

import type { Change, ScheduleEvent } from '@shared/schedule'
import type { EventClassification } from '@shared/enrichment'
import type { StarRecord } from '@shared/stars'

// ---------- local wall-clock formatting ----------

/**
 * Read the wall clock straight off the string, exactly as
 * `enrichment/facets.ts` does. Every feed timestamp carries an explicit Pacific
 * offset and the whole con is in one zone; going through `Date` would
 * reinterpret them in the host's zone and shift a late-night panel onto the
 * wrong day for anyone east of PT.
 */
export function localParts(iso: string | null): { date: string; hour: number; minute: number } | null {
  if (!iso) return null
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return null
  return { date: m[1]!, hour: Number(m[2]), minute: Number(m[3]) }
}

/** "10:00a", "3:30p". Compact enough to sit in a fixed gutter at every row. */
export function formatTime(iso: string | null): string {
  const parts = localParts(iso)
  if (!parts) return '—'
  const meridiem = parts.hour < 12 ? 'a' : 'p'
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12
  return `${hour12}:${String(parts.minute).padStart(2, '0')}${meridiem}`
}

// The day formatter lives in the shared labels module now — main's chat tools
// label day values too — and is re-exported here so view code keeps one import
// site for schedule formatting.
import { dayLabel } from '@shared/filter'
export { dayLabel }

export function durationLabel(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return ''
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

// ---------- row states ----------

/**
 * `moved` has no counterpart in Sched's own flags — it exists only because the
 * app diffs its own snapshots. That is the point of the unseen-change log: Sched
 * will happily leave an event flagged UPDATED for three weeks while quietly
 * moving it to a different room, and only the diff catches the room.
 */
export type RowState = 'new' | 'updated' | 'moved' | 'cancelled'

export function rowStates(event: ScheduleEvent, changes: readonly Change[] = []): RowState[] {
  const states = new Set<RowState>()

  for (const flag of event.flags ?? []) {
    if (flag === 'NEW') states.add('new')
    if (flag === 'UPDATED') states.add('updated')
    if (flag === 'CANCELLED') states.add('cancelled')
  }

  for (const change of changes) {
    if (change.kind === 'added') states.add('new')
    if (change.kind === 'moved-start' || change.kind === 'moved-room') states.add('moved')
    if (change.kind === 'flag-changed') {
      states.add(change.to === 'CANCELLED' ? 'cancelled' : 'updated')
    }
  }

  // Cancelled subsumes the rest — a moved event that then got cancelled is
  // simply cancelled, and showing both reads as "it moved, so go there".
  if (states.has('cancelled')) return ['cancelled']
  return (['new', 'moved', 'updated'] as const).filter((s) => states.has(s))
}

/** Starred + cancelled is the one combination that has to be impossible to
 *  miss: it is a plan that silently stopped being a plan (AE4). */
export function isLoud(states: readonly RowState[], starred: boolean): boolean {
  return starred && states.includes('cancelled')
}

// ---------- rows ----------

export interface RowModel {
  uid: string
  event: ScheduleEvent
  time: string
  duration: string
  states: RowState[]
  starred: boolean
  loud: boolean
  changes: Change[]
}

export interface BuildRowsInput {
  events: readonly ScheduleEvent[]
  classes: ReadonlyMap<string, EventClassification>
  changes: Readonly<Record<string, Change[]>>
  starredUids: ReadonlySet<string>
}

const startMs = (event: ScheduleEvent): number => {
  if (!event.start) return Number.POSITIVE_INFINITY
  const t = Date.parse(event.start)
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

export function buildRow(
  event: ScheduleEvent,
  input: Pick<BuildRowsInput, 'classes' | 'changes' | 'starredUids'>
): RowModel {
  const changes = input.changes[event.uid] ?? []
  const states = rowStates(event, changes)
  const starred = input.starredUids.has(event.uid)
  return {
    uid: event.uid,
    event,
    time: formatTime(event.start),
    duration: durationLabel(input.classes.get(event.uid)?.durationMinutes ?? null),
    states,
    starred,
    loud: isLoud(states, starred),
    changes,
  }
}

export interface DayRows {
  /** Attend-class rows, in schedule order. These are what gets virtualized. */
  rows: RowModel[]
  /** Ambient-class rows — the collapsed "open now / all day" shelf. A six-hour
   *  games table is not a thing you arrive on time for, so it is not a row. */
  ambient: RowModel[]
}

/**
 * Split one day's already-filtered events into list rows and shelf entries.
 * Sorted by start, then room, so two events at 10:00 do not swap places between
 * renders — a list that reshuffles under a refresh is a list you cannot use to
 * find the row you were looking at.
 */
export function buildDayRows(input: BuildRowsInput): DayRows {
  const rows: RowModel[] = []
  const ambient: RowModel[] = []

  for (const event of input.events) {
    const row = buildRow(event, input)
    if (input.classes.get(event.uid)?.eventClass === 'ambient') ambient.push(row)
    else rows.push(row)
  }

  const order = (a: RowModel, b: RowModel): number =>
    startMs(a.event) - startMs(b.event) || a.event.room.localeCompare(b.event.room)

  return { rows: rows.sort(order), ambient: ambient.sort(order) }
}

/**
 * One entry in the All view's virtual list: an event row, or a day divider that
 * precedes each day's first row (the sticky section headers, iOS-Contacts
 * style). A `null` day is the divider for dateless rows — rendered as
 * "Unscheduled". A single-day list needs none — the day rail already names the
 * day.
 */
export type ScheduleListItem =
  | { kind: 'header'; day: string | null }
  | { kind: 'row'; row: RowModel }

/**
 * Insert a day header before each day's first row. Rows must already be in
 * schedule order (buildDayRows sorts by start), so consecutive rows of the same
 * computed day group cleanly and each day appears exactly once. Rows with an
 * unknown day sort to the end (startMs treats a missing start as Infinity) and
 * get an "Unscheduled" divider — without one they would sit under the final
 * day's sticky header, reading as that day's events.
 */
export function withDayHeaders(
  rows: readonly RowModel[],
  dayByUid: ReadonlyMap<string, string | null>
): ScheduleListItem[] {
  const out: ScheduleListItem[] = []
  let lastDay: string | null | undefined = undefined
  for (const row of rows) {
    const day = dayByUid.get(row.uid) ?? null
    if (day !== lastDay) {
      out.push({ kind: 'header', day })
      lastDay = day
    }
    out.push({ kind: 'row', row })
  }
  return out
}

// ---------- days ----------

export interface DayBucket {
  day: string
  weekday: string
  date: string
  /** Events matching the active filter on this day. Drives the rail's counts,
   *  so a day that the filter emptied says 0 rather than disappearing. */
  count: number
}

/**
 * Days come from the *unfiltered* corpus and the counts from the filtered one.
 * Deriving the rail from filtered events would make days vanish as you filter,
 * and a day switcher whose buttons move is a day switcher you misclick.
 */
export function buildDayBuckets(
  allDays: readonly (string | null)[],
  filteredDays: readonly (string | null)[]
): DayBucket[] {
  const counts = new Map<string, number>()
  for (const day of filteredDays) {
    if (day) counts.set(day, (counts.get(day) ?? 0) + 1)
  }

  const days = [...new Set(allDays.filter((d): d is string => !!d))].sort()
  return days.map((day) => ({ day, ...dayLabel(day), count: counts.get(day) ?? 0 }))
}

/**
 * The "All" pseudo-day: every filtered event across the con, in one
 * chronological list. It is how starred-across-days is reachable (All + the
 * Starred toggle) without the day rail lying about which day you are on.
 */
export const ALL_DAYS = 'all'

/**
 * Which day to show. "All" is sticky once chosen. Otherwise keeps the current
 * day whenever it still exists — a refresh must not bounce the user back to
 * Wednesday — and falls back to the first day with results under the filter.
 */
export function resolveActiveDay(buckets: readonly DayBucket[], current: string | null): string | null {
  if (current === ALL_DAYS) return ALL_DAYS
  if (current && buckets.some((b) => b.day === current)) return current
  return buckets.find((b) => b.count > 0)?.day ?? buckets[0]?.day ?? null
}

// ---------- ghosts ----------

export interface GhostRow {
  star: StarRecord
  time: string
  day: string | null
}

/**
 * A starred UID the feed no longer carries. Rendered struck-through and still
 * visible, from the star's own snapshot fields — which are display-only and are
 * never merged back into live event data.
 *
 * The snapshot is the only record that the plan ever existed. Dropping the row
 * because the event is gone is precisely the Sched behaviour this app exists to
 * replace.
 */
export function buildGhostRows(
  stars: readonly StarRecord[],
  liveUids: ReadonlySet<string>
): GhostRow[] {
  return stars
    .filter((star) => !liveUids.has(star.uid))
    .map((star) => ({ star, time: formatTime(star.start), day: localParts(star.start)?.date ?? null }))
    .sort((a, b) => (a.star.start ?? '').localeCompare(b.star.start ?? ''))
}

export function ghostsForDay(ghosts: readonly GhostRow[], day: string | null): GhostRow[] {
  // Ghosts whose snapshot never captured a start have no day to belong to, so
  // they surface on every day rather than nowhere.
  return ghosts.filter((g) => g.day === null || g.day === day)
}
