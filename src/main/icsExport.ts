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
import type { IcsBuildOptions, IcsExclusion } from '../shared/ics'
import type { ScheduleEvent } from '../shared/schedule'

/** What the renderer sends. `options` is the builder's, minus the injected stamp. */
export interface IcsExportRequest {
  uids: string[]
  options?: Omit<IcsBuildOptions, 'stamp'>
}

export type IcsExportResult =
  | { status: 'saved'; path: string; exported: number; excluded: IcsExclusion[]; sanitized: string[] }
  /** The user closed the dialog. Not an error — the UI shows nothing. */
  | { status: 'cancelled'; path: null; exported: 0; excluded: [] }
  /** Every starred UID was cancelled, a ghost, or on another day. */
  | { status: 'empty'; path: null; exported: 0; excluded: IcsExclusion[] }
  | { status: 'failed'; path: null; exported: 0; excluded: []; message: string }

export interface IcsExportDeps {
  /** Resolves to null when the user cancels. */
  showSaveDialog(defaultName: string): Promise<string | null>
  write(path: string, contents: string): Promise<void>
}

/** Suggested filename: `comic-con-2026-07-25.ics`, or `comic-con.ics` for the
 *  whole con. Distinct per day so a day export never silently overwrites the
 *  previous one in the Downloads folder. */
export function defaultFileName(day?: string): string {
  return day ? `comic-con-${day}.ics` : 'comic-con.ics'
}

const electronDeps: IcsExportDeps = {
  showSaveDialog: async (defaultName) => {
    // Imported lazily: a top-level `electron` import would make this module
    // unloadable under vitest, where there is no Electron runtime.
    const { dialog } = await import('electron')
    const result = await dialog.showSaveDialog({
      title: 'Export starred sessions',
      defaultPath: defaultName,
      filters: [{ name: 'Calendar', extensions: ['ics'] }]
    })
    return result.canceled || !result.filePath ? null : result.filePath
  },
  write: (path, contents) => writeFile(path, contents, 'utf8')
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

  const path = await deps.showSaveDialog(defaultFileName(request.options?.day))
  if (!path) return { status: 'cancelled', path: null, exported: 0, excluded: [] }

  try {
    await deps.write(path, built.ics)
  } catch (error) {
    return {
      status: 'failed',
      path: null,
      exported: 0,
      excluded: [],
      message: error instanceof Error ? error.message : String(error)
    }
  }

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
