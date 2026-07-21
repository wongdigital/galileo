/**
 * Getting the compiled people/franchise index into the renderer.
 *
 * `facetMap.ts` deliberately does not import this file, and its reasoning still
 * holds: the index is large, it goes stale against the live feed, and its
 * staleness check needs a hash. The graph is the first surface that actually
 * needs people and franchises, so this module answers all three points rather
 * than relaxing the rule.
 *
 * - **Large** — loaded through a dynamic import, so it stays a separate chunk
 *   off the boot-critical bundle. `useSchedule` now consumes it too (the
 *   `person`/`ip` filter dimensions join against it), so it loads shortly after
 *   boot rather than on first graph open — but asynchronously, behind the first
 *   paint of the 5-day list.
 * - **Stale** — the hash check runs here, in the renderer, against Web Crypto.
 *   Same algorithm as the compiler (sha256, first 16 hex chars), so an event
 *   whose description was rewritten since the compile degrades to no people and
 *   no franchises, exactly as `joinEnrichment` would have degraded it.
 * - **Main should own it** — main owns the *live* dataset, which is fetched and
 *   diffed and can disagree with itself. The index is a committed static file
 *   that ships with the code, like the facet table; routing it through IPC would
 *   add a channel without adding an owner.
 */

import { useEffect, useState } from 'react'
import type { ScheduleEvent } from '@shared/schedule'
import { validateEnrichmentIndex, type EnrichmentEntry, type EnrichmentIndex } from '@shared/enrichment'

let pending: Promise<EnrichmentIndex | null> | null = null

/** Memoized across mounts — toggling views must not re-parse 1.2 MB. */
export function loadEnrichmentIndex(): Promise<EnrichmentIndex | null> {
  pending ??= import('@data/enrichment.json')
    .then((module) => {
      const result = validateEnrichmentIndex(module.default)
      if (!result.ok) {
        console.warn('[enrichment] index rejected:', result.errors.join('; '))
        return null
      }
      if (result.warnings.length) {
        console.warn(`[enrichment] ${result.warnings.length} entry warnings, first:`, result.warnings[0])
      }
      return result.index
    })
    .catch((error: unknown) => {
      // A missing or corrupt index is a degraded graph, not a broken app: the
      // genre lens is deterministic and keeps working.
      console.warn('[enrichment] index failed to load:', error)
      return null
    })
  return pending
}

const encoder = new TextEncoder()

async function sha16(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

/**
 * UIDs whose live description no longer matches the one the extraction was read
 * from. Their people and franchises are dropped — the prose moved under the
 * extraction, so what it says about the event is a claim about text that is no
 * longer on screen.
 */
export async function staleUids(
  events: readonly ScheduleEvent[],
  index: EnrichmentIndex
): Promise<Set<string>> {
  const stale = new Set<string>()
  if (typeof crypto === 'undefined' || !crypto.subtle) return stale

  for (const event of events) {
    const entry = index.entries[event.uid]
    if (!entry || entry.status !== 'ok') continue
    // An `ok` entry with no hash means the compiler could not vouch for the
    // text, which `joinEnrichment` also treats as drift rather than as a pass.
    if (!entry.description_hash) {
      stale.add(event.uid)
      continue
    }
    if ((await sha16(event.description ?? '')) !== entry.description_hash) stale.add(event.uid)
  }
  return stale
}

export interface EnrichmentSource {
  ready: boolean
  /** Trustworthy entries only — absent, failed, and stale UIDs are not here. */
  entryFor: (uid: string) => EnrichmentEntry | null
  stats: { entries: number; stale: number }
}

const EMPTY: EnrichmentSource = { ready: false, entryFor: () => null, stats: { entries: 0, stale: 0 } }

/**
 * One staleness pass per dataset, no matter how many hooks mount. The pass
 * hashes every event description (3,474 sha256 calls through Web Crypto), and
 * the graph view and every event card each mount this hook — per-instance
 * effects would re-run the whole pass on every card pin. Keyed on the events
 * array identity, same signal `useSchedule`'s Layer-1 cache uses.
 */
const sourceCache = new WeakMap<readonly ScheduleEvent[], Promise<EnrichmentSource>>()

async function computeSource(events: readonly ScheduleEvent[]): Promise<EnrichmentSource> {
  const index = await loadEnrichmentIndex()
  if (!index) {
    // No index: the graph still runs on the genre lens; cards show no
    // extracted people or franchises.
    return { ready: true, entryFor: () => null, stats: { entries: 0, stale: 0 } }
  }
  const stale = await staleUids(events, index)
  return {
    ready: true,
    entryFor: (uid) => {
      if (stale.has(uid)) return null
      const entry = index.entries[uid]
      return entry && entry.status === 'ok' ? entry : null
    },
    stats: { entries: Object.keys(index.entries).length, stale: stale.size },
  }
}

/**
 * Loads the index once and re-runs the staleness pass whenever the dataset
 * swaps. Returns a not-ready source until both finish, which the graph renders
 * as a loading state rather than as an empty corpus.
 */
export function useEnrichmentSource(events: readonly ScheduleEvent[] | undefined): EnrichmentSource {
  const [source, setSource] = useState<EnrichmentSource>(EMPTY)

  useEffect(() => {
    if (!events) return
    let cancelled = false

    let pending = sourceCache.get(events)
    if (!pending) {
      pending = computeSource(events)
      sourceCache.set(events, pending)
    }
    void pending.then((computed) => {
      if (!cancelled) setSource(computed)
    })

    return () => {
      cancelled = true
    }
  }, [events])

  return source
}
