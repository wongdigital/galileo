import { describe, expect, it } from 'vitest'
import type { JsonStore } from '../../shared/storage/jsonStore'
import { SettingsSlots } from '../../shared/storage/slots'
import { registerSettingsIpc } from '../settings'

class MemoryJsonStore implements JsonStore {
  readonly values = new Map<string, unknown>()

  async read(name: string): Promise<unknown | null> {
    return this.values.get(name) ?? null
  }

  async replace(name: string, value: unknown): Promise<void> {
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
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    registerSettingsIpc(
      { handle: (channel, listener) => void handlers.set(channel, listener) },
      new SettingsSlots(new MemoryJsonStore()),
    )

    await Promise.all([
      handlers.get('settings:set')?.(null, { name: 'filters', value: { text: 'horror' } }),
      handlers.get('settings:set')?.(null, { name: 'lens', value: 'people' }),
    ])
    await expect(handlers.get('settings:get')?.(null, 'filters')).resolves.toEqual({ text: 'horror' })
    await expect(handlers.get('settings:get')?.(null, 'lens')).resolves.toBe('people')
  })
})
