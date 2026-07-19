/**
 * Joining the compiled index against live events.
 *
 * The join is layered by how well each layer survives the schedule changing
 * underneath it. Facets, classes, and offerings are derived from the live event
 * on every join, so they are always right. People and franchises were extracted
 * from prose at compile time, so they are right only as long as that prose has
 * not moved — which is what `description_hash` is for.
 *
 * Four states, kept distinct on purpose:
 *
 * - `enriched`   — entry present, hash matches. Everything available.
 * - `not-enriched` — no entry for this UID. Never compiled; a gap to fill.
 * - `stale`      — entry present, hash differs. The description was rewritten
 *                  after the compile, so the extractions describe text that is
 *                  no longer on screen. Degraded exactly like an absent entry.
 * - `failed`     — entry present, status not `ok`. We tried and it did not work.
 *
 * Collapsing `not-enriched` into `failed`, or `stale` into `enriched`, would each
 * lose the one thing the maintainer needs to know to fix it.
 */

import type { ScheduleEvent } from '../schedule/types'
import type { EnrichmentIndex, ExtractedFranchise, ExtractedPerson } from './schema'
import { classifyEvent, durationMinutes, type ClassifyOptions, type EventClassification } from './classes'
import { applyFacets, type ApplyOptions, type EventFacets, type FacetMap } from './facets'
import { buildOfferings, type OfferingIndex } from './offerings'

export type EnrichmentState = 'enriched' | 'not-enriched' | 'stale' | 'failed'

export interface EnrichedEvent {
  event: ScheduleEvent
  /** Always populated. Facets survive an absent, stale, or failed entry. */
  facets: EventFacets
  classification: EventClassification
  offeringKey: string
  /** Empty unless `enrichment` is `enriched`. */
  people: ExtractedPerson[]
  /** Empty unless `enrichment` is `enriched`. */
  franchises: ExtractedFranchise[]
  enrichment: EnrichmentState
}

export interface JoinStats {
  events: number
  enriched: number
  notEnriched: number
  stale: number
  failed: number
  /** enriched / events, 0..1. */
  coverage: number
}

export interface JoinResult {
  byUid: Map<string, EnrichedEvent>
  offerings: OfferingIndex
  stats: JoinStats
}

export interface JoinOptions extends ClassifyOptions, ApplyOptions {
  /**
   * Hashes a description the same way the compiler did (sha256, first 16 hex
   * chars). Injected rather than imported because `src/shared/` may not touch
   * `node:crypto` — main supplies the real one, tests supply a stub.
   *
   * Required: without it the degrade rule cannot run, and a join that silently
   * skipped its own staleness check would be worse than one that refused to.
   */
  hashDescription: (description: string) => string
}

function resolveEntry(
  event: ScheduleEvent,
  index: EnrichmentIndex | null,
  hashDescription: (d: string) => string
): { state: EnrichmentState; people: ExtractedPerson[]; franchises: ExtractedFranchise[] } {
  const empty = { people: [] as ExtractedPerson[], franchises: [] as ExtractedFranchise[] }

  const entry = index?.entries[event.uid]
  if (!entry) return { state: 'not-enriched', ...empty }
  if (entry.status !== 'ok') return { state: 'failed', ...empty }

  // A missing hash on an `ok` entry means the compiler could not vouch for the
  // text, so it is treated as drift rather than as a pass.
  if (!entry.description_hash) return { state: 'stale', ...empty }
  if (entry.description_hash !== hashDescription(event.description ?? '')) {
    return { state: 'stale', ...empty }
  }

  return { state: 'enriched', people: entry.people ?? [], franchises: entry.franchises ?? [] }
}

/**
 * `index` may be null — the app is expected to run before any compile has
 * happened, on facets and classes alone. That is the point of keeping the
 * deterministic passes out of the index.
 */
export function joinEnrichment(
  events: readonly ScheduleEvent[],
  index: EnrichmentIndex | null,
  facetMap: FacetMap,
  options: JoinOptions
): JoinResult {
  const offerings = buildOfferings(events)
  const byUid = new Map<string, EnrichedEvent>()
  const stats: JoinStats = {
    events: events.length,
    enriched: 0,
    notEnriched: 0,
    stale: 0,
    failed: 0,
    coverage: 0
  }

  for (const event of events) {
    const classification = classifyEvent(event, options)
    const facets = applyFacets(event, facetMap, {
      ...options,
      durationMinutes: classification.durationMinutes ?? durationMinutes(event)
    })
    const resolved = resolveEntry(event, index, options.hashDescription)

    if (resolved.state === 'enriched') stats.enriched++
    else if (resolved.state === 'not-enriched') stats.notEnriched++
    else if (resolved.state === 'stale') stats.stale++
    else stats.failed++

    byUid.set(event.uid, {
      event,
      facets,
      classification,
      offeringKey: offerings.keyByUid.get(event.uid) ?? '',
      people: resolved.people,
      franchises: resolved.franchises,
      enrichment: resolved.state
    })
  }

  stats.coverage = stats.events === 0 ? 0 : stats.enriched / stats.events
  return { byUid, offerings, stats }
}
