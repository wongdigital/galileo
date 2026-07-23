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
import {
  applyThemeAttribute,
  loadThemePreference,
  saveThemePreference,
  type ThemeId,
} from './themePreference'

export type { ThemeId } from './themePreference'

let current: ThemeId = 'dark'
const listeners = new Set<() => void>()

function apply(theme: ThemeId): void {
  current = theme
  applyThemeAttribute(theme)
  // The graph painter caches resolved token values; the next frame re-reads.
  resetPalette()
  for (const listener of listeners) listener()
}

/** Called once from main.tsx and awaited before React mounts. The static boot
 * background remains dark (see EXCEPTIONS.md), but no application content
 * paints in the wrong theme while the durable adapter resolves. */
export async function initTheme(): Promise<void> {
  apply('dark')
  apply(await loadThemePreference())
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
    void saveThemePreference(next).catch(() => {
      // Persistence is best-effort; the in-session switch still applies.
    })
  }, [])
  return { theme, setTheme }
}
