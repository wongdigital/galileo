/** Electron stars composition over shared two-generation slot logic. */
import { join } from 'node:path'
import { normalizeStars, type StarRecord } from '../shared/stars'
import type { JsonStore } from '../shared/storage/jsonStore'
import { StarSlots } from '../shared/storage/slots'
import { NodeJsonStore } from './nodeJsonStore'

export class StarStore extends StarSlots {
  constructor(baseDirOrStore: string | JsonStore) {
    super(
      typeof baseDirOrStore === 'string'
        ? new NodeJsonStore(join(baseDirOrStore, 'schedule'))
        : baseDirOrStore,
    )
  }
}

/** Minimal Electron-free IPC surface for unit tests. */
export interface StarIpcMain {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

export function registerStarIpc(ipcMain: StarIpcMain, store: StarStore): void {
  ipcMain.handle('stars:get', () => store.read())
  ipcMain.handle('stars:set', (_event, ...args: unknown[]): Promise<StarRecord[]> =>
    store.write(normalizeStars(args[0])),
  )
}
