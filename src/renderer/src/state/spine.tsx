import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'
import { normalizeStars, starFromEvent, toggleStar, unstar, type StarRecord } from '@shared/stars'
import { EMPTY_FILTER, type FilterState } from '@shared/filter'
import type { LensId } from '@shared/graph'
import { bridge } from '../bridge'

/**
 * The state spine — the single container both views read and write (R10, R12).
 *
 * Invariant: the spine stores **inputs only**. Ghosts, change flags, filtered
 * sets, edge sets, and shelves are derived selectors over these inputs (see
 * `derive.ts` and `useSchedule.ts`), never stored copies. Storing a projection
 * is the filter/agenda desync class this app exists to kill.
 *
 * Identity is UID everywhere — verified stable across Sched edits, see
 * docs/solutions/2026-07-18-uid-is-the-identity-key.md.
 *
 * U2 established the container and the view toggle; U5 adds the dataset,
 * filters, stars, and refresh; U6 adds the lens.
 *
 * The graph's seed lived here until the entity map replaced the ego view. It is
 * gone rather than deprecated: the map's scope is the filter, and its only local
 * state is a transient pin on an entity, which is not a spine UID and does not
 * belong in a store two views read.
 */

export type ViewMode = 'graph' | 'schedule'

export type LoadStatus = 'loading' | 'ready'

export interface SpineState {
  view: ViewMode
  setView: (view: ViewMode) => void
  /** The focused event, by UID. Survives the view toggle — that's the point. */
  selectedUid: string | null
  setSelectedUid: (uid: string | null) => void

  /** Main's read-only projection. Null only before the first load resolves. */
  dataset: DatasetProjection | null
  status: LoadStatus
  /** Set when the last refresh threw. The previous dataset stays on screen. */
  refreshError: string | null
  refresh: (options?: { acceptAnyway?: boolean }) => Promise<void>
  acknowledge: (uids: string[]) => Promise<void>

  stars: StarRecord[]
  /** Set when a star write did not land — see the echo-back note below. */
  starError: string | null
  toggleStar: (event: ScheduleEvent) => Promise<void>
  /** Star many events in one persist, folding them into the current list and
   *  skipping any already starred. Returns the echoed-back persisted list so a
   *  caller can confirm which uids actually landed. */
  starMany: (events: ScheduleEvent[]) => Promise<StarRecord[]>
  /** Unstar by UID alone, which is the only way to clear a ghost. */
  removeStar: (uid: string) => Promise<void>

  filter: FilterState
  setFilter: (next: FilterState) => void

  /** Which of the five days the list is showing. Null before data arrives. */
  activeDay: string | null
  setActiveDay: (day: string | null) => void

  /**
   * What "related" means on the entity map: which entities an event is reduced
   * to. It is the map's only mode — the scope comes from the filter, and the
   * map holds no state of its own beyond a transient pin.
   */
  lens: LensId
  setLens: (lens: LensId) => void
}

const SpineContext = createContext<SpineState | null>(null)

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function SpineProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewMode>('schedule')
  const [selectedUid, setSelectedUid] = useState<string | null>(null)

  const [dataset, setDataset] = useState<DatasetProjection | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const [stars, setStars] = useState<StarRecord[]>([])
  const [starError, setStarError] = useState<string | null>(null)

  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  const [activeDay, setActiveDay] = useState<string | null>(null)

  // IP is the opening lens because it is the one with data across the whole
  // corpus — people covers Programs and Autographs, IP covers Anime and Games,
  // and the app boots into neither half in particular.
  const [lens, setLens] = useState<LensId>('ip')

  // Guards the effect against StrictMode's double-invoke, which would otherwise
  // fire two live fetches at Sched on every mount in development.
  const started = useRef(false)

  const refresh = useCallback(async (options?: { acceptAnyway?: boolean }) => {
    const api = bridge()
    if (!api) {
      setStatus('ready')
      setRefreshError('No Electron bridge — the app is running outside its shell.')
      return
    }
    setStatus('loading')
    try {
      const next = (await api.schedule.refresh(options)) as DatasetProjection
      setDataset(next)
      setRefreshError(null)
    } catch (error) {
      // The previous dataset stays exactly where it is. A failed refresh shows
      // a stale banner over a working list, never a blank app.
      setRefreshError(message(error))
    } finally {
      setStatus('ready')
    }
  }, [])

  const acknowledge = useCallback(async (uids: string[]) => {
    const api = bridge()
    if (!api || uids.length === 0) return
    try {
      const entries = (await api.changes.acknowledge(uids)) as DatasetProjection['changes']
      // Main returns the surviving log, so the badge state on screen is the one
      // that will still be there after a restart.
      setDataset((current) => (current ? { ...current, changes: entries } : current))
    } catch (error) {
      console.warn('[changes] acknowledge failed:', error)
    }
  }, [])

  /**
   * Echo-back (R11): main returns what it actually persisted and the renderer
   * adopts *that*, not its own optimistic list. A write that failed shows up
   * immediately as the star popping back off — visible now, rather than as a
   * starred list that looked fine all weekend and was empty after a restart.
   */
  const persistStars = useCallback(async (next: StarRecord[], expectUid?: string, expectStarred?: boolean): Promise<StarRecord[]> => {
    const api = bridge()
    if (!api) {
      setStarError('No Electron bridge — stars cannot be saved.')
      return stars
    }
    setStars(next) // optimistic, so the row responds to the click immediately
    try {
      const persisted = normalizeStars(await api.stars.set(next))
      setStars(persisted)
      const landed =
        expectUid === undefined ||
        persisted.some((s) => s.uid === expectUid) === (expectStarred ?? true)
      setStarError(landed ? null : 'Star did not save — check disk permissions.')
      return persisted
    } catch (error) {
      const api2 = bridge()
      setStarError(message(error))
      // Re-read rather than keeping the optimistic list: on-disk truth is the
      // only thing that survives a restart, so it is the only thing to show.
      try {
        if (api2) {
          const reread = normalizeStars(await api2.stars.get())
          setStars(reread)
          return reread
        }
      } catch {
        // Nothing further to try; starError already says the write is unsafe.
      }
      return stars
    }
  }, [stars])

  const toggleStarFor = useCallback(
    async (event: ScheduleEvent) => {
      const wasStarred = stars.some((s) => s.uid === event.uid)
      await persistStars(toggleStar(stars, event, new Date().toISOString()), event.uid, !wasStarred)
    },
    [persistStars, stars],
  )

  const starManyFor = useCallback(
    async (events: ScheduleEvent[]): Promise<StarRecord[]> => {
      const now = new Date().toISOString()
      let next = stars
      for (const event of events) {
        if (!next.some((s) => s.uid === event.uid)) next = [...next, starFromEvent(event, now)]
      }
      if (next === stars) return stars
      return persistStars(next)
    },
    [persistStars, stars],
  )

  const removeStar = useCallback(
    async (uid: string) => {
      await persistStars(unstar(stars, uid), uid, false)
    },
    [persistStars, stars],
  )

  useEffect(() => {
    if (started.current) return
    started.current = true

    const api = bridge()
    if (api) {
      api.stars
        .get()
        .then((persisted) => setStars(normalizeStars(persisted)))
        .catch((error: unknown) => setStarError(message(error)))
    }
    void refresh()
  }, [refresh])

  const value = useMemo<SpineState>(
    () => ({
      view,
      setView,
      selectedUid,
      setSelectedUid,
      dataset,
      status,
      refreshError,
      refresh,
      acknowledge,
      stars,
      starError,
      toggleStar: toggleStarFor,
      starMany: starManyFor,
      removeStar,
      filter,
      setFilter,
      activeDay,
      setActiveDay,
      lens,
      setLens,
    }),
    [
      view,
      selectedUid,
      dataset,
      status,
      refreshError,
      refresh,
      acknowledge,
      stars,
      starError,
      toggleStarFor,
      starManyFor,
      removeStar,
      filter,
      activeDay,
      lens,
    ],
  )

  return <SpineContext.Provider value={value}>{children}</SpineContext.Provider>
}

export function useSpine(): SpineState {
  const ctx = useContext(SpineContext)
  if (!ctx) throw new Error('useSpine must be used inside <SpineProvider>')
  return ctx
}
