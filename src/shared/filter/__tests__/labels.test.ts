import { describe, expect, it } from 'vitest'
import { dayLabel, facetValueLabel } from '../labels'

describe('facetValueLabel', () => {
  it('renders the override table entries that mechanical casing would mangle', () => {
    expect(facetValueLabel('genre', 'scifi-fantasy')).toBe('Sci-Fi & Fantasy')
    expect(facetValueLabel('community', 'lgbtqia')).toBe('LGBTQIA+')
    expect(facetValueLabel('community', 'bipoc')).toBe('BIPOC')
    expect(facetValueLabel('format', 'ccg-tcg')).toBe('CCG / TCG')
    expect(facetValueLabel('strand', 'cci-iff')).toBe('CCI Independent Film Festival')
    expect(facetValueLabel('duration', 'short')).toBe('Under 30m')
    expect(facetValueLabel('players', 'supported')).toBe('Has a player count')
  })

  it('falls through to mechanical title-casing for ids not in the table', () => {
    expect(facetValueLabel('ip', 'star-wars')).toBe('Star Wars')
    expect(facetValueLabel('genre', 'artist-alley')).toBe('Artist Alley')
    expect(facetValueLabel('genre', 'horror')).toBe('Horror')
  })

  it('passes person and room values through verbatim', () => {
    // Title-casing splits on hyphens — a hyphenated surname must survive.
    expect(facetValueLabel('person', 'Anne-Marie Fleming')).toBe('Anne-Marie Fleming')
    expect(facetValueLabel('person', 'Scott Snyder')).toBe('Scott Snyder')
    expect(facetValueLabel('room', 'Grand 4, Marriott Marquis')).toBe('Grand 4, Marriott Marquis')
  })

  it('formats day values as readable dates — the one dimension whose values are data', () => {
    expect(facetValueLabel('day', '2026-07-25')).toBe('Sat Jul 25')
    expect(facetValueLabel('day', '2026-07-22')).toBe('Wed Jul 22')
  })
})

describe('dayLabel', () => {
  it('labels a day without consulting the host timezone', () => {
    expect(dayLabel('2026-07-25')).toEqual({ weekday: 'Sat', date: 'Jul 25' })
  })

  it('degrades an unparseable day to a dash rather than throwing', () => {
    expect(dayLabel('not-a-date')).toEqual({ weekday: '—', date: 'not-a-date' })
  })
})
