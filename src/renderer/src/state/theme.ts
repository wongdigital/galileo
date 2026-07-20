/**
 * Theme state — dark Observatory (default) or the daylight variant.
 *
 * The theme is one attribute on <html>: `data-theme="light"` flips every
 * token in observatory.css, and the utilities, scrollbars, selection color,
 * and canvas painter all read tokens, so nothing else needs to know. The
 * choice persists in localStorage and is applied before first paint by
 * main.tsx calling initTheme().
 */

import { useCallback, useSyncExternalStore } from 'react'
import { resetPalette } from '@renderer/views/graph/paint'

export type ThemeId = 'dark' | 'light'

const STORAGE_KEY = 'galileo.theme'

function readStored(): ThemeId {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

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

/** Called once from main.tsx, before React mounts, so the first paint is
 *  already in the stored theme — no dark flash for light-theme users. */
export function initTheme(): void {
  apply(readStored())
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
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Persistence is best-effort; the in-session switch still applies.
    }
    apply(next)
  }, [])
  return { theme, setTheme }
}
