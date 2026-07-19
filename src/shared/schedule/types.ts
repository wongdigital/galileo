/**
 * Core schedule types. Shared by the parse/join pipeline (U3), the enrichment
 * join (U4), the ICS builder (U7), and the renderer's read-only projection.
 *
 * Everything in src/shared/ is pure — no I/O, no `node:` imports. All I/O lives
 * in src/main/. This is what keeps the renderer's sandbox from ever needing to
 * be relaxed so that "just one helper" can be imported.
 *
 * Identity is `uid` everywhere. Verified stable across Sched edits on
 * 2026-07-18 — see docs/solutions/2026-07-18-uid-is-the-identity-key.md.
 */

/** Sched's own editorial annotation. NOT a change feed — the flags sit static
 *  while descriptions change underneath them, which is why the app diffs
 *  snapshots instead of trusting these. */
export type SchedFlag = 'NEW' | 'UPDATED' | 'CANCELLED'

/** An event as it comes out of the fetch → parse → sanitize → join pipeline. */
export interface ScheduleEvent {
  /** 32-hex Sched UID. The identity key for stars, diffs, graph nodes, ICS. */
  uid: string
  /** Short public id; builds the canonical URL. Backup identity key. */
  shortId: string | null
  title: string
  /** ISO 8601 with Pacific offset, e.g. "2026-07-23T10:00:00-07:00". */
  start: string | null
  end: string | null
  track: string | null
  /** Sched sub-category tags — the raw 181-tag vocabulary, pre-facet-mapping. */
  subtypes: string[]
  flags: SchedFlag[]
  room: string
  location: string
  description: string
  url: string | null
  /** Set when sanitize clamped an implausible DTEND (see sanitize.ts). */
  sanitized?: SanitizeNote
}

export interface SanitizeNote {
  field: 'end'
  reason: 'beyond-con-end' | 'duration-exceeds-cap'
  /** The original value, preserved so the UI can explain the correction. */
  original: string
}

// ---------- diff ----------

export type ChangeKind = 'added' | 'removed' | 'moved-start' | 'moved-room' | 'flag-changed'

export interface Change {
  uid: string
  kind: ChangeKind
  /** Populated for the `moved-*` and `flag-changed` kinds. */
  from?: string
  to?: string
  /** When the diff that produced this change ran (ISO 8601). */
  detectedAt: string
}

/**
 * Change flags persist via an unseen log rather than latest-two-fetch diffs:
 * results accumulate per UID and clear only on acknowledgment, so a moved or
 * cancelled flag survives a second refresh instead of evaporating before the
 * user ever sees it (AE4).
 */
export interface UnseenChangeLog {
  schemaVersion: number
  /** UID -> the changes seen for it that haven't been acknowledged yet. */
  entries: Record<string, Change[]>
}

// ---------- snapshots ----------

export interface Snapshot {
  schemaVersion: number
  fetchedAt: string
  site: string
  events: ScheduleEvent[]
  /** Join rate and counts, for the drift guard's comparison baseline. */
  stats: SnapshotStats
}

export interface SnapshotStats {
  eventCount: number
  joinedWithListView: number
  /** joinedWithListView / eventCount, 0..1 */
  joinRate: number
}

// ---------- guards ----------

export type DriftVerdict =
  | { ok: true }
  | { ok: false; reason: 'low-join-rate' | 'event-count-drop'; detail: string; stats: SnapshotStats }

// ---------- the renderer's projection ----------

/**
 * What crosses IPC. Main owns the canonical enriched dataset; the renderer gets
 * this read-only projection plus per-UID change annotations. Snapshots never
 * cross — the renderer has no snapshot concept.
 */
export interface DatasetProjection {
  events: ScheduleEvent[]
  /** UID -> unacknowledged changes. Derived in main from the unseen log. */
  changes: Record<string, Change[]>
  fetchedAt: string | null
  /** True when we're serving last-known-good because the live fetch failed or
   *  tripped the drift guard. The UI surfaces this rather than a blank app. */
  stale: boolean
  /** Set when the drift guard held data back; carries the override affordance. */
  warning?: DriftVerdict & { ok: false }
}
