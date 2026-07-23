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
import { EMPTY_FILTER, findDimension, type FilterChip, type FilterState } from '@shared/filter'
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
 * filters, stars, and refresh; U6 adds the lens. U9 adds focused entity
 * identity because both the canvas and its narrow-width list expression read
 * it; it remains session state and is never persisted.
 */

export type ViewMode = 'graph' | 'schedule'

export type LoadStatus = 'loading' | 'ready'

export interface SpineState {
  view: ViewMode
  setView: (view: ViewMode) => void
  /** The focused event, by UID. Survives the view toggle — that's the point. */
  selectedUid: string | null
  setSelectedUid: (uid: string | null) => void
  /** The focused graph hub, by its lens-namespaced entity id. Like event
   * selection, it survives graph/list and viewport-tier swaps. */
  focusedEntityId: string | null
  setFocusedEntityId: (id: string | null) => void

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

function restoredFilter(value: unknown): FilterState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<FilterState>
  if (
    !Array.isArray(candidate.chips) ||
    typeof candidate.text !== 'string' ||
    typeof candidate.starredOnly !== 'boolean' ||
    typeof candidate.changedOnly !== 'boolean'
  ) {
    return null
  }

  const chips: FilterChip[] = []
  for (const valueChip of candidate.chips) {
    if (!valueChip || typeof valueChip !== 'object' || Array.isArray(valueChip)) return null
    const chip = valueChip as Partial<FilterChip>
    const dimension =
      typeof chip.dimension === 'string' ? findDimension(chip.dimension) : null
    if (
      !dimension ||
      typeof chip.value !== 'string' ||
      chip.value.length === 0 ||
      (chip.negated !== undefined && typeof chip.negated !== 'boolean') ||
      (chip.negated === true && dimension.kind === 'interest')
    ) {
      return null
    }
    chips.push({
      dimension: dimension.id,
      value: chip.value,
      ...(chip.negated === true ? { negated: true } : {}),
    })
  }

  return {
    chips,
    text: candidate.text,
    starredOnly: candidate.starredOnly,
    changedOnly: candidate.changedOnly,
  }
}

export function SpineProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewMode>('schedule')
  const [selectedUid, setSelectedUidState] = useState<string | null>(null)
  const [focusedEntityId, setFocusedEntityIdState] = useState<string | null>(null)

  // An event card and an entity card are two expressions of one focus.
  // Centralizing the exclusion also covers selections made outside the graph,
  // so no hidden entity focus can win when the user opens Related.
  const setSelectedUid = useCallback((uid: string | null) => {
    setSelectedUidState(uid)
    if (uid !== null) setFocusedEntityIdState(null)
  }, [])
  const setFocusedEntityId = useCallback((id: string | null) => {
    setFocusedEntityIdState(id)
    if (id !== null) setSelectedUidState(null)
  }, [])

  const [dataset, setDataset] = useState<DatasetProjection | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const [stars, setStars] = useState<StarRecord[]>([])
  const [starError, setStarError] = useState<string | null>(null)

  const [filter, setFilterState] = useState<FilterState>(EMPTY_FILTER)
  const filterRevision = useRef(0)
  const [activeDay, setActiveDay] = useState<string | null>(null)

  // IP is the opening lens because it is the one with data across the whole
  // corpus — people covers Programs and Autographs, IP covers Anime and Games,
  // and the app boots into neither half in particular.
  const [lens, setLens] = useState<LensId>('ip')

  // Guards the effect against StrictMode's double-invoke, which would otherwise
  // fire two live fetches at Sched on every mount in development.
  const started = useRef(false)
  const refreshInFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback((options?: { acceptAnyway?: boolean }): Promise<void> => {
    if (refreshInFlight.current) return refreshInFlight.current

    const api = bridge()
    if (!api) {
      setStatus('ready')
      setRefreshError('No Electron bridge — the app is running outside its shell.')
      return Promise.resolve()
    }

    setStatus('loading')
    let pending!: Promise<void>
    pending = (async () => {
      try {
        const next = (await api.schedule.refresh(options)) as DatasetProjection
        setDataset(next)
        setRefreshError(null)
      } catch (error) {
        // The previous dataset stays exactly where it is. A failed refresh shows
        // a stale banner over a working list, never a blank app.
        setRefreshError(message(error))
      } finally {
        if (refreshInFlight.current === pending) refreshInFlight.current = null
        setStatus('ready')
      }
    })()
    refreshInFlight.current = pending
    return pending
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

  const setFilter = useCallback((next: FilterState) => {
    filterRevision.current += 1
    setFilterState(next)
    const api = bridge()
    if (api) {
      void api.settings
        .set('filters', next)
        .catch((error: unknown) => console.warn('[settings] filter write failed:', error))
    }
  }, [])

  useEffect(() => {
    const api = bridge()
    if (!api) return
    const revisionAtStart = filterRevision.current
    void api.settings
      .get('filters')
      .then((stored) => {
        const next = restoredFilter(stored)
        // Loading a durable value must never replace a chip/search interaction
        // that happened while the platform call was still pending.
        if (next && filterRevision.current === revisionAtStart) setFilterState(next)
      })
      .catch((error: unknown) => console.warn('[settings] filter read failed:', error))
  }, [])

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
      focusedEntityId,
      setFocusedEntityId,
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
      focusedEntityId,
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
