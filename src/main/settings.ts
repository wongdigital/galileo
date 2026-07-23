import { SettingsSlots } from '../shared/storage/slots'

/** Minimal Electron-free IPC host shape so channel wiring stays unit-testable. */
export interface SettingsIpcHost {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

export function registerSettingsIpc(ipcMain: SettingsIpcHost, settings: SettingsSlots): void {
  ipcMain.handle('settings:get', async (_event, name: unknown) => settings.get(asName(name)))
  ipcMain.handle('settings:set', async (_event, payload: unknown) => {
    const { name, value } = (payload ?? {}) as { name?: unknown; value?: unknown }
    return settings.set(asName(name), value)
  })
}

function asName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid settings name')
  return value
}
