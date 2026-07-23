import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NodeJsonStore } from '../nodeJsonStore'

let dir: string
let store: NodeJsonStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'galileo-json-store-'))
  store = new NodeJsonStore(dir)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const target = (name = 'value.json') => join(dir, name)
const temps = () => readdirSync(dir).filter((name) => name.endsWith('.tmp'))

describe('NodeJsonStore', () => {
  it('round-trips JSON and leaves no temp file', async () => {
    await store.replace('value.json', { generation: 1 })
    expect(await store.read('value.json')).toEqual({ generation: 1 })
    expect(temps()).toEqual([])
  })

  it('keeps previous bytes readable when the temp write fails', async () => {
    await store.replace('value.json', { generation: 1 })
    mkdirSync(`${target()}.${process.pid}.tmp`)
    await expect(store.replace('value.json', { generation: 2 })).rejects.toThrow()
    expect(JSON.parse(readFileSync(target(), 'utf8'))).toEqual({ generation: 1 })
  })

  it('recovers a parseable interrupted temp when the target is absent', async () => {
    writeFileSync(`${target()}.123.tmp`, JSON.stringify({ generation: 2 }))
    expect(await store.read('value.json')).toEqual({ generation: 2 })
    expect(JSON.parse(readFileSync(target(), 'utf8'))).toEqual({ generation: 2 })
    expect(temps()).toEqual([])
  })

  it('recovers a parseable interrupted temp when the target is corrupt', async () => {
    writeFileSync(target(), '{truncated')
    writeFileSync(`${target()}.123.tmp`, JSON.stringify({ generation: 2 }))
    expect(await store.read('value.json')).toEqual({ generation: 2 })
    expect(JSON.parse(readFileSync(target(), 'utf8'))).toEqual({ generation: 2 })
    expect(temps()).toEqual([])
  })

  it('replaces a corrupt target with a parseable interrupted temp', async () => {
    writeFileSync(target(), '{truncated')
    writeFileSync(`${target()}.123.tmp`, JSON.stringify({ generation: 2 }))
    expect(await store.read('value.json')).toEqual({ generation: 2 })
    expect(JSON.parse(readFileSync(target(), 'utf8'))).toEqual({ generation: 2 })
    expect(temps()).toEqual([])
  })

  it('keeps a parseable target and sweeps an orphan temp', async () => {
    writeFileSync(target(), JSON.stringify({ generation: 1 }))
    writeFileSync(`${target()}.123.tmp`, JSON.stringify({ generation: 2 }))
    expect(await store.read('value.json')).toEqual({ generation: 1 })
    expect(temps()).toEqual([])
  })

  it('serializes overlapping replaces for one name in invocation order', async () => {
    const first = store.replace('value.json', { generation: 1 })
    const second = store.replace('value.json', { generation: 2 })
    await Promise.all([first, second])
    expect(await store.read('value.json')).toEqual({ generation: 2 })
  })

  it('does not poison a name queue after a failed replace', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(store.replace('value.json', circular)).rejects.toThrow()
    await store.replace('value.json', { generation: 2 })
    expect(await store.read('value.json')).toEqual({ generation: 2 })
  })

  it('cleans its temp after a rename failure', async () => {
    mkdirSync(target())
    await expect(store.replace('value.json', { generation: 1 })).rejects.toThrow()
    expect(temps()).toEqual([])
  })
})
