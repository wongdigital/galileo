/**
 * Turning an event into the entities a lens joins on.
 *
 * ## The `other` franchise bucket
 *
 * The compiler constrains `canonical` to a seeded enum with `other` as the
 * escape value. `other` is a *label for "unseeded"*, not an identity — two events
 * both bucketed `other` share nothing, and joining on the literal string would
 * wire Konosuba to Boss Monster.
 *
 * But the surface text under those entries is an identity, and throwing it away
 * costs the lens most of the corpus. Measured against the live index: 2,281 of
 * 4,235 franchise mentions fall in `other`, and canonical-only joining drops the
 * anime track from 85% franchise coverage to 25% and games from 41% to 29% —
 * exactly the half of the corpus the IP lens is supposed to carry. Joining the
 * `other` entries on their *normalized surface text* recovers 1,146 events with
 * a real IP edge (Inuyasha, Konosuba, Boss Monster, Codenames), because the
 * extractor spells a franchise the same way each time it appears.
 *
 * So: never join on `other`; join on what `other` was hiding. Those entities are
 * marked `provisional` so the UI can say where the identity came from, and so a
 * later `aliases.json` pass promoting them to canonicals changes the label
 * rather than the behaviour.
 *
 * ## Which facet dimension
 *
 * Genre only. The plan leaves the facets lens "tuned to avoid degenerate
 * density", and the other curated dimensions are the ones that make everything
 * adjacent to everything: `format:panel` covers most of Programs and says
 * nothing about what a panel is about. Genre has 26 values over 1,001 events,
 * which is coarse but meaningful — and the clique bounding in `ego.ts` handles
 * the coarseness rather than the entity model pretending it is not there.
 */

import type { GraphEntity, GraphRecord, LensId } from './types'

/**
 * Fold away everything that varies between two spellings of the same name
 * without changing who or what it is. Same conservative shape as
 * `normalizeOfferingTitle` — anything stripped here is a merge nobody
 * downstream can undo.
 */
export function normalizeEntityText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Two characters is not a name or a franchise, it is a fragment of one. The
 * floor keeps initials and stray extraction noise ("A", "TV") from becoming
 * hubs that join hundreds of unrelated events.
 */
const MIN_ENTITY_LENGTH = 3

/** Mechanical title case for machine ids. The renderer overrides the handful
 *  this mangles (`lgbtqia`, `ccg-tcg`) through its own label table. */
export function humanizeId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function pushUnique(into: GraphEntity[], entity: GraphEntity): void {
  if (!into.some((e) => e.id === entity.id)) into.push(entity)
}

function peopleEntities(record: GraphRecord): GraphEntity[] {
  const out: GraphEntity[] = []
  for (const person of record.people ?? []) {
    const key = normalizeEntityText(person.name ?? '')
    if (key.length < MIN_ENTITY_LENGTH) continue
    pushUnique(out, { id: `person:${key}`, label: person.name.trim(), lens: 'people' })
  }
  return out
}

function ipEntities(record: GraphRecord): GraphEntity[] {
  const out: GraphEntity[] = []
  for (const franchise of record.franchises ?? []) {
    const canonical = (franchise.canonical ?? '').trim()
    if (canonical && canonical !== 'other') {
      pushUnique(out, { id: `ip:${canonical}`, label: humanizeId(canonical), lens: 'ip' })
      continue
    }
    const key = normalizeEntityText(franchise.surface_text ?? '')
    if (key.length < MIN_ENTITY_LENGTH) continue
    pushUnique(out, {
      id: `ip~:${key}`,
      label: franchise.surface_text.trim(),
      lens: 'ip',
      provisional: true,
    })
  }
  return out
}

function facetEntities(record: GraphRecord): GraphEntity[] {
  const out: GraphEntity[] = []
  for (const value of record.facets?.genre ?? []) {
    if (!value) continue
    pushUnique(out, { id: `genre:${value}`, label: humanizeId(value), lens: 'facets' })
  }
  return out
}

export function entitiesFor(record: GraphRecord, lens: LensId): GraphEntity[] {
  switch (lens) {
    case 'people':
      return peopleEntities(record)
    case 'ip':
      return ipEntities(record)
    case 'facets':
      return facetEntities(record)
  }
}
