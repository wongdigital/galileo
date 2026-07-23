/** Electron stars composition over shared two-generation slot logic. */
import { join } from 'node:path'
import { normalizeStars, type StarRecord } from '../shared/stars'
import { StarSlots } from '../shared/storage/slots'
import { NodeJsonStore } from './nodeJsonStore'

export class StarStore extends StarSlots {
  constructor(baseDir: string) {
    super(new NodeJsonStore(join(baseDir, 'schedule')))
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
