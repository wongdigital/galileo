/**
 * The per-lens entity index: entity -> uids, and its inverse.
 *
 * Built once per dataset per lens and then read-only. Everything the graph does
 * — expansion, edge computation, the per-lens degree hint — is a lookup in one
 * of these two maps, which is what keeps lens switching instant on a corpus of
 * 3,474 events.
 */

import { entitiesFor } from './entities'
import type { GraphEntity, GraphRecord, LensId, LensIndex } from './types'

export function buildLensIndex(records: readonly GraphRecord[], lens: LensId): LensIndex {
  const uidsByEntity = new Map<string, string[]>()
  const entitiesByUid = new Map<string, string[]>()
  const entities = new Map<string, GraphEntity>()

  for (const record of records) {
    const found = entitiesFor(record, lens)
    if (found.length === 0) continue

    const ids: string[] = []
    for (const entity of found) {
      // First spelling wins as the label, so a display name does not flicker
      // between two events that capitalize a franchise differently.
      if (!entities.has(entity.id)) entities.set(entity.id, entity)
      ids.push(entity.id)

      const bucket = uidsByEntity.get(entity.id)
      if (bucket) bucket.push(record.uid)
      else uidsByEntity.set(entity.id, [record.uid])
    }
    entitiesByUid.set(record.uid, ids)
  }

  return { lens, uidsByEntity, entitiesByUid, entities }
}

/** Every lens at once. The graph holds all four so switching costs a lookup,
 *  and so the zero-edge escape hatch can quote counts for the lenses the user
 *  is *not* currently looking at. */
export function buildLensIndexes(
  records: readonly GraphRecord[],
  lenses: readonly LensId[]
): Map<LensId, LensIndex> {
  return new Map(lenses.map((lens) => [lens, buildLensIndex(records, lens)]))
}

/**
 * How many distinct events this one connects to under a lens, ignoring every
 * cap. This is the number behind "no IP connections — People has 4", so it has
 * to be the honest total rather than what the current view happens to draw.
 */
export function degreeFor(index: LensIndex, uid: string): number {
  const neighbours = new Set<string>()
  for (const entityId of index.entitiesByUid.get(uid) ?? []) {
    for (const other of index.uidsByEntity.get(entityId) ?? []) {
      if (other !== uid) neighbours.add(other)
    }
  }
  return neighbours.size
}

export function degreesByLens(
  indexes: ReadonlyMap<LensId, LensIndex>,
  uid: string
): { lens: LensId; degree: number }[] {
  return [...indexes.entries()].map(([lens, index]) => ({ lens, degree: degreeFor(index, uid) }))
}
