// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  VIEWPORT_TIER_BOUNDARIES,
  useViewportTier,
  type ViewportTier,
} from '../useViewportTier'

type ChangeListener = (event: MediaQueryListEvent) => void

function installViewport(initialWidth: number) {
  const listeners = new Set<ChangeListener>()

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: initialWidth,
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      media: query,
      matches: window.innerWidth >= Number(query.match(/\d+/)?.[0] ?? 0),
      onchange: null,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener as ChangeListener)
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.delete(listener as ChangeListener)
      },
      addListener: (listener: ChangeListener) => listeners.add(listener),
      removeListener: (listener: ChangeListener) => listeners.delete(listener),
      dispatchEvent: () => true,
    }),
  })

  return (width: number): void => {
    window.innerWidth = width
    const event = { matches: true, media: '' } as MediaQueryListEvent
    act(() => {
      for (const listener of listeners) listener(event)
    })
  }
}

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: undefined,
  })
})

describe('useViewportTier', () => {
  it.each([
    [1180, 'wide'],
    [820, 'medium'],
    [590, 'compact'],
  ] satisfies [number, ViewportTier][])('reports %s px as %s', (width, expected) => {
    installViewport(width)
    const { result } = renderHook(() => useViewportTier())
    expect(result.current).toBe(expected)
  })

  it('uses directional hysteresis so ±30 px does not flip a settled tier', () => {
    const resize = installViewport(1180)
    const { result } = renderHook(() => useViewportTier())

    resize(VIEWPORT_TIER_BOUNDARIES.wide - 30)
    expect(result.current).toBe('wide')
    resize(VIEWPORT_TIER_BOUNDARIES.wide - VIEWPORT_TIER_BOUNDARIES.hysteresis - 1)
    expect(result.current).toBe('medium')

    resize(VIEWPORT_TIER_BOUNDARIES.wide + 30)
    expect(result.current).toBe('medium')
    resize(VIEWPORT_TIER_BOUNDARIES.wide + VIEWPORT_TIER_BOUNDARIES.hysteresis)
    expect(result.current).toBe('wide')

    resize(VIEWPORT_TIER_BOUNDARIES.compact + 30)
    expect(result.current).toBe('medium')
    resize(VIEWPORT_TIER_BOUNDARIES.compact - VIEWPORT_TIER_BOUNDARIES.hysteresis - 1)
    expect(result.current).toBe('compact')

    resize(VIEWPORT_TIER_BOUNDARIES.compact - 30)
    expect(result.current).toBe('compact')
    resize(VIEWPORT_TIER_BOUNDARIES.compact + VIEWPORT_TIER_BOUNDARIES.hysteresis)
    expect(result.current).toBe('medium')
  })

  it('tracks the visual viewport when iPad windowing leaves innerWidth unchanged', () => {
    installViewport(1024)
    const listeners = new Set<EventListener>()
    const visualViewport = {
      width: 1024,
      addEventListener: (_type: string, listener: EventListener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: EventListener) => listeners.delete(listener),
    }
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    })

    const { result } = renderHook(() => useViewportTier())
    expect(result.current).toBe('wide')

    visualViewport.width = 683
    act(() => {
      for (const listener of listeners) listener(new Event('resize'))
    })

    expect(result.current).toBe('medium')
  })
})
