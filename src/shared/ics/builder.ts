/**
 * Starred events → an .ics string. Pure: no I/O, no `node:` imports. The save
 * dialog and the write live in src/main/icsExport.ts.
 *
 * Two rules carry most of the value. Alarms follow the event class, not the
 * user's stars — a 15-minute warning for a games room that has been open since
 * 10am is noise, so ambient-class events export without a VALARM (see
 * enrichment/classes.ts). And UIDs are `<sched-uid>@galileo`, derived and
 * never generated, so re-exporting after the schedule shifts updates the
 * existing calendar entries instead of doubling them.
 */

import ical, { ICalAlarmType, ICalCalendarMethod } from 'ical-generator'
import { classifyEvent } from '../enrichment/classes'
import type { ScheduleEvent } from '../schedule/types'
import { PACIFIC_TZID, wallClock } from './pacific'
import { ICS_UID_DOMAIN } from './types'
import type { IcsBuildOptions, IcsBuildResult, IcsExclusion } from './types'

export const DEFAULT_ALARM_MINUTES = 15

/** Pacific-local calendar date. The offset is baked into the string, so the
 *  leading date is already the local day — no conversion, no midnight drift. */
export function localDay(iso: string): string {
  return iso.slice(0, 10)
}

export function icsUid(schedUid: string): string {
  return `${schedUid}@${ICS_UID_DOMAIN}`
}

export function buildIcs(
  events: readonly ScheduleEvent[],
  options: IcsBuildOptions = {}
): IcsBuildResult {
  const alarmMinutes = options.alarmMinutes ?? DEFAULT_ALARM_MINUTES
  const excluded: IcsExclusion[] = []
  const sanitized: string[] = []

  const calendar = ical({
    name: options.calendarName ?? 'Comic-Con Schedule',
    prodId: { company: ICS_UID_DOMAIN, product: 'schedule-export', language: 'EN' },
    // PUBLISH, not REQUEST: this is a subscription-shaped file, not an invite.
    // Apple Calendar prompts to RSVP on REQUEST, which nobody wants here.
    method: ICalCalendarMethod.PUBLISH
    // Deliberately no calendar-level `timezone`. Setting it makes ical-generator
    // write DTSTAMP as a floating local time with no `Z`, which RFC 5545 does
    // not allow — DTSTAMP is UTC by definition. The TZID that matters rides on
    // each DTSTART/DTEND instead.
  })

  let exported = 0

  for (const event of events) {
    if (event.flags.includes('CANCELLED')) {
      excluded.push({ uid: event.uid, title: event.title, reason: 'cancelled' })
      continue
    }

    const start = event.start ? wallClock(event.start) : null
    const end = event.end ? wallClock(event.end) : null
    if (!start || !end) {
      // A calendar entry with a made-up time is worse than a missing one.
      excluded.push({ uid: event.uid, title: event.title, reason: 'missing-times' })
      continue
    }

    if (options.day && localDay(event.start as string) !== options.day) {
      excluded.push({ uid: event.uid, title: event.title, reason: 'other-day' })
      continue
    }

    const entry = calendar.createEvent({
      id: icsUid(event.uid),
      start,
      end,
      timezone: PACIFIC_TZID,
      stamp: options.stamp,
      summary: event.title,
      location: event.location || event.room,
      description: event.description,
      url: event.url ?? undefined
    })

    if (classifyEvent(event).eventClass === 'attend') {
      entry.createAlarm({ type: ICalAlarmType.display, trigger: alarmMinutes * 60 })
    }

    if (event.sanitized) sanitized.push(event.uid)
    exported += 1
  }

  return { ics: calendar.toString(), exported, excluded, sanitized }
}
