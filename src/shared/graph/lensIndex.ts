/**
 * The per-lens entity index: entity -> uids, and its inverse.
 *
 * Built once per dataset per lens and then read-only. Everything the map is
 * built from — hubs, links, degrees — is a lookup in one of these two maps,
 * which is what keeps lens switching instant on a corpus of 3,474 events.
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

/** Every lens at once. The map holds all four so switching costs a lookup, and
 *  so the all-fringe state can count the hubs a lens *would* draw over the
 *  current scope without rebuilding anything. */
export function buildLensIndexes(
  records: readonly GraphRecord[],
  lenses: readonly LensId[]
): Map<LensId, LensIndex> {
  return new Map(lenses.map((lens) => [lens, buildLensIndex(records, lens)]))
}
