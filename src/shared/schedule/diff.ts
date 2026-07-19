/**
 * Snapshot diffing and the unseen-change log.
 *
 * Diffing snapshots is the change engine, not Sched's NEW/UPDATED/CANCELLED
 * flags: those sat byte-identical across two fetches while nine events changed
 * content underneath them. The log exists because a latest-two-fetch diff is
 * ephemeral — a move detected on Monday's refresh would vanish on Tuesday's,
 * before anyone saw it. Entries accumulate per UID and clear only on
 * acknowledgment.
 */

import type { Change, ChangeKind, ScheduleEvent, UnseenChangeLog } from './types'

export const CHANGE_LOG_SCHEMA_VERSION = 1

export function emptyChangeLog(): UnseenChangeLog {
  return { schemaVersion: CHANGE_LOG_SCHEMA_VERSION, entries: {} }
}

/** Flag order is Sched's business, not a change. */
function flagKey(event: ScheduleEvent): string {
  return [...event.flags].sort().join(',')
}

/**
 * Per-UID diff. Title and description edits are deliberately not changes: they
 * churn constantly and would bury the moves and cancellations that actually
 * change where someone has to be.
 */
export function diffEvents(
  previous: readonly ScheduleEvent[],
  next: readonly ScheduleEvent[],
  detectedAt: string,
): Change[] {
  // Nothing to compare against on a first run; flagging the whole feed as new
  // would make day one's change log worthless.
  if (previous.length === 0) return []

  const before = new Map(previous.map((e) => [e.uid, e]))
  const changes: Change[] = []

  for (const event of next) {
    const prior = before.get(event.uid)
    if (!prior) {
      changes.push({ uid: event.uid, kind: 'added', detectedAt })
      continue
    }
    before.delete(event.uid)
    if (prior.start !== event.start) {
      changes.push({ uid: event.uid, kind: 'moved-start', from: prior.start ?? '', to: event.start ?? '', detectedAt })
    }
    if (prior.room !== event.room) {
      changes.push({ uid: event.uid, kind: 'moved-room', from: prior.room, to: event.room, detectedAt })
    }
    const [wasFlags, nowFlags] = [flagKey(prior), flagKey(event)]
    if (wasFlags !== nowFlags) {
      changes.push({ uid: event.uid, kind: 'flag-changed', from: wasFlags, to: nowFlags, detectedAt })
    }
  }

  for (const uid of before.keys()) changes.push({ uid, kind: 'removed', detectedAt })
  return changes
}

/** `added` and `removed` describe the same fact from opposite ends. */
const OPPOSITE: Partial<Record<ChangeKind, ChangeKind>> = { added: 'removed', removed: 'added' }

/**
 * Fold a fresh diff into the log. Repeat changes of one kind collapse into a
 * single entry that keeps the *original* from-value, so a panel that hops
 * across three rooms still reads "moved from Room 5" — and if it hops back to
 * where it started, the entry disappears instead of claiming a change that no
 * longer exists.
 */
export function accumulateChanges(log: UnseenChangeLog, changes: readonly Change[]): UnseenChangeLog {
  if (changes.length === 0) return log
  const entries: Record<string, Change[]> = {}
  for (const [uid, list] of Object.entries(log.entries)) entries[uid] = [...list]

  for (const change of changes) {
    const existing = entries[change.uid] ?? []
    const opposite = OPPOSITE[change.kind]
    const withoutOpposite = opposite ? existing.filter((c) => c.kind !== opposite) : existing
    if (opposite && withoutOpposite.length !== existing.length) {
      // The event left and came back; neither fact is worth showing.
      if (withoutOpposite.length === 0) delete entries[change.uid]
      else entries[change.uid] = withoutOpposite
      continue
    }

    const priorOfKind = withoutOpposite.find((c) => c.kind === change.kind)
    const merged: Change = priorOfKind ? { ...change, from: priorOfKind.from } : change
    const rest = withoutOpposite.filter((c) => c.kind !== change.kind)
    // A value that returned to its starting point is not a pending change.
    const reverted = merged.from !== undefined && merged.from === merged.to
    const updated = reverted ? rest : [...rest, merged]
    if (updated.length === 0) delete entries[change.uid]
    else entries[change.uid] = updated
  }

  return { schemaVersion: log.schemaVersion, entries }
}

/** Per-UID dismiss, driven by the `changes:acknowledge` IPC channel. */
export function acknowledgeChanges(log: UnseenChangeLog, uids: readonly string[]): UnseenChangeLog {
  const drop = new Set(uids)
  const entries: Record<string, Change[]> = {}
  for (const [uid, list] of Object.entries(log.entries)) {
    if (!drop.has(uid)) entries[uid] = list
  }
  return { schemaVersion: log.schemaVersion, entries }
}
