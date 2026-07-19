/**
 * DTEND sanitization. Sched's end times are the least trustworthy field in the
 * feed: the live corpus carries a games event ending in 2028 and four ending
 * three days after the con closes.
 *
 * The clamp target is deliberately the *same local day*, never con-end+1day.
 * Con-end+1day would turn the 2028 case into a two-day banner spanning the top
 * of the schedule; con-end+1day survives only as the outer validity bound,
 * which the same-day clamp satisfies by construction.
 */

import { PACIFIC, isoFromInstant } from './parse-ics'
import type { ScheduleEvent } from './types'

/** Tracks whose events are drop-in halls, where a 13-hour block is real. */
export const AMBIENT_TRACKS: ReadonlySet<string> = new Set(['6: GAMES'])

const MAX_DURATION_HOURS = 12

export interface SanitizeOptions {
  /** Last local con date, `YYYY-MM-DD`. Null disables clamping entirely. */
  conLastDay: string | null
  ambientTracks?: ReadonlySet<string>
  maxDurationHours?: number
  timeZone?: string
}

/**
 * The last local date the schedule starts events on. DTSTARTs are trustworthy
 * in bulk but not individually, so dates carrying under half a percent of the
 * events are dropped as typos before taking the maximum — otherwise one bad row
 * stretches the window by two years and silently disables every clamp.
 */
export function deriveConLastDay(starts: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const start of starts) {
    if (!start) continue
    const day = start.slice(0, 10)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  const threshold = Math.max(1, total * 0.005)
  const kept = [...counts.entries()].filter(([, n]) => n >= threshold).map(([day]) => day)
  return kept.length === 0 ? null : kept.sort().at(-1)!
}

export function sanitizeEvent(event: ScheduleEvent, options: SanitizeOptions): ScheduleEvent {
  const { conLastDay } = options
  const { start, end } = event
  if (!conLastDay || !start || !end) return event

  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return event

  const ambient = (options.ambientTracks ?? AMBIENT_TRACKS).has(event.track ?? '')
  const capHours = options.maxDurationHours ?? MAX_DURATION_HOURS
  const durationHours = (endMs - startMs) / 3_600_000

  // An end past the last con day is wrong regardless of track. A long duration
  // is only wrong outside the drop-in halls. A negative duration is wrong
  // everywhere, and lands under the duration check rather than inventing a
  // third reason code.
  const reason = end.slice(0, 10) > conLastDay
    ? 'beyond-con-end'
    : !ambient && (durationHours > capHours || durationHours < 0)
      ? 'duration-exceeds-cap'
      : null
  if (!reason) return event

  const timeZone = options.timeZone ?? PACIFIC
  const endOfLocalDay = Date.parse(`${start.slice(0, 10)}T23:59:59${start.slice(19)}`)
  const clamped = Math.min(endOfLocalDay, startMs + capHours * 3_600_000)

  return {
    ...event,
    end: isoFromInstant(new Date(clamped), timeZone),
    sanitized: { field: 'end', reason, original: end },
  }
}

export function sanitizeEvents(
  events: readonly ScheduleEvent[],
  options?: Partial<SanitizeOptions>,
): ScheduleEvent[] {
  const conLastDay = options?.conLastDay ?? deriveConLastDay(events.map((e) => e.start))
  return events.map((e) => sanitizeEvent(e, { ...options, conLastDay }))
}
