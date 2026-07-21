import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

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
    title: 'About Galileo',
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

  // External links (the author site, GitHub) open in the browser, never here.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/about.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/about.html'))
  }
}
