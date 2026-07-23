import { mkdirSync } from 'node:fs'
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JsonStore } from '../shared/storage/jsonStore'

/** Node's durable-json adapter. Schema decisions stay in shared slot logic. */
export class NodeJsonStore implements JsonStore {
  private readonly writes = new Map<string, Promise<void>>()
  private readonly ready: Promise<void>

  constructor(private readonly dir: string) {
    // Preserve the desktop stores' long-standing constructor guarantee: once
    // construction returns, callers may safely address the directory. Recovery
    // remains async and every public operation awaits it before touching data.
    mkdirSync(dir, { recursive: true })
    this.ready = this.recoverOrphans()
  }

  async read(name: string): Promise<unknown | null> {
    validateName(name)
    await this.ready
    await (this.writes.get(name) ?? Promise.resolve()).catch(() => {})
    return this.recoverName(name)
  }

  replace(name: string, value: unknown): Promise<void> {
    validateName(name)
    let bytes: string
    try {
      bytes = stringify(value)
    } catch (error) {
      return Promise.reject(error)
    }
    const previous = this.writes.get(name) ?? this.ready
    const operation = previous.catch(() => {}).then(() => this.replaceBytes(name, bytes))
    this.writes.set(name, operation)
    void operation.finally(() => {
      if (this.writes.get(name) === operation) this.writes.delete(name)
    }).catch(() => {})
    return operation
  }

  private async replaceBytes(name: string, bytes: string): Promise<void> {
    const target = join(this.dir, name)
    const temp = `${target}.${process.pid}.tmp`
    try {
      await writeFile(temp, bytes, { encoding: 'utf8', flag: 'wx' })
      // Same-directory rename is atomic on Node's supported desktop filesystems.
      // If it rejects, target has not been replaced and remains readable.
      await rename(temp, target)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      throw error
    }
  }

  /** Startup recovery precedes orphan cleanup, so a sole good temp is promoted. */
  private async recoverOrphans(): Promise<void> {
    const entries = await readdir(this.dir).catch(() => [])
    const names = new Set<string>()
    for (const entry of entries) {
      const match = /^(.*\.json)\.[^.]+\.tmp$/.exec(entry)
      if (match?.[1]) names.add(match[1])
    }
    for (const name of names) await this.recoverName(name)
  }

  private async recoverName(name: string): Promise<unknown | null> {
    const target = join(this.dir, name)
    const targetValue = await parseFile(target)
    const candidates = await this.tempCandidates(name)

    if (targetValue.ok) {
      await cleanup(candidates.map((candidate) => candidate.path))
      return targetValue.value
    }

    for (const candidate of candidates) {
      const parsed = await parseFile(candidate.path)
      if (!parsed.ok) continue
      try {
        // A corrupt target has no recoverable previous generation. Removing it
        // lets the known-good temp become the sole durable target portably.
        await rm(target, { force: true })
        await rename(candidate.path, target)
        await cleanup(candidates.map((item) => item.path))
        return parsed.value
      } catch {
        // Preserve this parseable temp for a later recovery attempt.
        return null
      }
    }

    await cleanup(candidates.map((candidate) => candidate.path))
    return null
  }

  private async tempCandidates(name: string): Promise<Array<{ path: string; modified: number }>> {
    const prefix = `${name}.`
    const entries = await readdir(this.dir).catch(() => [])
    const paths = entries
      .filter((entry) => entry.startsWith(prefix) && entry.endsWith('.tmp'))
      .map((entry) => join(this.dir, entry))
    const candidates = await Promise.all(
      paths.map(async (path) => ({ path, modified: (await stat(path).catch(() => null))?.mtimeMs ?? 0 })),
    )
    return candidates.sort((a, b) => b.modified - a.modified || b.path.localeCompare(a.path))
  }
}

function validateName(name: string): void {
  if (name.length === 0 || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new Error(`Invalid JSON artifact name: ${name}`)
  }
}

function stringify(value: unknown): string {
  const bytes = JSON.stringify(value)
  if (bytes === undefined) throw new TypeError('JsonStore cannot persist undefined')
  return bytes
}

async function parseFile(path: string): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: JSON.parse(await readFile(path, 'utf8')) }
  } catch {
    return { ok: false }
  }
}

async function cleanup(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => {})))
}
