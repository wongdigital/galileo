/**
 * Electron's thin ICS adapter: the shared core resolves UIDs and builds the
 * calendar; this module owns only the save dialog, filesystem write, and IPC.
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
import { defaultFileName, exportIcs as exportPortableIcs } from '../shared/ics'
import type { IcsExportDeps } from '../shared/ics'
import type { IcsExportRequest, IcsExportResult } from '../shared/bridge/types'
import type { ScheduleEvent } from '../shared/schedule'

export { defaultFileName }
export type { IcsExportDeps, IcsExportRequest, IcsExportResult }

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
  return exportPortableIcs(request, getEvents, deps)
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
