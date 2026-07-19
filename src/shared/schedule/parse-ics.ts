/**
 * RFC 5545 parsing, narrowed to what Sched's `/all.ics` actually emits. Pure:
 * strings in, plain objects out.
 *
 * Ported from scripts/fetch.mjs, whose behavior against the live feed is the
 * reference. The additions here are tolerance, not new semantics — floating and
 * date-only DTSTARTs, literal-backslash unescaping, malformed rows skipped
 * rather than thrown on.
 */

import type { SchedFlag } from './types'

export const PACIFIC = 'America/Los_Angeles'

/** One VEVENT, flattened to property name -> unescaped value. */
export type RawIcsEvent = Record<string, string>

/**
 * Undo RFC 5545 line folding: CRLF followed by a single space or tab is a
 * continuation marker, not content. A second space *is* content, which is how
 * word boundaries survive folding.
 */
export function unfold(ics: string): string {
  return ics.replace(/\r?\n[ \t]/g, '')
}

const ESCAPES: Record<string, string> = { n: '\n', N: '\n' }

function unescapeText(value: string): string {
  return value.replace(/\\([\\nN,;])/g, (_, ch: string) => ESCAPES[ch] ?? ch)
}

export function parseIcs(ics: string): RawIcsEvent[] {
  const events: RawIcsEvent[] = []
  for (const block of unfold(ics).matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)) {
    const fields: RawIcsEvent = {}
    for (const line of (block[1] ?? '').trim().split(/\r?\n/)) {
      const idx = line.indexOf(':')
      if (idx === -1) continue
      // Property parameters (`DTSTART;TZID=...`) are dropped: Sched sends UTC
      // stamps, and the app converts to Pacific itself either way.
      const key = line.slice(0, idx).split(';')[0]
      if (!key) continue
      fields[key] = unescapeText(line.slice(idx + 1)).trim()
    }
    events.push(fields)
  }
  return events
}

// ---------- time ----------

function zoneParts(instant: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'longOffset',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  )
}

function instantToLocalIso(instant: Date, timeZone: string): string {
  const parts = zoneParts(instant, timeZone)
  const offset = (parts.timeZoneName ?? '').replace('GMT', '') || '+00:00'
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const label = (zoneParts(instant, timeZone).timeZoneName ?? '').replace('GMT', '')
  const m = label.match(/^([+-])(\d{2}):(\d{2})$/)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}

/**
 * A wall-clock time in `timeZone` maps to an instant only once the zone's
 * offset at that instant is known, and the offset depends on the instant. Two
 * passes converge everywhere except inside a DST gap, which never contains con
 * programming.
 */
function wallClockToInstant(utcGuess: number, timeZone: string): Date {
  let instant = new Date(utcGuess - offsetMinutes(new Date(utcGuess), timeZone) * 60_000)
  instant = new Date(utcGuess - offsetMinutes(instant, timeZone) * 60_000)
  return instant
}

/**
 * "20260722T223000Z" -> "2026-07-22T15:30:00-07:00". Also accepts a floating
 * stamp (no Z, read as already-local) and a date-only value (local midnight).
 */
export function toLocalIso(value: string | null | undefined, timeZone: string = PACIFIC): string | null {
  const m = value?.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return null
  const utc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  const instant = m[7] === 'Z' ? new Date(utc) : wallClockToInstant(utc, timeZone)
  return instantToLocalIso(instant, timeZone)
}

/** Re-render an absolute instant as a local ISO string. Used by the clamp. */
export function isoFromInstant(instant: Date, timeZone: string = PACIFIC): string {
  return instantToLocalIso(instant, timeZone)
}

// ---------- categories ----------

const FLAG_PREFIX = /^([NUX]): (NEW|UPDATED|CANCELLED)$/

/**
 * CATEGORIES mixes one track with zero or more change flags:
 * "U: UPDATED, 1: PROGRAMS" -> { track: "1: PROGRAMS", flags: ["UPDATED"] }.
 * The flags are Sched's static editorial annotation, not a change feed — see
 * docs/solutions/2026-07-18-uid-is-the-identity-key.md.
 */
export function parseCategories(raw: string | null | undefined): { track: string | null; flags: SchedFlag[] } {
  const flags: SchedFlag[] = []
  let track: string | null = null
  for (const part of (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const flag = part.match(FLAG_PREFIX)
    if (flag) flags.push(flag[2] as SchedFlag)
    else track = part
  }
  return { track, flags }
}
