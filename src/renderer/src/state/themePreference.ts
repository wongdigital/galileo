import { bridge } from '../bridge'

export type ThemeId = 'dark' | 'light'

const SETTING_NAME = 'theme'
const LEGACY_STORAGE_KEY = 'galileo.theme'
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
    if (stored === 'light' || stored === 'dark') return stored
    if (stored !== null) return 'dark'

    const legacy = readLegacyTheme()
    if (!legacy) return 'dark'
    try {
      await api.settings.set(SETTING_NAME, legacy)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // Keep the legacy value so a later launch can retry the migration.
    }
    return legacy
  } catch {
    return 'dark'
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
}

function readLegacyTheme(): ThemeId | null {
  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
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
