/**
 * Parse Sched's `/list/descriptions` page. It is the only source for two
 * fields the .ics omits: the short public event id (which builds the canonical
 * URL) and the sub-category tags that the facet mapping is built on.
 *
 * Regex rather than a DOM parser on purpose: this module is pure and has to run
 * in the main process, in the CLI, and in tests without pulling in a parser
 * dependency. The page shape is stable and the drift guard catches the day it
 * is not.
 */

export interface ListEntry {
  shortId: string
  subtypes: string[]
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&rarr;': '→',
  '&nbsp;': ' ',
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|rarr|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#0?39;/g, "'")
}

function decodeSegment(raw: string): string {
  const spaced = raw.replace(/\+/g, ' ')
  try {
    return decodeEntities(decodeURIComponent(spaced)).trim()
  } catch {
    // A malformed percent-escape is a Sched typo, not a reason to lose the
    // whole fetch. Keep the segment as-is.
    return decodeEntities(spaced).trim()
  }
}

export function parseListDescriptions(html: string): Map<string, ListEntry> {
  const byUid = new Map<string, ListEntry>()
  // Each event opens with `<a href="event/<shortId>/<slug>" id="<uid>" ...>`,
  // so splitting on the anchor gives one chunk per event, its details block
  // included.
  for (const chunk of html.split(/<a href="event\//).slice(1)) {
    const head = chunk.match(/^([^/"]+)[^"]*" id="([0-9a-f]{32})"/)
    if (!head) continue
    const [, shortId, uid] = head as unknown as [string, string, string]
    const subtypes: string[] = []
    const typeBlock = chunk.match(/<div class="sched-event-type">([\s\S]*?)<\/div>/)
    if (typeBlock?.[1]) {
      // `type/<Track>` is the track link; only `type/<Track>/<Subtype>` carries
      // a tag worth keeping.
      for (const link of typeBlock[1].matchAll(/type\/[^"/]+\/([^"]+)"/g)) {
        if (link[1]) subtypes.push(decodeSegment(link[1]))
      }
    }
    // Multi-day events are listed once per day with identical tags; the first
    // listing wins. Deduped, because Sched renders some events' tag list twice
    // inside one type block (107 of 3,474 in the live feed) — a doubled tag is
    // markup noise, not two facts.
    if (!byUid.has(uid)) byUid.set(uid, { shortId, subtypes: [...new Set(subtypes)] })
  }
  return byUid
}
