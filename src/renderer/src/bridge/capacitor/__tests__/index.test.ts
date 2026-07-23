// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import { createCapacitorBridge, type CapacitorBridgeDeps } from '..'

function dependencies(): {
  deps: CapacitorBridgeDeps
  setActive: (active: boolean) => void
  appearanceChange: () => void
  reset: ReturnType<typeof vi.fn>
} {
  let listener: ((state: { isActive: boolean }) => void) | undefined
  let appearanceListener: (() => void) | undefined
  const reset = vi.fn()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: vi.fn((_event: string, callback: () => void) => {
        appearanceListener = callback
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  })
  return {
    reset,
    setActive: (active) => listener?.({ isActive: active }),
    appearanceChange: () => appearanceListener?.(),
    deps: {
      filesystem: {
        mkdir: vi.fn(async () => {}),
        readdir: vi.fn(async () => ({ files: [] })),
        readFile: vi.fn(async () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }),
        writeFile: vi.fn(async () => ({ uri: 'file:///cache/test.ics' })),
        deleteFile: vi.fn(async () => {}),
        rename: vi.fn(async () => {}),
        getUri: vi.fn(async () => ({ uri: 'file:///cache/test.ics' })),
      },
      http: {
        request: vi.fn(async () => ({ status: 200, data: '', headers: {}, url: '' })),
      },
      secureStorage: {
        setSynchronize: vi.fn(async () => {}),
        setDefaultKeychainAccess: vi.fn(async () => {}),
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => false),
      },
      share: { share: vi.fn(async () => ({ activityType: 'test' })) },
      app: {
        getInfo: vi.fn(async () => ({ version: '2.3.4' })),
        addListener: vi.fn(async (_event, callback) => {
          listener = callback
          return { remove: vi.fn(async () => {}) }
        }),
      },
      streamFetch: vi.fn(),
      resetCachedPalette: reset,
    },
  }
}

describe('createCapacitorBridge', () => {
  it('uses native app metadata and invalidates the cached palette on appearance change and resume', async () => {
    const { deps, setActive, appearanceChange, reset } = dependencies()
    const bridge = createCapacitorBridge(deps)

    await expect(bridge.app.version()).resolves.toBe('2.3.4')
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    setActive(false)
    expect(reset).not.toHaveBeenCalled()

    appearanceChange()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    setActive(true)
    expect(reset).toHaveBeenCalledTimes(3)
  })
})
