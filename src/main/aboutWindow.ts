import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '../shared/app'

/**
 * The standalone About window — a small, fixed, non-resizable window opened from
 * the app menu's "About Galileo". A true second window (the macOS convention),
 * not a modal over the main surface.
 *
 * Singleton: a second invocation focuses the existing window rather than
 * stacking duplicates.
 */
let aboutWindow: BrowserWindow | null = null

export function openAboutWindow(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 400,
    height: 560,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    minimizable: false,
    show: false,
    title: `About ${APP_NAME}`,
    backgroundColor: '#07090e', // Observatory ground — no white flash
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  aboutWindow = window

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    aboutWindow = null
  })

  // A failed load would otherwise strand an invisible singleton: ready-to-show
  // never fires, and every later About click focuses a window nobody can see.
  // Destroying it fires 'closed', which resets the singleton for a clean retry.
  const discard = (): void => {
    if (!window.isDestroyed()) window.destroy()
  }
  window.webContents.on('did-fail-load', discard)

  // External links (the author site, GitHub) open in the browser, never here.
  // http(s) only: openExternal on an arbitrary scheme would hand the URL to
  // whatever local protocol handler is registered for it.
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url)
      if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(url)
    } catch {
      // Unparseable URL — open nothing.
    }
    return { action: 'deny' }
  })

  const load = process.env.ELECTRON_RENDERER_URL
    ? window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/about.html`)
    : window.loadFile(join(__dirname, '../renderer/about.html'))
  load.catch(discard)
}
