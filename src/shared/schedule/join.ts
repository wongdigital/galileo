/**
 * The pipeline's single entry point: two raw response bodies in, a joined and
 * sanitized dataset out. Pure — the two fetch executors (src/main for the app,
 * scripts/fetch.mjs for the CLI) both hand their strings to this.
 */

import { parseCategories, parseIcs, toLocalIso } from './parse-ics'
import { parseListDescriptions } from './parse-list'
import { sanitizeEvents } from './sanitize'
import type { SanitizeOptions } from './sanitize'
import type { ScheduleEvent, SnapshotStats } from './types'

export interface BuildOptions {
  /** Sched site root, used to build canonical event URLs. */
  site: string
  sanitize?: Partial<SanitizeOptions>
}

export interface BuiltDataset {
  events: ScheduleEvent[]
  stats: SnapshotStats
}

export function buildDataset(icsText: string, listHtml: string, options: BuildOptions): BuiltDataset {
  const listData = parseListDescriptions(listHtml)
  let joined = 0

  const events: ScheduleEvent[] = []
  for (const raw of parseIcs(icsText)) {
    const uid = raw.UID
    // Identity is UID everywhere — stars, diffs, graph nodes, exported ICS. An
    // event without one cannot be tracked, so it is dropped rather than given a
    // synthetic key that would churn on every fetch.
    if (!uid) continue

    const extra = listData.get(uid)
    if (extra) joined++
    const { track, flags } = parseCategories(raw.CATEGORIES)
    const location = raw.LOCATION ?? ''

    events.push({
      uid,
      shortId: extra?.shortId ?? null,
      title: raw.SUMMARY ?? '',
      start: toLocalIso(raw.DTSTART),
      end: toLocalIso(raw.DTEND),
      track,
      subtypes: extra?.subtypes ?? [],
      flags,
      // "Room 18 (Mezzanine), 111 Harbor Dr, ..." — the room is everything
      // before the venue's street address.
      room: location.split(/, \d+ [A-Z]/)[0] || location,
      location,
      description: raw.DESCRIPTION ?? '',
      url: extra?.shortId ? `${options.site}/event/${extra.shortId}` : (raw.URL ?? null),
    })
  }

  events.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || a.title.localeCompare(b.title))

  return {
    events: sanitizeEvents(events, options.sanitize),
    stats: {
      eventCount: events.length,
      joinedWithListView: joined,
      joinRate: events.length === 0 ? 0 : joined / events.length,
    },
  }
}
