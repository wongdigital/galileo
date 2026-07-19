/**
 * The facet model: 182 flat Sched tags turned into dimensions you can actually
 * filter on, plus the dimensions that are computed from the event itself and
 * never trust a tag at all.
 *
 * Two rules shape everything here.
 *
 * **Tags are applied at runtime, not precompiled per UID.** The table is a small
 * committed JSON file consulted on every join, so an event added during con week
 * gets its facets the moment it appears in the feed. Only people and franchises
 * wait for a maintainer recompile.
 *
 * **Computed beats claimed, always.** Day, time band, duration band, and building
 * come from the event's own start/end/room. The corresponding tags map into
 * `*_hint` validation dimensions purely so a disagreement is *measurable* — and
 * they do disagree: a 300-minute Games block is tagged "45 Minutes" because the
 * tag describes the game, not the block. A UI that trusted that tag would tell
 * you a five-hour open table is a forty-five-minute commitment.
 */

import type { ScheduleEvent } from '../schedule/types'

// ---------- the table ----------

export interface FacetDimension {
  id: string
  label: string
  /** `curated` dimensions drive filters; `validation` dimensions only report. */
  kind: 'curated' | 'validation'
  multi: boolean
  numeric?: boolean
  ordered_values?: { id: string; label: string; min_age: number }[]
}

export interface NumericRange {
  min: number
  max: number | null
}

export interface FacetMap {
  schema_version: number
  dimensions: FacetDimension[]
  /** Raw Sched tag -> `"dimension:value"` strings. */
  tags: Record<string, string[]>
  /** Raw tag -> parsed numeric bounds, for the "works for N" queries. */
  ranges: Record<string, { age?: NumericRange; players?: NumericRange }>
}

export type AudienceBand = 'all-ages' | 'kids' | 'teens' | 'adults'

/** Four bands, ordered by how restrictive they are. */
export const AUDIENCE_BANDS: readonly AudienceBand[] = ['all-ages', 'kids', 'teens', 'adults']

export function audienceBandForMinAge(minAge: number): AudienceBand {
  if (minAge <= 6) return 'all-ages'
  if (minAge <= 12) return 'kids'
  if (minAge <= 17) return 'teens'
  return 'adults'
}

// ---------- computed dimensions ----------

export type TimeBand = 'morning' | 'afternoon' | 'evening' | 'late-night'
export type DurationBand = 'short' | 'standard' | 'long' | 'block'
export type Building =
  | 'convention-center'
  | 'marriott'
  | 'hilton'
  | 'omni'
  | 'hyatt'
  | 'library'
  | 'museum'
  | 'other'

export interface ComputedDimensions {
  /** Local calendar date of `start`, `YYYY-MM-DD`. Null when start is missing. */
  day: string | null
  timeBand: TimeBand | null
  durationBand: DurationBand | null
  building: Building
}

/**
 * The feed carries an explicit Pacific offset on every timestamp and the whole
 * con is in one zone, so the local wall-clock fields are read off the string
 * directly. Going through `Date` would reinterpret them in the host's zone and
 * silently shift a late-night event onto the wrong day for anyone east of PT.
 */
function localParts(iso: string | null): { date: string; hour: number; minute: number } | null {
  if (!iso) return null
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return null
  return { date: m[1]!, hour: Number(m[2]), minute: Number(m[3]) }
}

export interface ComputeOptions {
  /**
   * Hour before which an event counts as belonging to the previous day. A 12:30am
   * Saturday panel is Friday-night programming, and Sched agrees — it tags those
   * "After Dark". Defaults to 0 (plain calendar date) so this module cannot
   * silently disagree with the day bucketing in `src/shared/schedule`; set it
   * deliberately, in one place, if the app adopts night-owl days.
   */
  nightOwlCutoffHour?: number
}

export function computeDay(event: ScheduleEvent, options: ComputeOptions = {}): string | null {
  const parts = localParts(event.start)
  if (!parts) return null
  const cutoff = options.nightOwlCutoffHour ?? 0
  if (cutoff > 0 && parts.hour < cutoff) {
    const d = new Date(`${parts.date}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  }
  return parts.date
}

export function computeTimeBand(event: ScheduleEvent): TimeBand | null {
  const parts = localParts(event.start)
  if (!parts) return null
  const h = parts.hour
  if (h < 5) return 'late-night'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  if (h < 21) return 'evening'
  return 'late-night'
}

/**
 * Bands cut where the live distribution actually clusters: 962 events under
 * 30 minutes (autograph slots, short demos), 1,183 in the 30-89 range (the panel
 * standard), 389 at 90-239, and 940 at four hours or more.
 */
export function computeDurationBand(minutes: number | null): DurationBand | null {
  if (minutes === null) return null
  if (minutes < 30) return 'short'
  if (minutes < 90) return 'standard'
  if (minutes < 240) return 'long'
  return 'block'
}

export function computeBuilding(event: ScheduleEvent): Building {
  const room = event.room ?? ''
  if (/Marriott/i.test(room)) return 'marriott'
  if (/Hilton/i.test(room)) return 'hilton'
  if (/Omni/i.test(room)) return 'omni'
  if (/Hyatt/i.test(room)) return 'hyatt'
  if (/Library/i.test(room)) return 'library'
  if (/Museum/i.test(room)) return 'museum'
  // Convention center rooms are bare — "Hall H", "Room 25ABC", "Ballroom 20".
  // Everything else that names a venue has already matched above.
  if (room.trim().length === 0) return 'other'
  return room.includes(',') ? 'other' : 'convention-center'
}

// ---------- applying the table ----------

export interface ValidationMismatch {
  dimension: string
  tag: string
  claimed: string
  computed: string
}

export interface EventFacets {
  uid: string
  /** Curated dimension id -> values. Only non-empty dimensions appear. */
  facets: Record<string, string[]>
  computed: ComputedDimensions
  /** Widest supported player count across the event's tags, if any. */
  players: NumericRange | null
  /** Age floor/ceiling in years, from the age tags. */
  age: NumericRange | null
  audienceBand: AudienceBand | null
  /** Tags with no entry in the table. Visible, never dropped. */
  unmappedTags: string[]
  /** Where a tag's claim contradicts the computed truth. Reporting only. */
  validationMismatches: ValidationMismatch[]
}

const splitFacet = (facet: string): { dimension: string; value: string } | null => {
  const i = facet.indexOf(':')
  if (i <= 0) return null
  return { dimension: facet.slice(0, i), value: facet.slice(i + 1) }
}

export function isValidationDimension(map: FacetMap, dimension: string): boolean {
  return map.dimensions.find((d) => d.id === dimension)?.kind === 'validation'
}

export interface ApplyOptions extends ComputeOptions {
  /** Duration in minutes, from `classes.durationMinutes`. Passed in so the two
   *  modules cannot disagree about how long an event is. */
  durationMinutes?: number | null
}

export function applyFacets(
  event: ScheduleEvent,
  map: FacetMap,
  options: ApplyOptions = {}
): EventFacets {
  const facets: Record<string, string[]> = {}
  const unmappedTags: string[] = []
  const hints: { dimension: string; value: string; tag: string }[] = []

  let players: NumericRange | null = null
  let age: NumericRange | null = null

  for (const tag of event.subtypes ?? []) {
    const mapped = map.tags[tag]
    if (!mapped || mapped.length === 0) {
      if (!unmappedTags.includes(tag)) unmappedTags.push(tag)
      continue
    }

    for (const facet of mapped) {
      const parsed = splitFacet(facet)
      if (!parsed) continue
      if (isValidationDimension(map, parsed.dimension)) {
        hints.push({ ...parsed, tag })
        continue
      }
      const bucket = (facets[parsed.dimension] ??= [])
      if (!bucket.includes(parsed.value)) bucket.push(parsed.value)
    }

    const range = map.ranges[tag]
    if (range?.players) players = widen(players, range.players)
    if (range?.age) age = narrowAge(age, range.age)
  }

  const durationMinutes = options.durationMinutes ?? null
  const computed: ComputedDimensions = {
    day: computeDay(event, options),
    timeBand: computeTimeBand(event),
    durationBand: computeDurationBand(durationMinutes),
    building: computeBuilding(event)
  }

  // The audience band is recomputed from the parsed floor rather than read from
  // the table, so the numeric answer and the band answer can never disagree.
  const audienceBand = age ? audienceBandForMinAge(age.min) : null
  if (audienceBand) facets['audience'] = [audienceBand]
  if (players) facets['players'] = ['supported']

  return {
    uid: event.uid,
    facets,
    computed,
    players,
    age,
    audienceBand,
    unmappedTags,
    validationMismatches: checkHints(hints, computed, durationMinutes)
  }
}

/** Several player-count tags on one event describe alternative configurations,
 *  so the supported range is their union. */
function widen(current: NumericRange | null, next: NumericRange): NumericRange {
  if (!current) return { ...next }
  return {
    min: Math.min(current.min, next.min),
    max: current.max === null || next.max === null ? null : Math.max(current.max, next.max)
  }
}

/** Age tags are gates, so several of them intersect: the strictest floor wins. */
function narrowAge(current: NumericRange | null, next: NumericRange): NumericRange {
  if (!current) return { ...next }
  return {
    min: Math.max(current.min, next.min),
    max: current.max === null ? next.max : next.max === null ? current.max : Math.min(current.max, next.max)
  }
}

function checkHints(
  hints: { dimension: string; value: string; tag: string }[],
  computed: ComputedDimensions,
  durationMinutes: number | null
): ValidationMismatch[] {
  const out: ValidationMismatch[] = []
  for (const hint of hints) {
    if (hint.dimension === 'venue_hint' && hint.value !== computed.building) {
      out.push({
        dimension: hint.dimension,
        tag: hint.tag,
        claimed: hint.value,
        computed: computed.building
      })
    }
    if (hint.dimension === 'duration_hint' && durationMinutes !== null) {
      const claimed = Number(hint.value)
      if (Number.isFinite(claimed) && claimed !== durationMinutes) {
        out.push({
          dimension: hint.dimension,
          tag: hint.tag,
          claimed: String(claimed),
          computed: String(durationMinutes)
        })
      }
    }
  }
  return out
}

// ---------- queries ----------

/**
 * "Does this work for a group of N?" Events with no player-count tag answer no:
 * this is a games-shelf question, and a panel is not a wrong-sized game, it is
 * not a game.
 */
export function supportsPlayers(facets: EventFacets, n: number): boolean {
  const range = facets.players
  if (!range) return false
  return n >= range.min && (range.max === null || n <= range.max)
}

/** "Can I bring someone aged N?" Untagged events answer yes — no stated floor. */
export function supportsAge(facets: EventFacets, n: number): boolean {
  const range = facets.age
  if (!range) return true
  return n >= range.min && (range.max === null || n <= range.max)
}

// ---------- the review bucket ----------

export interface ReviewBucketRow {
  tag: string
  count: number
  /** A few UIDs so a curator can look at what the tag is actually used for. */
  exampleUids: string[]
}

/**
 * Corpus-level tally of tags the table does not cover. This is the honest half
 * of the facet model: an unmapped tag is a visible gap with a count next to it,
 * not a silent drop. In the live corpus it collects exactly the noise — exhibitor
 * and guest names typed into Sched's tag field ("Kate Weddle", "Nant Studios") —
 * which is what a working table looks like.
 */
export function buildReviewBucket(
  events: readonly ScheduleEvent[],
  map: FacetMap,
  exampleLimit = 3
): ReviewBucketRow[] {
  const rows = new Map<string, ReviewBucketRow>()
  for (const event of events) {
    for (const tag of event.subtypes ?? []) {
      if (map.tags[tag]?.length) continue
      const row = rows.get(tag) ?? { tag, count: 0, exampleUids: [] }
      row.count++
      if (row.exampleUids.length < exampleLimit) row.exampleUids.push(event.uid)
      rows.set(tag, row)
    }
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}
