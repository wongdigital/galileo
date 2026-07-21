import { app, shell, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { installAppMenu } from './appMenu'
import { fetchScheduleSources } from './fetchExecutor'
import { SnapshotStore } from './snapshotStore'
import { StarStore, registerStarIpc } from './starStore'
import { registerIcsIpc } from './icsExport'
import { KeyStore, registerLlmIpc } from './llm'
import { CURRENT_SCHEMA_VERSION, acknowledgeChanges, buildDataset, resolveRefresh } from '../shared/schedule'
import type { DatasetProjection, FetchedDataset, ScheduleEvent } from '../shared/schedule'

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
  // http(s) only: the chat renders model-authored markdown whose context
  // includes third-party event prose, so a link here is not fully trusted —
  // openExternal on an arbitrary scheme would hand it to whatever local
  // protocol handler is registered (file:, vnc:, anything).
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url)
      if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(url)
    } catch {
      // Unparseable URL — open nothing.
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const SITE = process.env.SCHED_SITE ?? 'https://comiccon2026.sched.com'

let store: SnapshotStore
let stars: StarStore
let keys: KeyStore

/**
 * The canonical event list, resolved from main's own snapshots.
 *
 * Export reads through this rather than accepting event bodies from the
 * renderer: the renderer sends `{uids, options}` and nothing else, so an
 * exported calendar cannot drift from what the app actually holds. Prefers
 * last-known-good, because that is the data the user has been looking at; falls
 * back to last-fetched only when no baseline has been promoted yet (first run).
 */
function canonicalEvents(): readonly ScheduleEvent[] {
  return (store.readSnapshot('last-known-good') ?? store.readSnapshot('last-fetched'))?.events ?? []
}

/**
 * One refresh: two HTTP requests, parse, sanitize, join, then let the guard
 * decide what the renderer actually sees. Diffing happens here and only here —
 * the renderer receives a DatasetProjection, never a snapshot.
 */
async function refreshSchedule(acceptAnyway: boolean): Promise<DatasetProjection> {
  let fetched: FetchedDataset | null = null
  try {
    const { ics, listHtml } = await fetchScheduleSources(SITE)
    const { events, stats } = buildDataset(ics, listHtml, { site: SITE })
    fetched = { events, stats, site: SITE, fetchedAt: new Date().toISOString() }
    store.writeSnapshot('last-fetched', {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      fetchedAt: fetched.fetchedAt,
      site: SITE,
      events,
      stats,
    })
  } catch (error) {
    // Offline, DNS down, Sched 500 — all the same story to the caller: there is
    // no new data, so fall back and say so rather than blanking the app.
    console.warn('[schedule] refresh failed, falling back to last-known-good:', error)
  }

  const outcome = resolveRefresh({
    fetched,
    lastKnownGood: store.readSnapshot('last-known-good'),
    log: store.readChangeLog(),
    acceptAnyway,
  })
  if (outcome.promote) store.writeSnapshot('last-known-good', outcome.promote)
  store.writeChangeLog(outcome.log)
  return outcome.projection
}

/**
 * IPC surface — one named method per channel (see src/preload/index.ts).
 * Star and export channels register themselves; see starStore and icsExport.
 */
function registerIpc(): void {
  // The About dialog reads the running version from here rather than importing
  // package.json into the renderer bundle.
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('schedule:refresh', async (_e, options?: { acceptAnyway?: boolean }) => {
    return refreshSchedule(options?.acceptAnyway ?? false)
  })

  // Per-UID dismiss of the unseen-change log. Acks live beside the log so a
  // dismissed badge stays dismissed across restarts.
  ipcMain.handle('changes:acknowledge', async (_e, uids: string[]) => {
    const log = acknowledgeChanges(store.readChangeLog(), uids)
    store.writeChangeLog(log)
    return log.entries
  })

  // Stars and export own their own channels; main just supplies the store and
  // the canonical-event resolver so neither has to reach for renderer state.
  registerStarIpc(ipcMain, stars)
  registerIcsIpc(ipcMain, canonicalEvents)

  // The chat concierge: the key store never leaves main, and the tool loop
  // reads the same canonical events the export does.
  registerLlmIpc(ipcMain, { keyStore: keys, getEvents: canonicalEvents })
}

app.whenReady().then(() => {
  // Packaged builds carry the mark in icon.icns via electron-builder; in dev
  // the dock would otherwise show stock Electron, so point it at the same
  // asset. Guarded twice: dock is macOS-only, and the build/ tree only
  // exists in a checkout.
  if (!app.isPackaged && app.dock) {
    try {
      app.dock.setIcon(join(__dirname, '../../build/icon.png'))
    } catch {
      // A missing or unreadable icon must never stop the app from booting.
    }
  }

  store = new SnapshotStore(app.getPath('userData'))
  stars = new StarStore(app.getPath('userData'))
  keys = new KeyStore(app.getPath('userData'), safeStorage)
  registerIpc()
  installAppMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
