import type { IcsExportRequest, IcsExportResult } from '../bridge/types'
import type { ScheduleEvent } from '../schedule'
import { buildIcs } from './builder'
import type { IcsExclusion } from './types'

export interface IcsExportDeps {
  /** Delivers the built calendar through a platform-owned UI. Null is cancel. */
  deliver(defaultName: string, contents: string): Promise<string | null>
}

/** Suggested filename is distinct per day so separate exports do not silently
 * overwrite one another. */
export function defaultFileName(day?: string): string {
  return day ? `comic-con-${day}.ics` : 'comic-con.ics'
}

/** Resolve renderer-supplied UIDs against the host's canonical event array,
 * build the calendar, and delegate only final delivery to the platform. */
export async function exportIcs(
  request: IcsExportRequest,
  getEvents: () => readonly ScheduleEvent[],
  deps: IcsExportDeps,
): Promise<IcsExportResult> {
  const byUid = new Map(getEvents().map((event) => [event.uid, event]))
  const resolved: ScheduleEvent[] = []
  const ghosts: IcsExclusion[] = []

  for (const uid of request.uids) {
    const event = byUid.get(uid)
    if (event) resolved.push(event)
    else ghosts.push({ uid, title: null, reason: 'not-found' })
  }

  const built = buildIcs(resolved, request.options)
  const excluded = [...ghosts, ...built.excluded]
  if (built.exported === 0) return { status: 'empty', path: null, exported: 0, excluded }

  let path: string | null
  try {
    path = await deps.deliver(defaultFileName(request.options?.day), built.ics)
  } catch (error) {
    return {
      status: 'failed',
      path: null,
      exported: 0,
      excluded: [],
      message: error instanceof Error ? error.message : String(error),
    }
  }
  if (!path) return { status: 'cancelled', path: null, exported: 0, excluded: [] }

  return {
    status: 'saved',
    path,
    exported: built.exported,
    excluded,
    sanitized: built.sanitized,
  }
}
