import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * The state spine — the single container both views read and write (R10, R12).
 *
 * Invariant: the spine stores **inputs only**. Ghosts, change flags, filtered
 * sets, edge sets, and shelves are derived selectors over these inputs, never
 * stored copies. Storing a projection is the filter/agenda desync class this
 * app exists to kill.
 *
 * Identity is UID everywhere — verified stable across Sched edits, see
 * docs/solutions/2026-07-18-uid-is-the-identity-key.md.
 *
 * U2 establishes the container and the view toggle; U5 adds filters and stars,
 * U6 adds lens and seed.
 */

export type ViewMode = 'graph' | 'schedule'

export interface SpineState {
  view: ViewMode
  setView: (view: ViewMode) => void
  /** The focused event, by UID. Survives the view toggle — that's the point. */
  selectedUid: string | null
  setSelectedUid: (uid: string | null) => void
}

const SpineContext = createContext<SpineState | null>(null)

export function SpineProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewMode>('schedule')
  const [selectedUid, setSelectedUid] = useState<string | null>(null)

  const value = useMemo(
    () => ({ view, setView, selectedUid, setSelectedUid }),
    [view, selectedUid],
  )

  return <SpineContext.Provider value={value}>{children}</SpineContext.Provider>
}

export function useSpine(): SpineState {
  const ctx = useContext(SpineContext)
  if (!ctx) throw new Error('useSpine must be used inside <SpineProvider>')
  return ctx
}
