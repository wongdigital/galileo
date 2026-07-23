/**
 * U7 — the ICS builder. Pure, like everything else in src/shared/: it takes
 * events and returns a string. The save dialog and the write are main's job.
 */

export { DEFAULT_ALARM_MINUTES, buildIcs, icsUid, localDay } from './builder'
export { defaultFileName, exportIcs } from './export'
export type { IcsExportDeps } from './export'
export { PACIFIC_TZID, wallClock } from './pacific'
export type { WallClockValue } from './pacific'
export { ICS_UID_DOMAIN } from './types'
export type {
  IcsBuildOptions,
  IcsBuildResult,
  IcsExclusion,
  IcsExclusionReason
} from './types'
