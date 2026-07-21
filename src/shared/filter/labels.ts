/**
 * Human labels for facet values.
 *
 * The facet map and the enrichment index store machine ids (`scifi-fantasy`,
 * `star-wars-lego`) because that is what filter state should serialize as.
 * Shared because two surfaces quote values back to the user — the sidebar's
 * chips and the chat's tool results — and neither should leak a machine id
 * into prose.
 *
 * Title-casing the ids mechanically gets most of the way there and gets the
 * ones that matter wrong: "Lgbtqia", "Ccg Tcg", "Bipoc". The overrides below
 * are only for the ids that mechanical casing mangles, so a new facet value
 * added to the table renders acceptably without anyone having to remember to
 * come back here.
 */

const OVERRIDES: Record<string, string> = {
  // Acronyms and stylized names, which casing cannot recover.
  'scifi-fantasy': 'Sci-Fi & Fantasy',
  'anime-manga': 'Anime & Manga',
  lgbtqia: 'LGBTQIA+',
  bipoc: 'BIPOC',
  'ccg-tcg': 'CCG / TCG',
  rpg: 'RPG',
  cbldf: 'CBLDF',
  'cci-iff': 'CCI Independent Film Festival',
  'comics-arts-conference': 'Comics Arts Conference',
  'college-of-comics': 'College of Comics',
  'creator-connection': 'Creator Connection',
  'exclusive-portal': 'Exclusive Portal',
  'art-illustration': 'Art & Illustration',
  'toys-collectibles': 'Toys & Collectibles',
  'mystery-crime': 'Mystery & Crime',
  'science-tech': 'Science & Tech',
  'anniversaries-tributes': 'Anniversaries & Tributes',
  'web-digital': 'Web & Digital',
  'action-adventure': 'Action & Adventure',
  'video-games': 'Video Games',
  'video-game-play': 'Video Game Play',
  'board-game': 'Board Game',
  'card-game': 'Card Game',
  'model-kit': 'Model Kit',
  'open-captions': 'Open Captions',
  'open-captions-maybe': 'Open Captions (maybe)',
  'no-captions': 'No Captions',

  // Computed dimensions.
  'convention-center': 'Convention Center',
  'late-night': 'Late Night',
  'all-ages': 'All Ages',
  supported: 'Has a player count',
  block: 'All-day block',
  short: 'Under 30m',
  standard: '30m – 90m',
  long: '90m – 4h',
  'not-enriched': 'Not enriched',
}

/**
 * Dimensions whose values are not vocabulary ids: person values are real names
 * ("Scott Snyder" — title-casing would mangle a hyphenated surname) and room
 * values are Sched's verbatim strings. They pass through untouched.
 */
const VERBATIM_DIMENSIONS = new Set(['person', 'room'])

const titleCase = (id: string): string =>
  id
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Noon UTC and UTC getters: the label for a `YYYY-MM-DD` must not depend on
 *  which timezone the machine is in. Shared because both the sidebar chips and
 *  the chat tools label day values — and models famously miscompute a weekday
 *  from a raw ISO date, so the tool layer must never ship one as a "label". */
export function dayLabel(day: string): { weekday: string; date: string } {
  const d = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return { weekday: '—', date: day }
  return {
    weekday: WEEKDAYS[d.getUTCDay()] ?? '—',
    date: `${MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCDate()}`,
  }
}

export function facetValueLabel(dimension: string, value: string): string {
  if (dimension === 'day') {
    const { weekday, date } = dayLabel(value)
    return `${weekday} ${date}`
  }
  if (VERBATIM_DIMENSIONS.has(dimension)) return value
  return OVERRIDES[value] ?? titleCase(value)
}
