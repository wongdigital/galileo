/**
 * The one selector the 5-day view reads.
 *
 * Everything below is derived from the spine's inputs on every render pass and
 * held only by `useMemo` — nothing here is state. That is the derived-state
 * rule made structural: there is no variable to forget to update when the
 * dataset swaps under a refresh, because there is no variable.
 *
 * The memo layers are ordered by what invalidates them. Classifying and
 * faceting 3,474 events is the expensive step, and it depends on the dataset
 * alone — so starring an event or typing in the search box does not redo it.
 *
 * Layer 1 is additionally shared *across hook instances* through a module-level
 * cache keyed on the events array. The sidebar, the list, and the entity map
 * each mount their own `useSchedule`, and per-instance memos would run the
 * corpus pass once per mount and again per instance on every dataset swap. The
 * pass is pure — events in, derived maps out — so instances sharing one result
 * is invisible except in the profiler. Keyed by the array's identity (a
 * WeakMap, so a replaced dataset frees the old derivation), which is the same
 * signal the memo used.
 */

import { useMemo } from 'react'
import { classifyAll, applyFacets, type EventClassification, type EventFacets } from '@shared/enrichment'
import {
  applyFilter,
  buildCandidate,
  isEmptyFilter,
  relaxations,
  type FilterCandidate,
  type MatchContext,
  type Relaxation,
} from '@shared/filter'
import type { ScheduleEvent } from '@shared/schedule'
import { FACET_MAP } from './facetMap'
import { useSpine } from './spine'
import {
  ALL_DAYS,
  buildDayBuckets,
  buildDayRows,
  buildGhostRows,
  ghostsForDay,
  resolveActiveDay,
  type DayBucket,
  type GhostRow,
  type RowModel,
} from './derive'

export interface ScheduleModel {
  /** Every live event, by UID — the lookup the star button and the row need. */
  byUid: Map<string, ScheduleEvent>
  /** Each event's computed con-day — what the All view groups its sticky
   *  headers by, so they match the day-rail buckets exactly. */
  dayByUid: Map<string, string | null>
  classes: Map<string, EventClassification>
  facetsByUid: Map<string, EventFacets>
  candidates: FilterCandidate[]
  matchContext: MatchContext

  /** Filtered across all five days, which is the number the sidebar reports. */
  filteredCount: number
  /** The same set, by UID — what the graph seeds from when the user asks it to
   *  show the current filter rather than one event. */
  filteredUids: string[]
  totalCount: number
  filterActive: boolean

  days: DayBucket[]
  /** Resolved, not raw: survives a refresh, falls back when the filter empties
   *  the day the user was on. */
  activeDay: string | null

  rows: RowModel[]
  ambient: RowModel[]
  ghosts: GhostRow[]
  /** All ghosts, not just the active day's — the sidebar counts these. */
  allGhosts: GhostRow[]

  /** "Removing X gives you N", only computed when the result set is empty. */
  relaxations: Relaxation[]
}

interface ScheduleBase {
  classes: Map<string, EventClassification>
  facetsByUid: Map<string, EventFacets>
  candidates: FilterCandidate[]
  byUid: Map<string, ScheduleEvent>
  dayByUid: Map<string, string | null>
  liveUids: Set<string>
}

/** One entry per live dataset — in practice one, briefly two across a swap. */
const baseCache = new WeakMap<readonly ScheduleEvent[], ScheduleBase>()

/** Stable stand-in for "no dataset yet", so pre-load renders across all
 *  instances share the one empty derivation instead of each building theirs. */
const NO_EVENTS: readonly ScheduleEvent[] = []

function deriveBase(list: readonly ScheduleEvent[]): ScheduleBase {
  const cached = baseCache.get(list)
  if (cached) return cached

  const classes = classifyAll(list)
  const facetsByUid = new Map<string, EventFacets>()
  const candidates: FilterCandidate[] = []
  const byUid = new Map<string, ScheduleEvent>()
  const dayByUid = new Map<string, string | null>()

  for (const event of list) {
    const classification = classes.get(event.uid)
    const facets = applyFacets(event, FACET_MAP, {
      durationMinutes: classification?.durationMinutes ?? null,
    })
    facetsByUid.set(event.uid, facets)
    byUid.set(event.uid, event)
    dayByUid.set(event.uid, facets.computed.day)
    candidates.push(buildCandidate({ event, facets, classification }))
  }

  const base: ScheduleBase = {
    classes,
    facetsByUid,
    candidates,
    byUid,
    dayByUid,
    liveUids: new Set(byUid.keys()),
  }
  baseCache.set(list, base)
  return base
}

export function useSchedule(): ScheduleModel {
  const { dataset, filter, stars, activeDay } = useSpine()

  const events = dataset?.events
  const changes = dataset?.changes

  // Layer 1 — dataset only. The expensive pass, shared across instances; the
  // memo is only here so *this* instance re-reads the cache exactly when its
  // events identity moves.
  const base = useMemo(() => deriveBase(events ?? NO_EVENTS), [events])

  // Layer 2 — star and change membership. Rebuilt on a star click, but only
  // two Sets, so the click stays instant at corpus scale.
  const matchContext = useMemo<MatchContext>(() => {
    const starred = new Set(stars.map((s) => s.uid))
    const changed = new Set(Object.keys(changes ?? {}))
    return { isStarred: (uid) => starred.has(uid), hasUnseenChanges: (uid) => changed.has(uid) }
  }, [stars, changes])

  const starredUids = useMemo(() => new Set(stars.map((s) => s.uid)), [stars])

  // Layer 3 — the filter itself.
  const filtered = useMemo(
    () => applyFilter(base.candidates, filter, matchContext),
    [base.candidates, filter, matchContext],
  )

  const days = useMemo(
    () =>
      buildDayBuckets(
        [...base.dayByUid.values()],
        filtered.map((c) => base.dayByUid.get(c.uid) ?? null),
      ),
    [base.dayByUid, filtered],
  )

  const resolvedDay = useMemo(() => resolveActiveDay(days, activeDay), [days, activeDay])

  const { rows, ambient } = useMemo(() => {
    const dayEvents: ScheduleEvent[] = []
    for (const candidate of filtered) {
      // "All" keeps every filtered event, any day; buildDayRows sorts them into
      // one chronological list across the con.
      if (resolvedDay !== ALL_DAYS && base.dayByUid.get(candidate.uid) !== resolvedDay) continue
      const event = base.byUid.get(candidate.uid)
      if (event) dayEvents.push(event)
    }
    return buildDayRows({
      events: dayEvents,
      classes: base.classes,
      changes: changes ?? {},
      starredUids,
    })
  }, [filtered, base, resolvedDay, changes, starredUids])

  const allGhosts = useMemo(() => buildGhostRows(stars, base.liveUids), [stars, base.liveUids])
  const ghosts = useMemo(
    () => (resolvedDay === ALL_DAYS ? allGhosts : ghostsForDay(allGhosts, resolvedDay)),
    [allGhosts, resolvedDay],
  )

  // Memoized for its *identity*, not its cost. Consumers use it as a dependency,
  // and a fresh array on every render restarts anything keyed on it — which is
  // how hovering a node came to reset the force layout underneath it.
  const filteredUids = useMemo(() => filtered.map((c) => c.uid), [filtered])

  // Only worth computing when there is nothing to show — it re-runs the engine
  // once per active chip, which is wasted work the rest of the time.
  const hints = useMemo(
    () => (filtered.length === 0 ? relaxations(base.candidates, filter, matchContext) : []),
    [filtered.length, base.candidates, filter, matchContext],
  )

  return {
    byUid: base.byUid,
    dayByUid: base.dayByUid,
    classes: base.classes,
    facetsByUid: base.facetsByUid,
    candidates: base.candidates,
    matchContext,
    filteredCount: filtered.length,
    filteredUids,
    totalCount: base.candidates.length,
    filterActive: !isEmptyFilter(filter),
    days,
    activeDay: resolvedDay,
    rows,
    ambient,
    ghosts,
    allGhosts,
    relaxations: hints,
  }
}
