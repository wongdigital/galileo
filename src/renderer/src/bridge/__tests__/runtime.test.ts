// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlatformBridge } from '@shared/bridge/types'
import { bridge, setBridgeForTesting } from '../../bridge'

const webModuleLoaded = vi.hoisted(() => vi.fn())
const platformBridgeFactory = vi.hoisted(() => vi.fn())
const subscribe = vi.hoisted(() => vi.fn())
const unsubscribe = vi.hoisted(() => vi.fn())

vi.mock('../web', () => {
  webModuleLoaded()
  return { platformBridge: platformBridgeFactory }
})

platformBridgeFactory.mockResolvedValue({
  app: { version: vi.fn(async () => 'web-version') },
  llm: { onChatDelta: subscribe },
} as unknown as PlatformBridge)
subscribe.mockReturnValue(unsubscribe)

afterEach(() => {
  setBridgeForTesting(undefined)
  delete window.api
})

describe('platform bridge runtime selection', () => {
  it('keeps the web runtime lazy, stable, and cancellation-safe', async () => {
    const electron = { marker: 'electron' } as unknown as PlatformBridge
    window.api = electron

    expect(bridge()).toBe(electron)
    expect(webModuleLoaded).not.toHaveBeenCalled()

    delete window.api
    const fallback = bridge()
    expect(fallback).not.toBeNull()
    expect(bridge()).toBe(fallback)
    expect(webModuleLoaded).not.toHaveBeenCalled()

    const cancelled = fallback!.llm.onChatDelta(vi.fn())
    cancelled()
    await vi.waitFor(() => expect(webModuleLoaded).toHaveBeenCalledOnce())
    expect(subscribe).not.toHaveBeenCalled()

    await expect(fallback!.app.version()).resolves.toBe('web-version')
    expect(platformBridgeFactory).toHaveBeenCalledOnce()

    const active = fallback!.llm.onChatDelta(vi.fn())
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce())
    active()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
