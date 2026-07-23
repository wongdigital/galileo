import { useEffect, useState } from 'react'

export type ViewportTier = 'compact' | 'medium' | 'wide'

export const VIEWPORT_TIER_BOUNDARIES = {
  compact: 700,
  wide: 1000,
  hysteresis: 40,
} as const

const WATCH_QUERIES = [
  `(min-width: ${VIEWPORT_TIER_BOUNDARIES.compact - VIEWPORT_TIER_BOUNDARIES.hysteresis}px)`,
  `(min-width: ${VIEWPORT_TIER_BOUNDARIES.compact + VIEWPORT_TIER_BOUNDARIES.hysteresis}px)`,
  `(min-width: ${VIEWPORT_TIER_BOUNDARIES.wide - VIEWPORT_TIER_BOUNDARIES.hysteresis}px)`,
  `(min-width: ${VIEWPORT_TIER_BOUNDARIES.wide + VIEWPORT_TIER_BOUNDARIES.hysteresis}px)`,
]

function initialTier(width: number): ViewportTier {
  if (width < VIEWPORT_TIER_BOUNDARIES.compact) return 'compact'
  if (width < VIEWPORT_TIER_BOUNDARIES.wide) return 'medium'
  return 'wide'
}

export function viewportTierForWidth(
  width: number,
  current?: ViewportTier,
): ViewportTier {
  if (!current) return initialTier(width)

  const { compact, wide, hysteresis } = VIEWPORT_TIER_BOUNDARIES
  if (current === 'wide') {
    if (width < compact - hysteresis) return 'compact'
    return width < wide - hysteresis ? 'medium' : 'wide'
  }
  if (current === 'compact') {
    if (width >= wide + hysteresis) return 'wide'
    return width >= compact + hysteresis ? 'medium' : 'compact'
  }
  if (width >= wide + hysteresis) return 'wide'
  if (width < compact - hysteresis) return 'compact'
  return 'medium'
}

/**
 * A matchMedia-driven layout spine with directional hysteresis. CSS owns
 * cosmetics; components consume this single tier so resize behavior cannot
 * drift across unrelated media queries.
 */
export function useViewportTier(): ViewportTier {
  const readWidth = (): number => {
    if (typeof window === 'undefined') return VIEWPORT_TIER_BOUNDARIES.wide
    const visualViewport = window.visualViewport
    const visualWidth = visualViewport?.width
    const visualScale = visualViewport?.scale
    return typeof visualWidth === 'number' &&
      Number.isFinite(visualWidth) &&
      visualWidth > 0 &&
      typeof visualScale === 'number' &&
      Number.isFinite(visualScale) &&
      visualScale > 0
      ? visualWidth * visualScale
      : window.innerWidth
  }
  const [tier, setTier] = useState<ViewportTier>(() => viewportTierForWidth(readWidth()))

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = (): void => {
      setTier((current) => viewportTierForWidth(readWidth(), current))
    }

    window.addEventListener('resize', update)
    const visualViewport = window.visualViewport
    visualViewport?.addEventListener('resize', update)
    const queries =
      typeof window.matchMedia === 'function'
        ? WATCH_QUERIES.map((query) => window.matchMedia(query))
        : []
    for (const query of queries) query.addEventListener('change', update)
    update()
    return () => {
      window.removeEventListener('resize', update)
      visualViewport?.removeEventListener('resize', update)
      for (const query of queries) query.removeEventListener('change', update)
    }
  }, [])

  return tier
}
