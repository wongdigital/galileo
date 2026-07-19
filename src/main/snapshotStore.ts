/**
 * Persistence for the schedule data layer, under Electron's userData directory.
 *
 * Two snapshot slots. `last-known-good` is the baseline the drift guard
 * compares against and the data the app falls back to; `last-fetched` is
 * whatever came back most recently, guard verdict notwithstanding, kept so a
 * rejected fetch can be inspected instead of vanishing.
 *
 * Every write is temp-file-plus-rename. The failure this prevents is the one
 * that matters: losing power mid-write the night before the con and finding a
 * truncated JSON file where the schedule used to be.
 *
 * No `electron` import — the base directory is injected, which is also what
 * makes this testable without booting an app.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { CHANGE_LOG_SCHEMA_VERSION, emptyChangeLog } from '../shared/schedule/diff'
import { migrateSnapshot } from '../shared/schedule/guard'
import type { Snapshot, UnseenChangeLog } from '../shared/schedule/types'

type Slot = 'last-known-good' | 'last-fetched'

export class SnapshotStore {
  private readonly dir: string

  constructor(baseDir: string) {
    this.dir = join(baseDir, 'schedule')
    mkdirSync(this.dir, { recursive: true })
  }

  readSnapshot(slot: Slot): Snapshot | null {
    // migrateSnapshot is where an unrecognized schemaVersion is discarded on
    // purpose, so the fallback path never hands stale-shaped data downstream.
    return migrateSnapshot(this.readJson(`${slot}.json`))
  }

  writeSnapshot(slot: Slot, snapshot: Snapshot): void {
    this.writeJson(`${slot}.json`, snapshot)
  }

  readChangeLog(): UnseenChangeLog {
    const raw = this.readJson('unseen-changes.json') as Partial<UnseenChangeLog> | null
    if (!raw || raw.schemaVersion !== CHANGE_LOG_SCHEMA_VERSION || typeof raw.entries !== 'object') {
      // Discarding the log loses pending change badges, never schedule data.
      return emptyChangeLog()
    }
    return { schemaVersion: raw.schemaVersion, entries: raw.entries as UnseenChangeLog['entries'] }
  }

  writeChangeLog(log: UnseenChangeLog): void {
    this.writeJson('unseen-changes.json', log)
  }

  private readJson(name: string): unknown {
    try {
      return JSON.parse(readFileSync(join(this.dir, name), 'utf8'))
    } catch {
      // Absent or corrupt reads the same way: there is nothing usable here.
      return null
    }
  }

  private writeJson(name: string, value: unknown): void {
    const target = join(this.dir, name)
    const temp = `${target}.${process.pid}.tmp`
    try {
      writeFileSync(temp, JSON.stringify(value), 'utf8')
      renameSync(temp, target)
    } catch (error) {
      try {
        unlinkSync(temp)
      } catch {
        // Best effort; the failed write is the error worth reporting.
      }
      throw error
    }
  }
}
