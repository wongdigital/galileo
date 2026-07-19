/**
 * Persistence for stars, under Electron's userData directory.
 *
 * Same shape as the snapshot store next door: injected base directory, atomic
 * temp-file-plus-rename writes, no `electron` import so it can be tested
 * without booting an app.
 *
 * The one behaviour worth reading carefully is `write`. It returns what is
 * actually on disk afterwards — including when the write failed, in which case
 * it returns the *previous* contents. The renderer adopts whatever comes back,
 * so a failed write shows up immediately as the star popping back off rather
 * than as a star that looked fine all weekend and was gone after a restart.
 * That is the whole echo-back contract (R11).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { STARS_SCHEMA_VERSION, normalizeStars, type StarFile, type StarRecord } from '../shared/stars'

const FILE_NAME = 'stars.json'

export class StarStore {
  private readonly dir: string

  constructor(baseDir: string) {
    this.dir = join(baseDir, 'schedule')
    mkdirSync(this.dir, { recursive: true })
  }

  read(): StarRecord[] {
    const raw = this.readJson() as Partial<StarFile> | null
    if (!raw) return []
    // An unrecognized schemaVersion is read as an unversioned array rather than
    // discarded: the record shape is four scalar fields, and normalizeStars
    // already tolerates every one of them being missing. Throwing away a user's
    // starred list over a version bump would be the worst possible migration.
    return normalizeStars(raw.stars ?? raw)
  }

  /** Returns the on-disk truth after the attempt — never the requested list. */
  write(stars: readonly StarRecord[]): StarRecord[] {
    const file: StarFile = { schemaVersion: STARS_SCHEMA_VERSION, stars: [...stars] }
    try {
      this.writeJson(file)
      return file.stars
    } catch (error) {
      console.warn('[stars] write failed, echoing back last persisted list:', error)
      return this.read()
    }
  }

  private readJson(): unknown {
    try {
      return JSON.parse(readFileSync(join(this.dir, FILE_NAME), 'utf8'))
    } catch {
      // Absent and corrupt read the same way: nothing usable here.
      return null
    }
  }

  private writeJson(value: unknown): void {
    const target = join(this.dir, FILE_NAME)
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

/**
 * Minimal `ipcMain` surface, typed structurally so this module stays free of
 * the `electron` import that would drag the whole runtime into the test suite.
 */
export interface StarIpcMain {
  // `unknown[]`, not `never[]`: the rest parameter is contravariant, so a
  // `never[]` signature is one that Electron's own IpcMain cannot satisfy.
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

/**
 * Wire the two star channels the preload already exposes. Called from
 * `main/index.ts` once the app is ready and a userData path exists.
 *
 * `stars:set` normalizes before persisting — the payload crossed a context
 * bridge, so it is untrusted input no matter how well-behaved the renderer is.
 */
export function registerStarIpc(ipcMain: StarIpcMain, store: StarStore): void {
  ipcMain.handle('stars:get', () => store.read())
  ipcMain.handle('stars:set', (_event, ...args: unknown[]) =>
    store.write(normalizeStars(args[0]))
  )
}
