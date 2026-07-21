import { Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { openAboutWindow } from './aboutWindow'
import { APP_NAME, GITHUB_URL } from '../shared/app'

/**
 * The application menu. Its one non-default job is the About item: rather than
 * Electron's stock native about panel, it opens our own Observatory-styled
 * About window (src/main/aboutWindow.ts). Everything else is the standard macOS
 * menu, assembled from roles.
 *
 * macOS-only by construction — the app ships an arm64 mac build; on other
 * platforms Electron's default menu stays in place. Labels use APP_NAME, not
 * app.name, because app.name is the package name "galileo" and renaming it
 * would move userData (see src/shared/app.ts).
 */
export function installAppMenu(): void {
  if (process.platform !== 'darwin') return

  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        {
          label: `About ${APP_NAME}`,
          click: () => openAboutWindow(),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: `${APP_NAME} on GitHub`, click: () => void shell.openExternal(GITHUB_URL) },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
