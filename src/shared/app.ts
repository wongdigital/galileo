/**
 * App identity constants, shared by main (the menu's About + Help→GitHub items)
 * and the renderer (the About dialog). Living in the pure shared layer keeps the
 * two processes from drifting on the display name or the repo URL.
 *
 * Note: APP_NAME is the DISPLAY name only. The Electron app name stays "galileo"
 * (package.json) — app.setName() would repoint userData and orphan the star
 * store and encrypted key file (CLAUDE.md gotcha), so the menu labels use this
 * constant rather than app.name.
 */
export const APP_NAME = 'Galileo'
export const APP_TAGLINE = 'Chart your course through Comic-Con.'
export const APP_AUTHOR = 'Roger Wong'
export const APP_AUTHOR_URL = 'https://rogerwong.me'
export const GITHUB_URL = 'https://github.com/wongdigital/galileo'
