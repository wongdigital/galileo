/**
 * Synthetic fixtures. Every title, room, and description here is invented — the
 * live corpus carries Sched-authored prose and stays out of git (see U1).
 *
 * The *shapes* are faithful to the live feed, because the shapes are what is
 * under test: the "N: TRACK" prefix, the tag vocabulary's inconsistent spellings
 * ("2-5 players" beside "2-4 Players"), and the games track's habit of tagging a
 * five-hour block with the length of one game.
 */

import type { ScheduleEvent } from '../../schedule/types'
import type { EnrichmentIndex } from '../schema'
import type { FacetMap } from '../facets'

export const UID_PANEL = 'aaaa1111111111111111111111111111'
export const UID_BLOCK = 'bbbb2222222222222222222222222222'
export const UID_REPEAT_A = 'cccc3333333333333333333333333333'
export const UID_REPEAT_B = 'dddd4444444444444444444444444444'
export const UID_ODDTAG = 'eeee5555555555555555555555555555'
export const UID_ABSENT = 'ffff6666666666666666666666666666'

export function event(uid: string, partial: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    uid,
    shortId: null,
    title: 'Untitled',
    start: '2026-07-23T10:00:00-07:00',
    end: '2026-07-23T10:50:00-07:00',
    track: '1: PROGRAMS',
    subtypes: [],
    flags: [],
    room: 'Room 5AB',
    location: 'Room 5AB, 111 Harbor Dr, San Diego, CA 92101, USA',
    description: 'A description.',
    url: null,
    ...partial
  }
}

/** 50 minutes, Programs track. The canonical attend-class event. */
export const PANEL = event(UID_PANEL, {
  title: 'Drawing Monsters for a Living',
  subtypes: ['Comics', 'Horror and Suspense', 'Seminars & Workshops', '13+'],
  description: 'Three artists talk about monster design.'
})

/** Six hours, Games track, tagged with the length of one sitting. */
export const GAMES_BLOCK = event(UID_BLOCK, {
  title: 'Open Table: Cavern Crawl',
  start: '2026-07-24T10:00:00-07:00',
  end: '2026-07-24T16:00:00-07:00',
  track: '6: GAMES',
  subtypes: ['Board', '2-4 Players', '8+', '45 Minutes'],
  room: 'Pacific 21, Marriott Marquis San Diego Marina',
  description: 'Drop in and play.'
})

/** Two sittings of one offering, plus a same-titled event on another track. */
export const REPEAT_A = event(UID_REPEAT_A, {
  title: 'Lantern Keepers',
  start: '2026-07-24T11:00:00-07:00',
  end: '2026-07-24T11:45:00-07:00',
  track: '6: GAMES',
  subtypes: ['Board', '2-5 players', 'Ages 7+']
})

export const REPEAT_B = event(UID_REPEAT_B, {
  title: 'lantern  keepers',
  start: '2026-07-25T11:00:00-07:00',
  end: '2026-07-25T11:45:00-07:00',
  track: '6: GAMES',
  subtypes: ['Board', '2-5 players', 'Ages 7+']
})

/** Same normalized title, different track. Must not merge with the two above. */
export const REPEAT_OTHER_TRACK = event('9999777777777777777777777777aaaa', {
  title: 'Lantern Keepers',
  track: '1: PROGRAMS',
  subtypes: ['Comics']
})

/** Carries a tag nobody mapped — an exhibitor name in Sched's tag field. */
export const ODDTAG = event(UID_ODDTAG, {
  title: 'Portfolio Review Session',
  subtypes: ['Comics', 'Nonexistent Studios LLC'],
  description: 'Bring your book.'
})

export const ALL_EVENTS: ScheduleEvent[] = [
  PANEL,
  GAMES_BLOCK,
  REPEAT_A,
  REPEAT_B,
  REPEAT_OTHER_TRACK,
  ODDTAG
]

// ---------- facet map ----------

/**
 * A trimmed table with the same structure as the committed `data/facet-map.json`
 * — enough dimensions to exercise curated, validation, and numeric behaviour.
 */
export const FACET_MAP: FacetMap = {
  schema_version: 1,
  dimensions: [
    { id: 'genre', label: 'Genre & Topic', kind: 'curated', multi: true },
    { id: 'format', label: 'Format', kind: 'curated', multi: true },
    { id: 'audience', label: 'Audience Age', kind: 'curated', multi: false },
    { id: 'community', label: 'Community', kind: 'curated', multi: true },
    { id: 'players', label: 'Player Count', kind: 'curated', multi: false, numeric: true },
    { id: 'venue_hint', label: 'Venue (tag claim)', kind: 'validation', multi: true },
    { id: 'duration_hint', label: 'Duration (tag claim)', kind: 'validation', multi: true }
  ],
  tags: {
    Comics: ['genre:comics'],
    'Horror and Suspense': ['genre:horror'],
    'Horror/Suspense': ['genre:horror'],
    'Seminars & Workshops': ['format:workshop'],
    Board: ['format:board-game'],
    BIPOC: ['community:bipoc'],
    'Marriott Programs': ['venue_hint:marriott'],
    '45 Minutes': ['duration_hint:45'],
    '2-4 Players': ['players:supported'],
    '2-5 players': ['players:supported'],
    'Kids': ['audience:all-ages'],
    'Ages 7+': ['audience:kids'],
    '8+': ['audience:kids'],
    '10+': ['audience:kids'],
    '13+': ['audience:teens'],
    '18+': ['audience:adults']
  },
  ranges: {
    '2-4 Players': { players: { min: 2, max: 4 } },
    '2-5 players': { players: { min: 2, max: 5 } },
    Kids: { age: { min: 0, max: 12 } },
    'Ages 7+': { age: { min: 7, max: null } },
    '8+': { age: { min: 8, max: null } },
    '10+': { age: { min: 10, max: null } },
    '13+': { age: { min: 13, max: null } },
    '18+': { age: { min: 18, max: null } }
  }
}

// ---------- enrichment index ----------

/** Stand-in for sha256-and-truncate. Deterministic, and different text hashes
 *  differently, which is all the degrade rule needs from it. */
export const fakeHash = (text: string): string => `h:${text.length}:${text.slice(0, 8)}`

export function index(partial: Partial<EnrichmentIndex> = {}): EnrichmentIndex {
  return {
    schema_version: 1,
    generated_at: '2026-07-19T03:29:05.582Z',
    provenance: {
      model: 'claude-haiku-4-5-20251001',
      batch_id: 'msgbatch_test',
      franchise_seed_version: 1,
      system_prompt_sha: '0000000000000000',
      event_count: 2
    },
    entries: {
      [UID_PANEL]: {
        status: 'ok',
        description_hash: fakeHash(PANEL.description),
        people: [{ name: 'Dana Reyes', role: 'panelist' }],
        franchises: [{ surface_text: 'Cavern Crawl', canonical: 'other' }]
      },
      // Processed, nothing found. Distinct from "not in the index at all".
      [UID_BLOCK]: {
        status: 'ok',
        description_hash: fakeHash(GAMES_BLOCK.description),
        people: [],
        franchises: []
      }
    },
    ...partial
  }
}
