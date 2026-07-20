import { describe, expect, it } from 'vitest'
import { communityHue, withAlpha } from '../paint'

describe('communityHue', () => {
  it('is a pure function of the hub id — the colour survives restarts and reshuffles', () => {
    expect(communityHue('person:carlos-pacheco')).toBe(communityHue('person:carlos-pacheco'))
    expect(communityHue('genre:scifi-fantasy')).toBe(communityHue('genre:scifi-fantasy'))
  })

  it('never lands in the warm band the signal colours own', () => {
    // Star gold ≈45°, moved amber ≈40°, cancelled red ≈350° — membership hue
    // must not be mistakable for a change signal. The wheel runs 95–325.
    const ids = ['person:a', 'person:b', 'franchise:star-wars', 'genre:horror', 'x', 'y', 'z']
    for (const id of ids) {
      const hue = communityHue(id)
      expect(hue).toBeGreaterThanOrEqual(95)
      expect(hue).toBeLessThanOrEqual(325)
    }
  })

  it('spreads distinct ids across more than one hue', () => {
    const hues = new Set(
      Array.from({ length: 40 }, (_, i) => communityHue(`person:speaker-${i}`)),
    )
    expect(hues.size).toBeGreaterThan(4)
  })
})

describe('withAlpha', () => {
  it('appends an alpha byte to a six-digit hex and passes anything else through', () => {
    expect(withAlpha('#4fd6e8', 0.5)).toBe('#4fd6e880')
    expect(withAlpha('hsla(95, 70%, 68%, 0.2)', 0.5)).toBe('hsla(95, 70%, 68%, 0.2)')
  })
})
