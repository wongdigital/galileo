import { describe, expect, it } from 'vitest'

import {
  CapacitorFilesystemStore,
  type FilesystemDirectory,
  type FilesystemPlugin,
} from '../filesystemStore'

interface Call {
  operation: string
  directory: FilesystemDirectory
  path: string
  to?: string
}

class FakeFilesystem implements FilesystemPlugin {
  readonly calls: Call[] = []
  readonly files = new Map<string, string>()
  failWrite = false
  failRename = false

  key(directory: FilesystemDirectory, path: string): string {
    return `${directory}:${path}`
  }

  seed(directory: FilesystemDirectory, path: string, value: unknown): void {
    this.files.set(this.key(directory, path), JSON.stringify(value))
  }

  async mkdir(options: { path: string; directory: FilesystemDirectory; recursive?: boolean }): Promise<void> {
    this.calls.push({ operation: 'mkdir', directory: options.directory, path: options.path })
  }

  async readdir(options: { path: string; directory: FilesystemDirectory }): Promise<{
    files: Array<{ name: string; type: 'file' | 'directory' }>
  }> {
    this.calls.push({ operation: 'readdir', directory: options.directory, path: options.path })
    const prefix = `${options.directory}:${options.path}/`
    return {
      files: [...this.files.keys()]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ name: value.slice(prefix.length), type: 'file' as const })),
    }
  }

  async readFile(options: {
    path: string
    directory: FilesystemDirectory
    encoding: 'utf8'
  }): Promise<{ data: string }> {
    this.calls.push({ operation: 'readFile', directory: options.directory, path: options.path })
    const value = this.files.get(this.key(options.directory, options.path))
    if (value === undefined) throw Object.assign(new Error('File does not exist'), { code: 'ENOENT' })
    return { data: value }
  }

  async writeFile(options: {
    path: string
    data: string
    directory: FilesystemDirectory
    encoding: 'utf8'
    recursive?: boolean
  }): Promise<void> {
    this.calls.push({ operation: 'writeFile', directory: options.directory, path: options.path })
    if (this.failWrite) throw new Error('write failed')
    this.files.set(this.key(options.directory, options.path), options.data)
  }

  async deleteFile(options: { path: string; directory: FilesystemDirectory }): Promise<void> {
    this.calls.push({ operation: 'deleteFile', directory: options.directory, path: options.path })
    const key = this.key(options.directory, options.path)
    if (!this.files.delete(key)) {
      throw Object.assign(new Error('File does not exist'), { code: 'ENOENT' })
    }
  }

  async rename(options: {
    from: string
    to: string
    directory: FilesystemDirectory
    toDirectory?: FilesystemDirectory
  }): Promise<void> {
    this.calls.push({
      operation: 'rename',
      directory: options.directory,
      path: options.from,
      to: options.to,
    })
    if (this.failRename) throw new Error('simulated kill between delete and move')
    const source = this.key(options.directory, options.from)
    const value = this.files.get(source)
    if (value === undefined) throw Object.assign(new Error('File does not exist'), { code: 'ENOENT' })
    this.files.delete(source)
    this.files.set(this.key(options.toDirectory ?? options.directory, options.to), value)
  }
}

describe('CapacitorFilesystemStore', () => {
  it('writes temp, deletes the target, then moves on the iOS-shaped replace path', async () => {
    const filesystem = new FakeFilesystem()
    const store = new CapacitorFilesystemStore(filesystem)
    filesystem.seed('DATA', 'galileo/stars.json', { before: true })

    await store.replace('stars.json', { after: true })

    const replaceCalls = filesystem.calls
      .filter((call) => ['writeFile', 'deleteFile', 'rename'].includes(call.operation))
      .map((call) => `${call.operation}:${call.path}${call.to ? `>${call.to}` : ''}`)
    expect(replaceCalls).toEqual([
      'writeFile:galileo/stars.json.tmp',
      'deleteFile:galileo/stars.json',
      'rename:galileo/stars.json.tmp>galileo/stars.json',
    ])
    await expect(store.read('stars.json')).resolves.toEqual({ after: true })
  })

  it('recovers a parseable temp after the delete-to-move kill window', async () => {
    const filesystem = new FakeFilesystem()
    const store = new CapacitorFilesystemStore(filesystem)
    filesystem.seed('DATA', 'galileo/stars.json', { before: true })
    filesystem.failRename = true

    await expect(store.replace('stars.json', { after: true })).rejects.toThrow('simulated kill')
    expect(filesystem.files.has(filesystem.key('DATA', 'galileo/stars.json'))).toBe(false)
    expect(filesystem.files.has(filesystem.key('DATA', 'galileo/stars.json.tmp'))).toBe(true)

    filesystem.failRename = false
    await expect(new CapacitorFilesystemStore(filesystem).read('stars.json')).resolves.toEqual({
      after: true,
    })
    expect(filesystem.files.has(filesystem.key('DATA', 'galileo/stars.json.tmp'))).toBe(false)
  })

  it('keeps prior bytes readable when the temp write fails before deletion', async () => {
    const filesystem = new FakeFilesystem()
    const store = new CapacitorFilesystemStore(filesystem)
    filesystem.seed('DATA', 'galileo/settings.json', { before: true })
    filesystem.failWrite = true

    await expect(store.replace('settings.json', { after: true })).rejects.toThrow('write failed')
    filesystem.failWrite = false
    await expect(store.read('settings.json')).resolves.toEqual({ before: true })
  })

  it('returns null for corrupt JSON and separates backed-up user state from re-fetchable data', async () => {
    const filesystem = new FakeFilesystem()
    const store = new CapacitorFilesystemStore(filesystem)
    filesystem.files.set(
      filesystem.key('LIBRARY_NO_CLOUD', 'galileo/last-known-good.json'),
      'not-json',
    )

    await expect(store.read('last-known-good.json')).resolves.toBeNull()
    await store.replace('settings.json', { theme: 'dark' })

    expect(
      filesystem.calls.some(
        (call) => call.path.includes('last-known-good') && call.directory === 'LIBRARY_NO_CLOUD',
      ),
    ).toBe(true)
    expect(
      filesystem.calls.some(
        (call) => call.path.includes('settings') && call.directory === 'DATA',
      ),
    ).toBe(true)
  })

  it('promotes recoverable orphan temps before sweeping invalid ones during init', async () => {
    const filesystem = new FakeFilesystem()
    filesystem.seed('LIBRARY_NO_CLOUD', 'galileo/last-fetched.json.tmp', { recovered: true })
    filesystem.files.set(
      filesystem.key('LIBRARY_NO_CLOUD', 'galileo/unseen-changes.json.tmp'),
      'corrupt',
    )
    const store = new CapacitorFilesystemStore(filesystem)

    await store.init()

    await expect(store.read('last-fetched.json')).resolves.toEqual({ recovered: true })
    expect(
      filesystem.files.has(
        filesystem.key('LIBRARY_NO_CLOUD', 'galileo/unseen-changes.json.tmp'),
      ),
    ).toBe(false)
    const promoteIndex = filesystem.calls.findIndex(
      (call) => call.operation === 'rename' && call.path.includes('last-fetched'),
    )
    const sweepIndex = filesystem.calls.findIndex(
      (call) => call.operation === 'deleteFile' && call.path.includes('unseen-changes'),
    )
    expect(promoteIndex).toBeGreaterThan(-1)
    expect(sweepIndex).toBeGreaterThan(promoteIndex)
  })

  it('serializes overlapping writes to the same artifact in invocation order', async () => {
    const filesystem = new FakeFilesystem()
    const store = new CapacitorFilesystemStore(filesystem)

    await Promise.all([
      store.replace('stars.json', { generation: 1 }),
      store.replace('stars.json', { generation: 2 }),
    ])

    await expect(store.read('stars.json')).resolves.toEqual({ generation: 2 })
  })
})
