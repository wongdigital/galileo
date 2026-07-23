import { describe, expect, it } from 'vitest'
import type { JsonStore } from '../../shared/storage/jsonStore'
import { SettingsSlots } from '../../shared/storage/slots'
import { registerSettingsIpc } from '../settings'

class MemoryJsonStore implements JsonStore {
  readonly values = new Map<string, unknown>()
  reads = 0
  replaces = 0
  failReplace = false

  async read(name: string): Promise<unknown | null> {
    this.reads += 1
    return this.values.get(name) ?? null
  }

  async replace(name: string, value: unknown): Promise<void> {
    this.replaces += 1
    if (this.failReplace) throw new Error('replace failed')
    this.values.set(name, structuredClone(value))
  }
}

describe('registerSettingsIpc', () => {
  it('registers get/set channels over the injected JSON settings slots', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const slots = new SettingsSlots(new MemoryJsonStore())
    registerSettingsIpc({ handle: (channel, listener) => void handlers.set(channel, listener) }, slots)

    expect([...handlers.keys()]).toEqual(['settings:get', 'settings:set'])
    await handlers.get('settings:set')?.(null, { name: 'filters', value: { text: 'horror' } })
    await expect(handlers.get('settings:get')?.(null, 'filters')).resolves.toEqual({ text: 'horror' })
    await expect(handlers.get('settings:get')?.(null, 'missing')).resolves.toBeNull()
  })

  it('rejects malformed payloads without mutating the artifact', async () => {
    const store = new MemoryJsonStore()
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    registerSettingsIpc(
      { handle: (channel, listener) => void handlers.set(channel, listener) },
      new SettingsSlots(store),
    )

    await expect(handlers.get('settings:set')?.(null, { name: '../escape', value: true })).rejects.toThrow(
      'Invalid settings name',
    )
    expect(store.values.size).toBe(0)
  })

  it('serializes concurrent named writes into one settings artifact', async () => {
    const store = new MemoryJsonStore()
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    registerSettingsIpc(
      { handle: (channel, listener) => void handlers.set(channel, listener) },
      new SettingsSlots(store),
    )

    await Promise.all([
      handlers.get('settings:set')?.(null, { name: 'filters', value: { text: 'horror' } }),
      handlers.get('settings:set')?.(null, { name: 'lens', value: 'people' }),
    ])
    await expect(handlers.get('settings:get')?.(null, 'filters')).resolves.toEqual({ text: 'horror' })
    await expect(handlers.get('settings:get')?.(null, 'lens')).resolves.toBe('people')
    expect(store.replaces).toBe(1)
  })

  it('coalesces superseded values while preserving every caller promise', async () => {
    const store = new MemoryJsonStore()
    const slots = new SettingsSlots(store)

    await Promise.all([
      slots.set('filters', { text: 'h' }),
      slots.set('filters', { text: 'ho' }),
      slots.set('filters', { text: 'horror' }),
    ])

    await expect(slots.get('filters')).resolves.toEqual({ text: 'horror' })
    expect(store.replaces).toBe(1)
  })

  it('rejects every caller in a failed batch and drains a later write', async () => {
    const store = new MemoryJsonStore()
    const slots = new SettingsSlots(store)
    store.failReplace = true

    const failed = await Promise.allSettled([
      slots.set('filters', { text: 'h' }),
      slots.set('filters', { text: 'horror' }),
      slots.set('lens', 'people'),
    ])

    expect(failed).toEqual([
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ message: 'replace failed' }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ message: 'replace failed' }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ message: 'replace failed' }) }),
    ])
    store.failReplace = false
    await expect(slots.set('filters', { text: 'comics' })).resolves.toBeUndefined()
    await expect(slots.get('filters')).resolves.toEqual({ text: 'comics' })
    expect(store.values.get('settings.json')).toEqual({ filters: { text: 'comics' } })
  })
})
