/**
 * Offering clusters: "this same thing runs N times, pick a sitting."
 *
 * The question a cluster has to answer is a scheduling one — if I can't make the
 * Saturday sitting, is there another? That makes a false merge worse than a
 * missed one. Telling someone their conflict is resolvable when the other
 * "session" is actually a different film sends them to the wrong room.
 *
 * ## The similarity threshold (deferred to this unit by the plan)
 *
 * **Exact equality on the normalized title, scoped to track.** Similarity 1.0,
 * no fuzzy matching. Tuned against the live corpus, and the corpus is emphatic:
 *
 * - Exact normalized equality already yields 461 clusters covering 2,268 events
 *   — the repeated-title signal the plan predicted, captured in full.
 * - Loosening to token-set Jaccard >=0.7 adds 34 candidate pairs, of which
 *   roughly three are genuine ("Urusei Yatsura (2022)" / "Urusei Yatsura";
 *   "Frank Miller book signing" / "Frank Miller signing").
 * - The other ~31 are sequences, not repeats: "Freelancer: Skies Over Tolindia
 *   Act 1/2/3" is a campaign you play in order, "Children's Film Festival
 *   Program 1-6" are six different film programs, and Thursday/Friday/Saturday
 *   "Panel Playback" screen different panels. Merging any of those would tell a
 *   user that missing Act 1 is fine because Act 2 is "the same offering".
 *
 * Three true positives are not worth thirty-one lies to the conflict logic, so
 * the threshold is exact. Track scoping costs nothing and buys real protection:
 * only two titles in the corpus span more than one track ("Lanterns" and "Quick
 * Draw" each exist as both a board game and a Programs panel), and those two are
 * precisely the pairs that must not merge.
 */

import type { ScheduleEvent } from '../schedule/types'
import { trackKey } from './classes'

export interface Offering {
  /** Stable cluster key: `<track>||<normalized title>`. */
  key: string
  /** Display title, taken from the first session in schedule order. */
  title: string
  track: string | null
  /** Session UIDs, sorted by start time so "the next sitting" is a lookup. */
  uids: string[]
  sessionCount: number
}

export interface OfferingIndex {
  byKey: Map<string, Offering>
  /** UID -> cluster key, including singletons. */
  keyByUid: Map<string, string>
}

/**
 * Fold away everything that varies between listings of the same thing without
 * changing what it is: case, smart quotes, accents, and punctuation including
 * the stray trailing asterisks the anime track uses as footnote markers.
 *
 * Deliberately conservative. Anything stripped here is a merge that can no
 * longer be undone downstream.
 */
export function normalizeOfferingTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function offeringKey(event: ScheduleEvent): string {
  return `${trackKey(event.track)}||${normalizeOfferingTitle(event.title)}`
}

const startMs = (e: ScheduleEvent): number => {
  if (!e.start) return Number.POSITIVE_INFINITY
  const t = Date.parse(e.start)
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

/**
 * Every event lands in a cluster, including the 1,206 that are one-of-a-kind.
 * A singleton cluster is the honest answer to "how many sittings?" — one — and
 * saves callers from branching on presence.
 */
export function buildOfferings(events: readonly ScheduleEvent[]): OfferingIndex {
  const grouped = new Map<string, ScheduleEvent[]>()
  for (const event of events) {
    const key = offeringKey(event)
    const bucket = grouped.get(key)
    if (bucket) bucket.push(event)
    else grouped.set(key, [event])
  }

  const byKey = new Map<string, Offering>()
  const keyByUid = new Map<string, string>()

  for (const [key, bucket] of grouped) {
    const sorted = [...bucket].sort((a, b) => startMs(a) - startMs(b))
    const first = sorted[0]!
    byKey.set(key, {
      key,
      title: first.title,
      track: first.track,
      uids: sorted.map((e) => e.uid),
      sessionCount: sorted.length
    })
    for (const e of sorted) keyByUid.set(e.uid, key)
  }

  return { byKey, keyByUid }
}

export function offeringForUid(index: OfferingIndex, uid: string): Offering | null {
  const key = index.keyByUid.get(uid)
  return key ? (index.byKey.get(key) ?? null) : null
}

/** How many sittings this event's offering has. 1 for a one-off. */
export function sessionCountForUid(index: OfferingIndex, uid: string): number {
  return offeringForUid(index, uid)?.sessionCount ?? 0
}

/** The other sittings of the same offering — the conflict-resolution input. */
export function alternativeSessions(index: OfferingIndex, uid: string): string[] {
  const offering = offeringForUid(index, uid)
  if (!offering) return []
  return offering.uids.filter((u) => u !== uid)
}

/** Clusters with more than one sitting, largest first. */
export function repeatedOfferings(index: OfferingIndex): Offering[] {
  return [...index.byKey.values()]
    .filter((o) => o.sessionCount > 1)
    .sort((a, b) => b.sessionCount - a.sessionCount || a.title.localeCompare(b.title))
}
