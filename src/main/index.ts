import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'

/**
 * Electron main process. All I/O lives on this side of the bridge — fetch
 * execution, the snapshot store, the star store, dialogs. `src/shared/` stays
 * pure (no I/O, no `node:` imports) so nothing ever pressures us to relax the
 * renderer's sandbox to "just import one helper".
 */

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#07090e', // Observatory ground — avoids a white flash on boot
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Security posture is the electron-vite default, kept deliberately:
      // the renderer gets no Node, no remote module, and its own context.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  window.on('ready-to-show', () => window.show())

  // External links open in the user's browser, never in an app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * IPC surface — one named method per channel (see src/preload/index.ts).
 * These are stubs; U3 wires `schedule:refresh` to the fetch executor and
 * snapshot store, U5 adds the star channels, U7 adds the real ICS export.
 */
function registerIpc(): void {
  ipcMain.handle('schedule:refresh', async () => {
    return { status: 'not-implemented' as const, events: [], changes: [], fetchedAt: null, stale: false }
  })

  ipcMain.handle('export:ics', async (_e, _payload: { uids: string[]; options?: unknown }) => {
    return { status: 'not-implemented' as const, path: null, exported: 0, excluded: [] }
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
