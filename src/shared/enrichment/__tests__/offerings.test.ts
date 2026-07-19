import { describe, expect, it } from 'vitest'
import {
  alternativeSessions,
  buildOfferings,
  normalizeOfferingTitle,
  offeringForUid,
  repeatedOfferings,
  sessionCountForUid
} from '../offerings'
import {
  ALL_EVENTS,
  event,
  REPEAT_A,
  REPEAT_B,
  REPEAT_OTHER_TRACK,
  UID_PANEL,
  UID_REPEAT_A,
  UID_REPEAT_B
} from './fixtures'

describe('normalizeOfferingTitle', () => {
  it('folds case, punctuation, and repeated whitespace', () => {
    expect(normalizeOfferingTitle('Lantern Keepers')).toBe(
      normalizeOfferingTitle('lantern  keepers')
    )
    expect(normalizeOfferingTitle('Spider-Man: Beyond!')).toBe('spider man beyond')
  })

  it('folds the anime track footnote asterisk', () => {
    expect(normalizeOfferingTitle('Jet Girls*')).toBe(normalizeOfferingTitle('Jet Girls'))
  })

  it('folds smart quotes and accents so one listing style does not split a cluster', () => {
    expect(normalizeOfferingTitle('Kids’ Day')).toBe(normalizeOfferingTitle("Kids' Day"))
    expect(normalizeOfferingTitle('Pokémon Club')).toBe('pokemon club')
  })

  it('treats & and "and" as the same word', () => {
    expect(normalizeOfferingTitle('Cape & Cowl')).toBe(normalizeOfferingTitle('Cape and Cowl'))
  })

  it('keeps genuinely different titles apart', () => {
    expect(normalizeOfferingTitle('King of Tokyo')).not.toBe(
      normalizeOfferingTitle('King of Tokyo: Godzilla')
    )
  })
})

describe('buildOfferings', () => {
  it('groups repeated titles within a track', () => {
    const index = buildOfferings(ALL_EVENTS)
    const offering = offeringForUid(index, UID_REPEAT_A)
    expect(offering?.sessionCount).toBe(2)
    expect(offering?.uids).toEqual([UID_REPEAT_A, UID_REPEAT_B])
  })

  it('does not merge the same title across tracks', () => {
    const index = buildOfferings(ALL_EVENTS)
    expect(offeringForUid(index, REPEAT_A.uid)?.key).not.toBe(
      offeringForUid(index, REPEAT_OTHER_TRACK.uid)?.key
    )
    expect(sessionCountForUid(index, REPEAT_OTHER_TRACK.uid)).toBe(1)
  })

  it('does not merge sequence titles — Act 1 is not another sitting of Act 2', () => {
    const acts = [
      event('s1', { title: 'Skies Over Tolindia (Act 1)', track: '6: GAMES' }),
      event('s2', { title: 'Skies Over Tolindia (Act 2)', track: '6: GAMES' }),
      event('s3', { title: 'Skies Over Tolindia (Act 3)', track: '6: GAMES' })
    ]
    const index = buildOfferings(acts)
    expect(index.byKey.size).toBe(3)
    for (const a of acts) expect(sessionCountForUid(index, a.uid)).toBe(1)
  })

  it('gives a one-off event a singleton cluster rather than no cluster', () => {
    const index = buildOfferings(ALL_EVENTS)
    expect(sessionCountForUid(index, UID_PANEL)).toBe(1)
    expect(alternativeSessions(index, UID_PANEL)).toEqual([])
  })

  it('sorts sessions by start so the next sitting is a lookup', () => {
    const index = buildOfferings([REPEAT_B, REPEAT_A])
    expect(offeringForUid(index, UID_REPEAT_A)?.uids).toEqual([UID_REPEAT_A, UID_REPEAT_B])
  })

  it('exposes the conflict-resolution input: the other sittings', () => {
    const index = buildOfferings(ALL_EVENTS)
    expect(alternativeSessions(index, UID_REPEAT_A)).toEqual([UID_REPEAT_B])
    expect(alternativeSessions(index, UID_REPEAT_B)).toEqual([UID_REPEAT_A])
  })

  it('lists repeated offerings largest first', () => {
    const index = buildOfferings(ALL_EVENTS)
    const repeated = repeatedOfferings(index)
    expect(repeated).toHaveLength(1)
    expect(repeated[0]?.sessionCount).toBe(2)
  })

  it('handles an empty corpus', () => {
    const index = buildOfferings([])
    expect(index.byKey.size).toBe(0)
    expect(offeringForUid(index, 'nope')).toBeNull()
  })
})
