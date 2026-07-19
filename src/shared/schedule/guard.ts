/**
 * The drift guard and the refresh resolution it governs.
 *
 * Sched can serve a page shape we do not recognize, or a partial feed, and both
 * look like a successful HTTP 200. The guard is what stops a bad fetch from
 * replacing a good schedule the morning of the con — and, just as importantly,
 * from becoming the baseline every later comparison is made against.
 *
 * Pure. The snapshot store calls this; the store's I/O stays in src/main/.
 */

import { accumulateChanges, diffEvents } from './diff'
import type {
  Change,
  DatasetProjection,
  DriftVerdict,
  ScheduleEvent,
  Snapshot,
  SnapshotStats,
  UnseenChangeLog,
} from './types'

export const CURRENT_SCHEMA_VERSION = 1

const MIN_JOIN_RATE = 0.9
const MAX_COUNT_DROP = 0.2

export function checkDrift(candidate: SnapshotStats, baseline: SnapshotStats | null): DriftVerdict {
  if (candidate.joinRate < MIN_JOIN_RATE) {
    return {
      ok: false,
      reason: 'low-join-rate',
      detail: `Only ${candidate.joinedWithListView} of ${candidate.eventCount} events matched the list view (${Math.round(candidate.joinRate * 100)}%).`,
      stats: candidate,
    }
  }
  if (baseline && candidate.eventCount < baseline.eventCount * (1 - MAX_COUNT_DROP)) {
    return {
      ok: false,
      reason: 'event-count-drop',
      detail: `Event count fell from ${baseline.eventCount} to ${candidate.eventCount}.`,
      stats: candidate,
    }
  }
  return { ok: true }
}

/**
 * Read a persisted snapshot back. An envelope from another schema version is
 * discarded here, out loud, rather than being handed to code that assumes
 * today's shape — the fallback path is exactly where a mystery crash would be
 * least recoverable. There is nothing to migrate yet; when there is, the
 * version branch goes here.
 */
export function migrateSnapshot(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const snapshot = raw as Partial<Snapshot>
  if (snapshot.schemaVersion !== CURRENT_SCHEMA_VERSION) return null
  if (!Array.isArray(snapshot.events) || !snapshot.stats || typeof snapshot.fetchedAt !== 'string') return null
  return snapshot as Snapshot
}

/** A fetch that parsed. Null upstream means the fetch itself failed. */
export interface FetchedDataset {
  events: ScheduleEvent[]
  stats: SnapshotStats
  site: string
  fetchedAt: string
}

export interface RefreshInputs {
  fetched: FetchedDataset | null
  lastKnownGood: Snapshot | null
  log: UnseenChangeLog
  /** The "accept new data anyway" override on the drift warning. */
  acceptAnyway?: boolean
}

export interface RefreshOutcome {
  projection: DatasetProjection
  /** New last-known-good, or null to leave the existing baseline alone. */
  promote: Snapshot | null
  log: UnseenChangeLog
}

function project(
  events: ScheduleEvent[],
  changes: Record<string, Change[]>,
  fetchedAt: string | null,
  stale: boolean,
  warning?: DriftVerdict & { ok: false },
): DatasetProjection {
  return warning ? { events, changes, fetchedAt, stale, warning } : { events, changes, fetchedAt, stale }
}

export function resolveRefresh(inputs: RefreshInputs): RefreshOutcome {
  const { fetched, lastKnownGood, log, acceptAnyway = false } = inputs

  if (!fetched) {
    // No prior data and no live data: an explicit empty state, which the
    // renderer reads as `fetchedAt === null` with no events. Not "stale" —
    // there is no older data being served in place of fresh data.
    if (!lastKnownGood) return { projection: project([], {}, null, false), promote: null, log }
    return {
      projection: project(lastKnownGood.events, log.entries, lastKnownGood.fetchedAt, true),
      promote: null,
      log,
    }
  }

  const verdict = checkDrift(fetched.stats, lastKnownGood?.stats ?? null)
  if (!verdict.ok && !acceptAnyway) {
    // Hold the line: serve what we know is good and let the user decide. With
    // no prior snapshot there is nothing to hold, so the suspect data goes out
    // carrying its warning — but it never becomes the baseline.
    if (lastKnownGood) {
      return {
        projection: project(lastKnownGood.events, log.entries, lastKnownGood.fetchedAt, true, verdict),
        promote: null,
        log,
      }
    }
    return {
      projection: project(fetched.events, log.entries, fetched.fetchedAt, false, verdict),
      promote: null,
      log,
    }
  }

  const nextLog = accumulateChanges(
    log,
    diffEvents(lastKnownGood?.events ?? [], fetched.events, fetched.fetchedAt),
  )
  const snapshot: Snapshot = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    fetchedAt: fetched.fetchedAt,
    site: fetched.site,
    events: fetched.events,
    stats: fetched.stats,
  }
  return {
    projection: project(fetched.events, nextLog.entries, fetched.fetchedAt, false),
    promote: snapshot,
    log: nextLog,
  }
}
