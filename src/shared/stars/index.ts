/**
 * Star records.
 *
 * A star is a UID *plus a snapshot* of what was starred — title, start, room,
 * and when. The snapshot is the whole point: when a UID leaves the feed, the
 * app can still show you a struck-through row saying what you had planned, and
 * the failure mode becomes "Sched pulled this" instead of a row that quietly
 * stops existing. That silent-disappearance class is what this app was built to
 * fix, so the fix cannot depend on the event still being there to describe it.
 *
 * The snapshot is **display-only**. Nothing here is ever merged back into live
 * event data — a stale title from three weeks ago must never win over the feed.
 *
 * Pure module: validation is shared by the main-process store (guarding what it
 * writes to disk) and the renderer (guarding what it adopts back).
 */

import type { ScheduleEvent } from '../schedule/types'

export const STARS_SCHEMA_VERSION = 1

export interface StarRecord {
  uid: string
  /** Snapshot fields — display-only, for the ghost row. */
  title: string
  start: string | null
  room: string
  /** ISO 8601. */
  starredAt: string
}

export interface StarFile {
  schemaVersion: number
  stars: StarRecord[]
}

export function emptyStarFile(): StarFile {
  return { schemaVersion: STARS_SCHEMA_VERSION, stars: [] }
}

export function starFromEvent(event: ScheduleEvent, now: string): StarRecord {
  return {
    uid: event.uid,
    title: event.title,
    start: event.start,
    room: event.room,
    starredAt: now,
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * Coerce anything into a well-formed star list: dropping entries without a UID,
 * de-duplicating by UID (first write wins, so re-starring never resets the
 * original `starredAt`), and filling missing snapshot fields with blanks rather
 * than rejecting the record.
 *
 * A star whose title failed to persist is still a star — losing the row because
 * its label was malformed would be the exact data loss the snapshot exists to
 * prevent. Only a missing UID is fatal, because without it there is nothing to
 * point at.
 */
export function normalizeStars(raw: unknown): StarRecord[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: StarRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const uid = asString(record['uid'])
    if (uid.length === 0 || seen.has(uid)) continue
    seen.add(uid)
    out.push({
      uid,
      title: asString(record['title']),
      start: typeof record['start'] === 'string' ? record['start'] : null,
      room: asString(record['room']),
      starredAt: asString(record['starredAt']),
    })
  }
  return out
}

export function isStarred(stars: readonly StarRecord[], uid: string): boolean {
  return stars.some((s) => s.uid === uid)
}

export function toggleStar(
  stars: readonly StarRecord[],
  event: ScheduleEvent,
  now: string
): StarRecord[] {
  if (isStarred(stars, event.uid)) return stars.filter((s) => s.uid !== event.uid)
  return [...stars, starFromEvent(event, now)]
}

export function unstar(stars: readonly StarRecord[], uid: string): StarRecord[] {
  return stars.filter((s) => s.uid !== uid)
}

/**
 * Stars whose UID is no longer in the feed. Derived on every read rather than
 * flagged on the record: a ghost is a fact about the current dataset, and an
 * event that comes back after a Sched correction has to stop being a ghost
 * without anyone having to remember to clear a flag.
 */
export function ghostStars(
  stars: readonly StarRecord[],
  liveUids: ReadonlySet<string>
): StarRecord[] {
  return stars.filter((s) => !liveUids.has(s.uid))
}
