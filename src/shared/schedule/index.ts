/**
 * The schedule data layer. Everything here is pure: no I/O, no `node:` imports,
 * no fetch. Callers hand in response bodies and persisted JSON; they get back
 * plain objects.
 */

export * from './types'
export { PACIFIC, isoFromInstant, parseCategories, parseIcs, toLocalIso, unfold } from './parse-ics'
export type { RawIcsEvent } from './parse-ics'
export { decodeEntities, parseListDescriptions } from './parse-list'
export type { ListEntry } from './parse-list'
export { AMBIENT_TRACKS, deriveConLastDay, sanitizeEvent, sanitizeEvents } from './sanitize'
export type { SanitizeOptions } from './sanitize'
export { buildDataset } from './join'
export type { BuildOptions, BuiltDataset } from './join'
export { CHANGE_LOG_SCHEMA_VERSION, accumulateChanges, acknowledgeChanges, diffEvents, emptyChangeLog } from './diff'
export { CURRENT_SCHEMA_VERSION, checkDrift, migrateSnapshot, resolveRefresh } from './guard'
export type { FetchedDataset, RefreshInputs, RefreshOutcome } from './guard'
