/**
 * The I/O half of ICS export: resolve UIDs, pick a path, write the file.
 *
 * The renderer sends `{uids, options}` and nothing else. Main resolves those
 * UIDs against its own canonical dataset, which is the whole point — an export
 * built from renderer-supplied event bodies could drift from the app's data
 * after a refresh, and the file would be wrong in exactly the way nobody checks.
 *
 * `getEvents` is injected rather than imported so this module never reaches into
 * main/index.ts's state, and `deps` is injected so the save-and-write path is
 * testable without booting Electron.
 */

import { writeFile } from 'node:fs/promises'
import { buildIcs } from '../shared/ics'
import type { IcsExclusion } from '../shared/ics'
import type { IcsExportRequest, IcsExportResult } from '../shared/bridge/types'
import type { ScheduleEvent } from '../shared/schedule'

export type { IcsExportRequest, IcsExportResult } from '../shared/bridge/types'

export interface IcsExportDeps {
  /** Delivers the file through the platform UI. Resolves to null on cancel. */
  deliver(defaultName: string, contents: string): Promise<string | null>
}

/** Suggested filename: `comic-con-2026-07-25.ics`, or `comic-con.ics` for the
 *  whole con. Distinct per day so a day export never silently overwrites the
 *  previous one in the Downloads folder. */
export function defaultFileName(day?: string): string {
  return day ? `comic-con-${day}.ics` : 'comic-con.ics'
}

const electronDeps: IcsExportDeps = {
  deliver: async (defaultName, contents) => {
    // Imported lazily: a top-level `electron` import would make this module
    // unloadable under vitest, where there is no Electron runtime.
    const { dialog } = await import('electron')
    const result = await dialog.showSaveDialog({
      title: 'Export starred sessions',
      defaultPath: defaultName,
      filters: [{ name: 'Calendar', extensions: ['ics'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, contents, 'utf8')
    return result.filePath
  },
}

export async function exportIcs(
  request: IcsExportRequest,
  getEvents: () => readonly ScheduleEvent[],
  deps: IcsExportDeps = electronDeps
): Promise<IcsExportResult> {
  const byUid = new Map(getEvents().map((event) => [event.uid, event]))

  const resolved: ScheduleEvent[] = []
  const ghosts: IcsExclusion[] = []
  for (const uid of request.uids) {
    const event = byUid.get(uid)
    if (event) resolved.push(event)
    // A star whose event has left the dataset entirely. Reported like any other
    // exclusion so a shrinking export is always explained.
    else ghosts.push({ uid, title: null, reason: 'not-found' })
  }

  const built = buildIcs(resolved, request.options)
  const excluded = [...ghosts, ...built.excluded]

  // Nothing to write beats an empty calendar file the user has to delete.
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
      message: error instanceof Error ? error.message : String(error)
    }
  }
  if (!path) return { status: 'cancelled', path: null, exported: 0, excluded: [] }

  return {
    status: 'saved',
    path,
    exported: built.exported,
    excluded,
    sanitized: built.sanitized
  }
}

/** Minimal shape of the `ipcMain` this needs, so wiring it up in tests does not
 *  require an Electron object. */
export interface IcsIpcHost {
  handle(channel: string, listener: (event: unknown, payload: IcsExportRequest) => unknown): void
}

export function registerIcsIpc(
  ipcMain: IcsIpcHost,
  getEvents: () => readonly ScheduleEvent[],
  deps?: IcsExportDeps
): void {
  ipcMain.handle('export:ics', (_event, payload) => exportIcs(payload, getEvents, deps))
}
