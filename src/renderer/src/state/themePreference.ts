import { bridge } from '../bridge'

export type ThemeId = 'dark' | 'light'

const SETTING_NAME = 'theme'
const READ_TIMEOUT_MS = 400

/** Read the durable preference without letting a stalled native adapter hold
 * either renderer entry point on its boot screen indefinitely. */
export async function loadThemePreference(): Promise<ThemeId> {
  const api = bridge()
  if (!api) return 'dark'

  let timeout: number | undefined
  try {
    const stored = await Promise.race([
      api.settings.get(SETTING_NAME),
      new Promise<undefined>((resolve) => {
        timeout = window.setTimeout(resolve, READ_TIMEOUT_MS)
      }),
    ])
    return stored === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
}

export function applyThemeAttribute(theme: ThemeId): void {
  if (theme === 'light') {
    document.documentElement.dataset.theme = 'light'
  } else {
    delete document.documentElement.dataset.theme
  }
}

export async function saveThemePreference(theme: ThemeId): Promise<void> {
  const api = bridge()
  if (!api) return
  await api.settings.set(SETTING_NAME, theme)
}
