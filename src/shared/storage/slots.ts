import { CHANGE_LOG_SCHEMA_VERSION, emptyChangeLog } from '../schedule/diff'
import { migrateSnapshot } from '../schedule/guard'
import type { Snapshot, UnseenChangeLog } from '../schedule/types'
import { STARS_SCHEMA_VERSION, normalizeStars, type StarFile, type StarRecord } from '../stars'
import type { JsonStore } from './jsonStore'

export type SnapshotSlot = 'last-known-good' | 'last-fetched'

const CHANGE_LOG_NAME = 'unseen-changes.json'
const STAR_PRIMARY_NAME = 'stars.json'
const STAR_BACKUP_NAME = 'stars.backup.json'
const SETTINGS_NAME = 'settings.json'

/** Schema-aware schedule artifacts over platform-neutral durable JSON. */
export class SnapshotSlots {
  constructor(private readonly store: JsonStore) {}

  async readSnapshot(slot: SnapshotSlot): Promise<Snapshot | null> {
    // Unknown snapshot schemas are deliberately discarded: schedule data is
    // re-fetchable, and handing stale-shaped data downstream is unsafe.
    return migrateSnapshot(await this.store.read(`${slot}.json`))
  }

  async writeSnapshot(slot: SnapshotSlot, snapshot: Snapshot): Promise<void> {
    await this.store.replace(`${slot}.json`, snapshot)
  }

  async readChangeLog(): Promise<UnseenChangeLog> {
    const raw = await this.store.read(CHANGE_LOG_NAME)
    if (!raw || typeof raw !== 'object') return emptyChangeLog()
    const candidate = raw as Partial<UnseenChangeLog>
    if (
      candidate.schemaVersion !== CHANGE_LOG_SCHEMA_VERSION ||
      !candidate.entries ||
      typeof candidate.entries !== 'object' ||
      Array.isArray(candidate.entries)
    ) {
      // The log is advisory. Invalid data loses badges, never schedule data.
      return emptyChangeLog()
    }
    return {
      schemaVersion: candidate.schemaVersion,
      entries: candidate.entries as UnseenChangeLog['entries'],
    }
  }

  async writeChangeLog(log: UnseenChangeLog): Promise<void> {
    await this.store.replace(CHANGE_LOG_NAME, log)
  }
}

/** Two-generation, echo-back persistence for irrecoverable user stars. */
export class StarSlots {
  constructor(private readonly store: JsonStore) {}

  async read(): Promise<StarRecord[]> {
    const primary = await this.store.read(STAR_PRIMARY_NAME)
    if (primary !== null) return starsFromGeneration(primary)
    const backup = await this.store.read(STAR_BACKUP_NAME)
    return backup === null ? [] : starsFromGeneration(backup)
  }

  /** Returns durable truth after the attempt, never an optimistic request. */
  async write(stars: readonly StarRecord[]): Promise<StarRecord[]> {
    const file: StarFile = { schemaVersion: STARS_SCHEMA_VERSION, stars: [...stars] }
    try {
      const previous = await this.store.read(STAR_PRIMARY_NAME)
      if (previous !== null) await this.store.replace(STAR_BACKUP_NAME, previous)
      await this.store.replace(STAR_PRIMARY_NAME, file)
      return file.stars
    } catch (error) {
      console.warn('[stars] write failed, echoing back last persisted list:', error)
      return this.read()
    }
  }
}

/** Small named values shared by renderer state across launches. The whole
 * artifact is serialized through one queue so concurrent setting writes do
 * not overwrite one another with stale read-modify-write snapshots. */
export class SettingsSlots {
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly store: JsonStore) {}

  async get(name: string): Promise<unknown | null> {
    validateSettingName(name)
    await this.writes.catch(() => {})
    const values = asSettings(await this.store.read(SETTINGS_NAME))
    return Object.hasOwn(values, name) ? values[name] : null
  }

  set(name: string, value: unknown): Promise<void> {
    validateSettingName(name)
    const operation = this.writes.catch(() => {}).then(async () => {
      const values = asSettings(await this.store.read(SETTINGS_NAME))
      await this.store.replace(SETTINGS_NAME, { ...values, [name]: value })
    })
    this.writes = operation
    return operation
  }
}

function starsFromGeneration(raw: unknown): StarRecord[] {
  // Star schemas are deliberately tolerant. A version bump must not discard
  // a user's irrecoverable list; normalize the scalar records we understand.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return normalizeStars((raw as Partial<StarFile>).stars ?? raw)
  }
  return normalizeStars(raw)
}

function validateSettingName(name: string): void {
  if (!/^[a-z][a-z0-9._-]{0,63}$/i.test(name)) throw new Error(`Invalid settings name: ${name}`)
}

function asSettings(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}
