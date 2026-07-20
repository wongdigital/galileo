/**
 * The ICS export contract. Shared because both sides need it: the builder
 * produces the result, main forwards it over IPC, and the renderer renders the
 * exclusion notice from the same vocabulary.
 */

/**
 * UID domain. Stable on purpose: it is half of every exported UID, so a re-import
 * updates an existing calendar entry instead of duplicating it. Renaming the app
 * (U10) must not touch this string.
 */
export const ICS_UID_DOMAIN = 'galileo'

export type IcsExclusionReason =
  /** Sched flagged it CANCELLED — a star pointing at a dead session. */
  | 'cancelled'
  /** A starred UID no longer in the dataset: the ghost case. */
  | 'not-found'
  /** No usable start or end. Never guess a time onto someone's calendar. */
  | 'missing-times'
  /** Outside the requested day, for a per-day export. */
  | 'other-day'

export interface IcsExclusion {
  uid: string
  /** Null for the ghost case, where there is no event left to name. */
  title: string | null
  reason: IcsExclusionReason
}

export interface IcsBuildOptions {
  /** Pacific local date, "2026-07-25". Omit for the whole con. */
  day?: string
  /** Minutes before start. Attend-class events only. */
  alarmMinutes?: number
  calendarName?: string
  /** DTSTAMP, injected so the builder stays pure and its output testable. */
  stamp?: Date
}

export interface IcsBuildResult {
  ics: string
  /** VEVENT count. */
  exported: number
  /** What was dropped and why, so the UI can say so instead of silently
   *  exporting five of six starred sessions. */
  excluded: IcsExclusion[]
  /** UIDs whose end U3 clamped. Exported as-is, but worth surfacing: the end
   *  time on the phone is the app's correction, not Sched's data. */
  sanitized: string[]
}
