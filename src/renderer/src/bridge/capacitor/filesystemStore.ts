import type { JsonStore } from '@shared/storage/jsonStore'

export type FilesystemDirectory = 'DATA' | 'LIBRARY_NO_CLOUD'

export interface FilesystemPlugin {
  mkdir(options: {
    path: string
    directory: FilesystemDirectory
    recursive?: boolean
  }): Promise<void>
  readdir(options: {
    path: string
    directory: FilesystemDirectory
  }): Promise<{ files: Array<{ name: string; type: 'file' | 'directory' }> }>
  readFile(options: {
    path: string
    directory: FilesystemDirectory
    encoding: 'utf8'
  }): Promise<{ data: string | Blob }>
  writeFile(options: {
    path: string
    data: string
    directory: FilesystemDirectory
    encoding: 'utf8'
    recursive?: boolean
  }): Promise<unknown>
  deleteFile(options: { path: string; directory: FilesystemDirectory }): Promise<void>
  rename(options: {
    from: string
    to: string
    directory: FilesystemDirectory
    toDirectory?: FilesystemDirectory
  }): Promise<void>
}

const ROOT = 'galileo'
const TEMP_SUFFIX = '.tmp'
const DIRECTORIES: readonly FilesystemDirectory[] = ['DATA', 'LIBRARY_NO_CLOUD']
const NO_CLOUD_ARTIFACTS = new Set([
  'last-known-good.json',
  'last-fetched.json',
  'unseen-changes.json',
])

/**
 * Durable Capacitor Filesystem implementation of the portable JsonStore.
 *
 * iOS replacement is deliberately modeled as write-temp, delete-target, move.
 * That is not atomic, so reads recover a valid temp after the target-absent
 * kill window before any orphan sweep is allowed to remove it.
 */
export class CapacitorFilesystemStore implements JsonStore {
  private readonly writes = new Map<string, Promise<void>>()
  private initialization: Promise<void> | undefined

  constructor(private readonly filesystem: FilesystemPlugin) {}

  init(): Promise<void> {
    this.initialization ??= this.initialize()
    return this.initialization
  }

  async read(name: string): Promise<unknown | null> {
    validateArtifactName(name)
    await this.init()
    await (this.writes.get(name) ?? Promise.resolve()).catch(() => {})
    return this.readRecovering(name)
  }

  replace(name: string, value: unknown): Promise<void> {
    validateArtifactName(name)
    let data: string
    try {
      data = stringify(value)
    } catch (error) {
      return Promise.reject(error)
    }

    const prior = this.writes.get(name) ?? Promise.resolve()
    const operation = prior.catch(() => {}).then(async () => {
      await this.init()
      const directory = artifactDirectory(name)
      const target = artifactPath(name)
      const temp = `${target}${TEMP_SUFFIX}`
      await this.filesystem.writeFile({
        path: temp,
        data,
        directory,
        encoding: 'utf8',
        recursive: true,
      })
      await this.deleteIfPresent(target, directory)
      await this.filesystem.rename({
        from: temp,
        to: target,
        directory,
        toDirectory: directory,
      })
    })

    this.writes.set(name, operation)
    void operation
      .finally(() => {
        if (this.writes.get(name) === operation) this.writes.delete(name)
      })
      .catch(() => {})
    return operation
  }

  private async initialize(): Promise<void> {
    for (const directory of DIRECTORIES) {
      try {
        await this.filesystem.mkdir({ path: ROOT, directory, recursive: true })
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
      }
    }

    const temps: Array<{ name: string; directory: FilesystemDirectory }> = []
    for (const directory of DIRECTORIES) {
      const listed = await this.filesystem.readdir({ path: ROOT, directory })
      for (const file of listed.files) {
        if (file.type === 'file' && file.name.endsWith(TEMP_SUFFIX)) {
          temps.push({ name: file.name.slice(0, -TEMP_SUFFIX.length), directory })
        }
      }
    }

    // Pass one: recover every parseable candidate whose target is not valid.
    // Pass two below may sweep only after all recoveries had their chance.
    const swept = new Set<string>()
    for (const candidate of temps) {
      const expectedDirectory = artifactDirectory(candidate.name)
      const id = `${candidate.directory}:${candidate.name}`
      if (candidate.directory !== expectedDirectory || !isValidArtifactName(candidate.name)) {
        continue
      }
      const target = artifactPath(candidate.name)
      const temp = `${target}${TEMP_SUFFIX}`
      const current = parse(await this.readText(target, candidate.directory))
      const pending = parse(await this.readText(temp, candidate.directory))
      if (!current.ok && pending.ok) {
        await this.deleteIfPresent(target, candidate.directory)
        await this.filesystem.rename({
          from: temp,
          to: target,
          directory: candidate.directory,
          toDirectory: candidate.directory,
        })
        swept.add(id)
      }
    }

    for (const candidate of temps) {
      const id = `${candidate.directory}:${candidate.name}`
      if (swept.has(id)) continue
      await this.deleteIfPresent(
        `${artifactPath(candidate.name)}${TEMP_SUFFIX}`,
        candidate.directory,
      )
    }
  }

  private async readRecovering(name: string): Promise<unknown | null> {
    const directory = artifactDirectory(name)
    const target = artifactPath(name)
    const temp = `${target}${TEMP_SUFFIX}`
    const current = parse(await this.readText(target, directory))
    if (current.ok) {
      await this.deleteIfPresent(temp, directory)
      return current.value
    }

    const pending = parse(await this.readText(temp, directory))
    if (!pending.ok) {
      await this.deleteIfPresent(temp, directory)
      return null
    }

    await this.deleteIfPresent(target, directory)
    await this.filesystem.rename({
      from: temp,
      to: target,
      directory,
      toDirectory: directory,
    })
    return pending.value
  }

  private async readText(
    path: string,
    directory: FilesystemDirectory,
  ): Promise<string | null> {
    try {
      const result = await this.filesystem.readFile({ path, directory, encoding: 'utf8' })
      return typeof result.data === 'string' ? result.data : null
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  private async deleteIfPresent(
    path: string,
    directory: FilesystemDirectory,
  ): Promise<void> {
    try {
      await this.filesystem.deleteFile({ path, directory })
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }
}

function artifactDirectory(name: string): FilesystemDirectory {
  return NO_CLOUD_ARTIFACTS.has(name) ? 'LIBRARY_NO_CLOUD' : 'DATA'
}

function artifactPath(name: string): string {
  return `${ROOT}/${name}`
}

function isValidArtifactName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\')
  )
}

function validateArtifactName(name: string): void {
  if (!isValidArtifactName(name)) throw new Error(`Invalid JSON artifact name: ${name}`)
}

function stringify(value: unknown): string {
  const data = JSON.stringify(value)
  if (data === undefined) throw new TypeError('JsonStore cannot persist undefined')
  return data
}

function parse(value: string | null): { ok: true; value: unknown } | { ok: false } {
  if (value === null) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch {
    return { ok: false }
  }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  return String((error as { code?: unknown }).code ?? '')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isNotFound(error: unknown): boolean {
  return (
    errorCode(error) === 'ENOENT' ||
    errorCode(error) === 'OS-PLUG-FILE-0008' ||
    /does not exist|not found/i.test(errorMessage(error))
  )
}

function isAlreadyExists(error: unknown): boolean {
  return (
    errorCode(error) === 'OS-PLUG-FILE-0010' ||
    /already exists/i.test(errorMessage(error))
  )
}
