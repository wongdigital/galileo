import { Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { openAboutWindow } from './aboutWindow'
import { APP_NAME, GITHUB_URL } from '../shared/app'

/**
 * The application menu, installed on every platform. Its one non-default job is
 * the About item: rather than Electron's stock native about panel, it opens our
 * own Observatory-styled About window (src/main/aboutWindow.ts).
 *
 * On macOS the About item lives in the app menu per platform convention; on
 * Windows and Linux — where Electron would otherwise ship its stock menu,
 * complete with a Help item linking to electronjs.org — it lives under Help,
 * and the standard Edit roles stay so copy/paste works in text fields.
 *
 * Labels use APP_NAME, not app.name, because app.name is the package name
 * "galileo" and renaming it would move userData (see src/shared/app.ts).
 */
export function installAppMenu(): void {
  const mac = process.platform === 'darwin'

  const macAppMenu: MenuItemConstructorOptions = {
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
  }

  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [macAppMenu] : [{ role: 'fileMenu' } as MenuItemConstructorOptions]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        ...(mac
          ? []
          : [
              { label: `About ${APP_NAME}`, click: () => openAboutWindow() },
              { type: 'separator' } as MenuItemConstructorOptions,
            ]),
        { label: `${APP_NAME} on GitHub`, click: () => void shell.openExternal(GITHUB_URL) },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
