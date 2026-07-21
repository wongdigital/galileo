// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { communityHue, paintMapLabels, withAlpha, type LabelCandidate } from '../paint'

/** The label pass needs only text metrics and fill calls — a plain object
 *  stands in for the 2D context jsdom does not implement. */
function fakeCtx(): CanvasRenderingContext2D & { drawn: string[] } {
  const ctx = {
    drawn: [] as string[],
    font: '',
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
    save(): void {},
    restore(): void {},
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillText(text: string): void {
      this.drawn.push(text)
    },
  }
  return ctx as unknown as CanvasRenderingContext2D & { drawn: string[] }
}

const hub = (over: Partial<Extract<LabelCandidate, { kind: 'hub' }>>): LabelCandidate => ({
  kind: 'hub',
  x: 0,
  y: 0,
  r: 10,
  label: 'Hub',
  degree: 100,
  pinned: false,
  ...over,
})

describe('paintMapLabels', () => {
  it('skips a label whose rectangle collides with a louder one', () => {
    const ctx = fakeCtx()
    paintMapLabels(
      [
        hub({ label: 'Quiet', degree: 5, x: 4 }),
        hub({ label: 'Loud', degree: 500, x: 0 }),
      ],
      ctx,
      10,
    )
    expect(ctx.drawn).toEqual(['Loud'])
  })

  it('draws both when they are apart', () => {
    const ctx = fakeCtx()
    paintMapLabels(
      [hub({ label: 'West', x: -500 }), hub({ label: 'East', x: 500 })],
      ctx,
      10,
    )
    expect(ctx.drawn.sort()).toEqual(['East', 'West'])
  })

  it('the pinned title always paints, and paints first', () => {
    const ctx = fakeCtx()
    paintMapLabels(
      [
        hub({ label: 'Loud', degree: 500 }),
        { kind: 'event', x: 2, y: 2, r: 2.4, title: 'Pinned Panel' },
      ],
      ctx,
      10,
    )
    expect(ctx.drawn[0]).toBe('Pinned Panel')
  })

  it('holds sub-threshold hub labels back until the zoom earns them', () => {
    const ctx = fakeCtx()
    paintMapLabels([hub({ label: 'Tiny', degree: 1 })], ctx, 0.5)
    expect(ctx.drawn).toEqual([])
  })
})

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
