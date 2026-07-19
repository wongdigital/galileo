/**
 * Synthetic fixtures. Titles, rooms, and descriptions are invented — the live
 * corpus carries Sched-authored prose and stays out of git (see U1). The shapes
 * are faithful: Saturday's 10am–6pm ballroom rhythm, the "N: TRACK" prefix, and
 * the 50-minute panel that is the attend class's canonical case.
 */

import type { ScheduleEvent } from '../../schedule/types'

export function event(uid: string, partial: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    uid,
    shortId: null,
    title: 'Untitled',
    start: '2026-07-25T10:00:00-07:00',
    end: '2026-07-25T10:50:00-07:00',
    track: '1: PROGRAMS',
    subtypes: [],
    flags: [],
    room: 'Room 5AB',
    location: 'Room 5AB, 111 Harbor Dr, San Diego, CA 92101, USA',
    description: 'A description.',
    url: null,
    ...partial
  }
}

/** Six attend-class Saturday sessions — the plan's happy-path export. */
export function saturdaySessions(): ScheduleEvent[] {
  const slots: Array<[string, string, string]> = [
    ['Drawing Monsters for a Living', '10:00:00', '10:50:00'],
    ['Independent Publishing in 2026', '11:15:00', '12:05:00'],
    ['Writing the Second Book', '12:30:00', '13:20:00'],
    ['Practical Effects Never Died', '14:00:00', '14:50:00'],
    ['Costume Construction Clinic', '15:15:00', '16:05:00'],
    ['Late Night Horror Shorts', '17:00:00', '17:50:00']
  ]

  return slots.map(([title, start, end], index) =>
    event(String(index).repeat(32).slice(0, 32), {
      title,
      start: `2026-07-25T${start}-07:00`,
      end: `2026-07-25T${end}-07:00`
    })
  )
}
