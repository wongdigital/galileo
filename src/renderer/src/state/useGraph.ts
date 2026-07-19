/**
 * The graph's view model — the same derived-selector discipline as
 * `useSchedule`, over the same spine.
 *
 * Layers, ordered by what invalidates them:
 *
 * 1. **Records** — dataset + compiled index. The expensive pass.
 * 2. **Lens indexes** — all four, built once per dataset. Building every lens
 *    up front is what makes switching instant, and it is also what lets a
 *    zero-edge seed quote the counts for the lenses it is *not* showing.
 * 3. **Node set** — `expandEgo` under the lens the seed was made with.
 * 4. **Links** — recomputed under the *active* lens over that fixed node set.
 *
 * Steps 3 and 4 are separate on purpose. It is the whole reason a lens switch
 * reads as the same constellation reorganizing rather than a new scene.
 */

import { useMemo } from 'react'
import { buildOfferings } from '@shared/enrichment'
import {
  LENSES,
  buildLensIndexes,
  degreesByLens,
  expandEgo,
  fringeUids,
  linksWithin,
  type GraphLink,
  type GraphRecord,
  type LensId,
  type LensIndex,
} from '@shared/graph'
import type { ScheduleEvent } from '@shared/schedule'
import { useSpine } from './spine'
import { useSchedule } from './useSchedule'
import { useEnrichmentSource } from './enrichmentIndex'
import { buildRow, formatTime, type RowState } from './derive'

/**
 * A filter result is a legitimate seed; 1,171 Games events is not. The cap is
 * the point at which the force layout stops being a picture of anything, so
 * beyond it the UI asks the user to narrow rather than rendering a smear.
 */
export const SEED_CAP = 30

export interface GraphNodeModel {
  uid: string
  event: ScheduleEvent
  title: string
  time: string
  room: string
  /** Lens-independent encodings, identical in meaning to the list's (AE4). */
  starred: boolean
  states: RowState[]
  seed: boolean
  /** No edge under the active lens — dims toward the rim (R8). */
  fringe: boolean
}

export interface SeedCandidate {
  uid: string
  title: string
  time: string
  source: 'star' | 'filter'
}

export interface GraphModel {
  ready: boolean
  /** True once the compiled index has loaded; people/IP are empty before it. */
  indexReady: boolean
  lens: LensId
  indexes: ReadonlyMap<LensId, LensIndex>
  nodes: GraphNodeModel[]
  links: GraphLink[]
  /** hop-1 neighbours that did not fit, so the UI can say "24 of 486". */
  omitted: number
  /** Per-lens neighbour counts for the seed — the zero-edge escape hatch. */
  seedDegrees: { lens: LensId; degree: number }[]
  /** Set when a filter seed was truncated to `SEED_CAP`. */
  seedTruncated: { requested: number; used: number } | null
  /** Offered by the no-seed prompt state. Never an empty canvas. */
  candidates: SeedCandidate[]
  filteredUids: string[]
}

export function useGraph(): GraphModel {
  const { dataset, lens, seed, stars } = useSpine()
  const schedule = useSchedule()
  const enrichment = useEnrichmentSource(dataset?.events)

  const events = dataset?.events
  const changes = dataset?.changes

  // Layer 1 — records. Facets and offerings are deterministic and always
  // present; people and franchises arrive only for entries the hash vouches for.
  const records = useMemo<GraphRecord[]>(() => {
    const list = events ?? []
    const offerings = buildOfferings(list)
    return list.map((event) => {
      const entry = enrichment.entryFor(event.uid)
      const key = offerings.keyByUid.get(event.uid) ?? ''
      const offering = offerings.byKey.get(key)
      return {
        uid: event.uid,
        people: entry?.people ?? [],
        franchises: entry?.franchises ?? [],
        facets: schedule.facetsByUid.get(event.uid)?.facets ?? {},
        offeringKey: key,
        offeringTitle: offering?.title,
        offeringSessions: offering?.sessionCount ?? 1,
      }
    })
  }, [events, enrichment, schedule.facetsByUid])

  // Layer 2 — all four lenses at once.
  const indexes = useMemo(() => buildLensIndexes(records, LENSES), [records])

  const starredUids = useMemo(() => new Set(stars.map((s) => s.uid)), [stars])

  // Layer 3 — the node set, from the lens the seed was made under.
  const ego = useMemo(() => {
    if (!seed || seed.uids.length === 0) return null
    const index = indexes.get(seed.lens)
    if (!index) return null
    const used = seed.uids.slice(0, SEED_CAP)
    // A multi-seed set expands narrowly: 30 seeds each pulling 24 neighbours is
    // the same unreadable smear the cap exists to prevent.
    const hop1Limit = used.length > 1 ? Math.max(2, Math.floor(60 / used.length)) : 24
    return {
      ...expandEgo(index, used, { hops: seed.hops, hop1Limit }),
      truncated: seed.uids.length > used.length ? { requested: seed.uids.length, used: used.length } : null,
    }
  }, [seed, indexes])

  // Layer 4 — links under the *active* lens over that fixed node set.
  const links = useMemo(() => {
    const index = indexes.get(lens)
    if (!ego || !index) return []
    return linksWithin(index, ego.uids)
  }, [ego, indexes, lens])

  const nodes = useMemo<GraphNodeModel[]>(() => {
    if (!ego) return []
    const fringe = new Set(fringeUids(ego.uids, links))
    const seeds = new Set(ego.seeds)
    const out: GraphNodeModel[] = []
    for (const uid of ego.uids) {
      const event = schedule.byUid.get(uid)
      if (!event) continue
      const row = buildRow(event, {
        classes: schedule.classes,
        changes: changes ?? {},
        starredUids,
      })
      out.push({
        uid,
        event,
        title: event.title,
        time: row.time,
        room: event.room,
        starred: row.starred,
        states: row.states,
        seed: seeds.has(uid),
        fringe: fringe.has(uid),
      })
    }
    return out
  }, [ego, links, schedule.byUid, schedule.classes, changes, starredUids])

  const seedDegrees = useMemo(() => {
    const first = seed?.uids[0]
    return first ? degreesByLens(indexes, first) : []
  }, [seed, indexes])

  // The prompt state's offer: what the user has already marked, then what the
  // filter currently holds. Both are things they chose; the corpus is not.
  const candidates = useMemo<SeedCandidate[]>(() => {
    const out: SeedCandidate[] = []
    const recentStars = [...stars]
      .sort((a, b) => (b.starredAt ?? '').localeCompare(a.starredAt ?? ''))
      .slice(0, 5)
    for (const star of recentStars) {
      const event = schedule.byUid.get(star.uid)
      if (event) out.push({ uid: event.uid, title: event.title, time: formatTime(event.start), source: 'star' })
    }
    for (const row of schedule.rows) {
      if (out.length >= 8) break
      if (out.some((c) => c.uid === row.uid)) continue
      out.push({ uid: row.uid, title: row.event.title, time: row.time, source: 'filter' })
    }
    return out
  }, [stars, schedule.byUid, schedule.rows])

  return {
    ready: !!events,
    indexReady: enrichment.ready,
    lens,
    indexes,
    nodes,
    links,
    omitted: ego?.omitted ?? 0,
    seedDegrees,
    seedTruncated: ego?.truncated ?? null,
    candidates,
    filteredUids: schedule.filteredUids,
  }
}
