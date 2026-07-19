/**
 * Event class: is this something you *attend* at a start time, or something
 * that is simply *open* for a stretch and you wander into?
 *
 * The distinction earns its keep twice. Ambient events render as one collapsed
 * "open all day" shelf per day instead of flooding the list with rows (U5), and
 * they export without alarms (U7) — a 15-minute warning for a room that has been
 * open since 10am is noise.
 *
 * Derived from duration + track, no LLM. Tuned against the live corpus: of 3,474
 * events, 940 run >=4h and 899 of those are the Games track, where a single
 * calendar entry is a demo table staffed for five hours rather than one sitting.
 * The tags agree in the most useful way possible — by contradicting themselves:
 * a 300-minute "Boss Battle" block carries the tag "45 Minutes", because the tag
 * describes the *game*, not the block. That mismatch is the ambient signal.
 */

import type { ScheduleEvent } from '../schedule/types'

export type EventClass = 'attend' | 'ambient'

export type ClassReason =
  | 'long-drop-in-track'
  | 'all-day-block'
  | 'scheduled'
  | 'unknown-duration'

export interface EventClassification {
  uid: string
  eventClass: EventClass
  /** Null when start or end is missing — the event still classifies, as attend. */
  durationMinutes: number | null
  reason: ClassReason
}

export interface ClassifyOptions {
  /** Minutes at or above which a drop-in track becomes ambient. */
  dropInThresholdMinutes?: number
  /** Minutes at or above which *any* track becomes ambient, drop-in or not. */
  allDayThresholdMinutes?: number
  /** Track keys (normalized, see `trackKey`) that run as open floors. */
  dropInTracks?: readonly string[]
}

/**
 * Tracks where a long block means "come by whenever". Games tables, autograph
 * lines, and portfolio review queues are all served first-come across the whole
 * window. Programs and Films are not: a 4-hour film block still starts at a time
 * you need to be in the room for.
 */
export const DROP_IN_TRACKS = ['GAMES', 'AUTOGRAPHS', 'PORTFOLIO REVIEW'] as const

/** 4h is the plan's threshold and the corpus agrees: the Games track's own
 *  scheduled sittings top out at 3h, so 4h is where blocks begin. */
export const DEFAULT_DROP_IN_THRESHOLD_MINUTES = 240

/**
 * 8h catches the handful of all-day blocks on non-drop-in tracks (a 595-minute
 * anime room, for instance) without touching legitimately long screenings.
 * Nobody arrives on time for a ten-hour event.
 */
export const DEFAULT_ALL_DAY_THRESHOLD_MINUTES = 480

/** Sched prefixes tracks with a sort key: "6: GAMES", "P: PROGRAMS". */
export function trackKey(track: string | null): string {
  if (!track) return ''
  return track.replace(/^[A-Za-z0-9]+:\s*/, '').trim().toUpperCase()
}

export function durationMinutes(event: ScheduleEvent): number | null {
  if (!event.start || !event.end) return null
  const start = Date.parse(event.start)
  const end = Date.parse(event.end)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return (end - start) / 60_000
}

export function classifyEvent(
  event: ScheduleEvent,
  options: ClassifyOptions = {}
): EventClassification {
  const dropInThreshold = options.dropInThresholdMinutes ?? DEFAULT_DROP_IN_THRESHOLD_MINUTES
  const allDayThreshold = options.allDayThresholdMinutes ?? DEFAULT_ALL_DAY_THRESHOLD_MINUTES
  const dropInTracks = options.dropInTracks ?? DROP_IN_TRACKS

  const mins = durationMinutes(event)

  // No usable duration defaults to attend. The failure modes are asymmetric:
  // a wrongly-ambient event loses its alarm silently, a wrongly-attend event
  // just gets an alarm it did not need.
  if (mins === null) {
    return { uid: event.uid, eventClass: 'attend', durationMinutes: null, reason: 'unknown-duration' }
  }

  if (mins >= allDayThreshold) {
    return { uid: event.uid, eventClass: 'ambient', durationMinutes: mins, reason: 'all-day-block' }
  }

  if (mins >= dropInThreshold && dropInTracks.includes(trackKey(event.track))) {
    return {
      uid: event.uid,
      eventClass: 'ambient',
      durationMinutes: mins,
      reason: 'long-drop-in-track'
    }
  }

  return { uid: event.uid, eventClass: 'attend', durationMinutes: mins, reason: 'scheduled' }
}

export function classifyAll(
  events: readonly ScheduleEvent[],
  options: ClassifyOptions = {}
): Map<string, EventClassification> {
  return new Map(events.map((e) => [e.uid, classifyEvent(e, options)]))
}
