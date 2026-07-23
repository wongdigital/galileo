/**
 * Theme state — dark Observatory (default) or the daylight variant.
 *
 * The theme is one attribute on <html>: `data-theme="light"` flips every
 * token in observatory.css, and the utilities, scrollbars, selection color,
 * and canvas painter all read tokens, so nothing else needs to know. The
 * choice persists through the platform settings artifact and is applied
 * before React mounts by main.tsx awaiting initTheme().
 */

import { useCallback, useSyncExternalStore } from 'react'
import { resetPalette } from '@renderer/views/graph/paint'
import { bridge } from '../bridge'

export type ThemeId = 'dark' | 'light'

const SETTING_NAME = 'theme'
const SETTINGS_READ_TIMEOUT_MS = 400

let current: ThemeId = 'dark'
const listeners = new Set<() => void>()

function apply(theme: ThemeId): void {
  current = theme
  if (theme === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
  // The graph painter caches resolved token values; the next frame re-reads.
  resetPalette()
  for (const listener of listeners) listener()
}

/** Called once from main.tsx and awaited before React mounts. The static boot
 * background remains dark (see EXCEPTIONS.md), but no application content
 * paints in the wrong theme while the durable adapter resolves. */
export async function initTheme(): Promise<void> {
  apply('dark')
  const api = bridge()
  if (!api) return
  let timeout: number | undefined
  try {
    const stored = await Promise.race([
      api.settings.get(SETTING_NAME),
      new Promise<undefined>((resolve) => {
        timeout = window.setTimeout(resolve, SETTINGS_READ_TIMEOUT_MS)
      }),
    ])
    apply(stored === 'light' ? 'light' : 'dark')
  } catch {
    // A temporarily unavailable settings store must not block app startup.
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
}

export function useTheme(): { theme: ThemeId; setTheme: (theme: ThemeId) => void } {
  const theme = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => current,
  )
  const setTheme = useCallback((next: ThemeId) => {
    apply(next)
    const api = bridge()
    if (api) {
      void api.settings.set(SETTING_NAME, next).catch(() => {
        // Persistence is best-effort; the in-session switch still applies.
      })
    }
  }, [])
  return { theme, setTheme }
}
