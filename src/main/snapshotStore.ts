/** Electron's schedule-slot composition over the shared durable JSON contract. */
import { join } from 'node:path'
import { SnapshotSlots } from '../shared/storage/slots'
import type { JsonStore } from '../shared/storage/jsonStore'
import { NodeJsonStore } from './nodeJsonStore'

export class SnapshotStore extends SnapshotSlots {
  constructor(baseDirOrStore: string | JsonStore) {
    super(
      typeof baseDirOrStore === 'string'
        ? new NodeJsonStore(join(baseDirOrStore, 'schedule'))
        : baseDirOrStore,
    )
  }
}
