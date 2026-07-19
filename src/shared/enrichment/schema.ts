/**
 * The enrichment index envelope, as `scripts/enrich.mjs` actually writes it.
 *
 * These types describe a file on disk that already exists and is committed, so
 * they are a *description*, not a design. Field names stay snake_case to match
 * the JSON verbatim — renaming them here would mean a translation layer whose
 * only job is to hide the fact that the two drifted.
 *
 * The index carries only what an LLM had to read prose to find: people and
 * franchises. Classes, offerings, and facets are deterministic and live in the
 * sibling modules — they need no compile step and never go stale.
 */

export const ENRICHMENT_SCHEMA_VERSION = 1

/** Roles the extraction prompt constrains to. `other` is the escape hatch. */
export type PersonRole =
  | 'panelist'
  | 'moderator'
  | 'creator'
  | 'writer'
  | 'artist'
  | 'actor'
  | 'host'
  | 'other'

/**
 * Per-entry outcome. Anything other than `ok` means the batch item did not
 * produce usable output; the entry still exists so a rerun can target it, and
 * so "we tried and failed" stays distinguishable from "we never tried".
 */
export type EntryStatus = 'ok' | 'errored' | 'expired' | 'canceled' | 'unparseable'

export interface ExtractedPerson {
  /** Verbatim substring of the source text. Validated at compile time. */
  name: string
  role: PersonRole
}

export interface ExtractedFranchise {
  /** Verbatim substring of the source text. */
  surface_text: string
  /** Seed-enum id, or `other` when the property is real but unseeded. */
  canonical: string
}

export interface EnrichmentEntry {
  status: EntryStatus
  /**
   * sha256 of the description at compile time, first 16 hex chars. At join time
   * a live description that hashes differently means the prose moved under the
   * extraction, so people/franchises are no longer trustworthy for this event.
   * Absent on non-`ok` entries, which had no description to hash successfully.
   */
  description_hash?: string
  people: ExtractedPerson[]
  franchises: ExtractedFranchise[]
}

export interface EnrichmentProvenance {
  model: string
  batch_id: string
  franchise_seed_version: number
  system_prompt_sha: string
  event_count: number
}

export interface EnrichmentIndex {
  schema_version: number
  generated_at: string
  provenance: EnrichmentProvenance
  /**
   * UID -> entry. Absence of a UID means "not yet enriched"; a present entry
   * with empty arrays means "processed, found nothing". The app must never
   * collapse those two into one state — the first is a gap to fill, the second
   * is a finished answer.
   */
  entries: Record<string, EnrichmentEntry>
}

// ---------- validation ----------

export type ValidationResult =
  | { ok: true; index: EnrichmentIndex; warnings: string[] }
  | { ok: false; errors: string[] }

const ROLES = new Set<string>([
  'panelist',
  'moderator',
  'creator',
  'writer',
  'artist',
  'actor',
  'host',
  'other'
])

const STATUSES = new Set<string>(['ok', 'errored', 'expired', 'canceled', 'unparseable'])

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Structural validation of a parsed index. Cheap enough to run on every load:
 * the index is a committed file that a maintainer may hand-edit between
 * compiles, and a malformed entry should surface as a named error rather than
 * as an undefined halfway through the join.
 *
 * Entry-level problems are warnings, not errors — one bad entry should degrade
 * one event, not refuse the whole 3,472-event index.
 */
export function validateEnrichmentIndex(value: unknown): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!isRecord(value)) return { ok: false, errors: ['index is not an object'] }

  if (typeof value.schema_version !== 'number') errors.push('schema_version missing or not a number')
  else if (value.schema_version !== ENRICHMENT_SCHEMA_VERSION) {
    warnings.push(
      `schema_version ${value.schema_version} != expected ${ENRICHMENT_SCHEMA_VERSION}`
    )
  }
  if (typeof value.generated_at !== 'string') errors.push('generated_at missing or not a string')
  if (!isRecord(value.provenance)) errors.push('provenance missing or not an object')
  if (!isRecord(value.entries)) errors.push('entries missing or not an object')

  if (errors.length) return { ok: false, errors }

  const entries = value.entries as Record<string, unknown>
  for (const [uid, raw] of Object.entries(entries)) {
    if (!isRecord(raw)) {
      warnings.push(`entry ${uid}: not an object`)
      continue
    }
    if (typeof raw.status !== 'string' || !STATUSES.has(raw.status)) {
      warnings.push(`entry ${uid}: unknown status ${JSON.stringify(raw.status)}`)
    }
    if (raw.description_hash !== undefined && typeof raw.description_hash !== 'string') {
      warnings.push(`entry ${uid}: description_hash is not a string`)
    }
    if (!Array.isArray(raw.people)) warnings.push(`entry ${uid}: people is not an array`)
    else {
      for (const p of raw.people) {
        if (!isRecord(p) || typeof p.name !== 'string') {
          warnings.push(`entry ${uid}: person missing name`)
        } else if (typeof p.role === 'string' && !ROLES.has(p.role)) {
          warnings.push(`entry ${uid}: unknown role ${p.role}`)
        }
      }
    }
    if (!Array.isArray(raw.franchises)) warnings.push(`entry ${uid}: franchises is not an array`)
    else {
      for (const f of raw.franchises) {
        if (!isRecord(f) || typeof f.surface_text !== 'string') {
          warnings.push(`entry ${uid}: franchise missing surface_text`)
        }
      }
    }
  }

  return { ok: true, index: value as unknown as EnrichmentIndex, warnings }
}

/** Entries the index knows about but could not extract from. Feeds a rerun. */
export function failedUids(index: EnrichmentIndex): string[] {
  return Object.entries(index.entries)
    .filter(([, e]) => e.status !== 'ok')
    .map(([uid]) => uid)
}
