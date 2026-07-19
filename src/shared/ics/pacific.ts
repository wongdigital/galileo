/**
 * The wall-clock date value handed to ical-generator.
 *
 * ical-generator does not convert between timezones. Given a string or a Date
 * plus `timezone: 'America/Los_Angeles'`, it emits the *system-local* wall clock
 * under that TZID — on a machine set to New York, a 10am panel exports as
 * `DTSTART;TZID=America/Los_Angeles:20260723T130000`, three hours wrong, with no
 * error anywhere. Its documented escape hatch is to pass a date-library object
 * (luxon, moment-timezone) that it asks to do the conversion itself.
 *
 * No conversion is actually needed here: `ScheduleEvent.start` and `.end` are
 * already Pacific-local ISO strings, so the wall clock is sitting in the text.
 * This adapter implements the small luxon-shaped surface ical-generator's date
 * path uses and hands back exactly those digits, which is why the export is
 * identical on Roger's laptop, on CI in UTC, and on a machine in Berlin.
 */

import type { ICalLuxonDateTimeStub } from 'ical-generator'

/** The one timezone this app deals in. San Diego, every year. */
export const PACIFIC_TZID = 'America/Los_Angeles'

const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/

/**
 * `ICalLuxonDateTimeStub` is ical-generator's own published interface for this
 * seam — the library documents a date object it will call, so this adapter is a
 * supported extension point rather than a hook into internals.
 */
export type WallClockValue = ICalLuxonDateTimeStub

/**
 * Null when the string is not a parseable Pacific-local ISO timestamp, which is
 * the caller's signal to exclude the event rather than export a wrong time.
 */
export function wallClock(iso: string): WallClockValue | null {
  const parts = ISO_LOCAL.exec(iso)
  if (!parts) return null

  const [, year, month, day, hour, minute, second] = parts as unknown as string[]
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return null

  const value: WallClockValue = {
    isValid: true,
    // Used only for ical-generator's start-before-end comparison, so it wants
    // the true instant, offset and all — not the wall clock.
    toJSDate: () => instant,
    toJSON: () => iso,
    // Anything but 'system': the value is pinned to Pacific, which is what stops
    // ical-generator from falling back to a UTC conversion.
    zone: { type: 'fixed' },
    // Already Pacific; there is nothing to shift.
    setZone: () => value,
    toFormat: (format: string) => {
      // The two luxon tokens ical-generator's timezone branch asks for. Anything
      // else means the library changed its date path underneath us, and failing
      // loudly beats emitting a plausible-looking wrong timestamp.
      if (format === 'yyyyLLdd') return `${year}${month}${day}`
      if (format === 'HHmmss') return `${hour}${minute}${second}`
      throw new Error(`Unexpected date format requested by ical-generator: ${format}`)
    }
  }
  return value
}
