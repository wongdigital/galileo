/** Electron's schedule-slot composition over the shared durable JSON contract. */
import { join } from 'node:path'
import { SnapshotSlots } from '../shared/storage/slots'
import { NodeJsonStore } from './nodeJsonStore'

export class SnapshotStore extends SnapshotSlots {
  constructor(baseDir: string) {
    super(new NodeJsonStore(join(baseDir, 'schedule')))
  }
}
