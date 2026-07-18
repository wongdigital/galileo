#!/usr/bin/env node
/**
 * Fetch the full Comic-Con schedule from Sched's public endpoints and emit
 * a single joined dataset at data/events.json.
 *
 * Sources (2 requests total, no auth):
 *   /all.ics            — every event: UID, title, UTC times, track, room, full description
 *   /list/descriptions  — short event ID, sub-category tags, local-time strings
 */

const SITE = process.env.SCHED_SITE ?? 'https://comiccon2026.sched.com';
const TZ = 'America/Los_Angeles';
const UA = { 'User-Agent': 'sdcc-schedule personal fetcher (roger@wong.digital)' };

async function get(path) {
  const res = await fetch(`${SITE}${path}`, { headers: UA });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.text();
}

// ---------- iCal ----------

function parseIcs(ics) {
  // Unfold continuation lines (RFC 5545), then split into VEVENT blocks.
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const events = [];
  for (const block of unfolded.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)) {
    const fields = {};
    for (const line of block[1].trim().split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).split(';')[0];
      fields[key] = line
        .slice(idx + 1)
        .replace(/\\n/g, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .trim();
    }
    events.push(fields);
  }
  return events;
}

function toLocalIso(icsUtc) {
  // "20260722T223000Z" -> ISO string in America/Los_Angeles with offset
  const m = icsUtc?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZoneName: 'longOffset',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const offset = parts.timeZoneName.replace('GMT', '') || '-07:00';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

function parseCategories(raw) {
  // "U: UPDATED, 1: PROGRAMS" -> { track: "1: PROGRAMS", flags: ["UPDATED"] }
  const flags = [];
  let track = null;
  for (const part of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const flag = part.match(/^([NUX]): (NEW|UPDATED|CANCELLED)$/);
    if (flag) flags.push(flag[2]);
    else track = part;
  }
  return { track, flags };
}

// ---------- list/descriptions ----------

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rarr;/g, '→')
    .replace(/&nbsp;/g, ' ');
}

function parseListDescriptions(html) {
  // Each event entry:
  //   <a href="event/2QWWL/slug" id="<uid>" class="name">
  //   ... <div class="sched-event-type"> links: type/<Track> then type/<Track>/<Subtype> ...
  // Split on the anchor tags so each chunk holds one event's details block.
  const byUid = new Map();
  const chunks = html.split(/<a href="event\//).slice(1);
  for (const chunk of chunks) {
    const head = chunk.match(/^([^/"]+)[^"]*" id="([0-9a-f]{32})"/);
    if (!head) continue;
    const [, shortId, uid] = head;
    const subtypes = [];
    const typeBlock = chunk.match(/<div class="sched-event-type">([\s\S]*?)<\/div>/);
    if (typeBlock) {
      for (const link of typeBlock[1].matchAll(/type\/[^"/]+\/([^"]+)"/g)) {
        subtypes.push(decodeEntities(decodeURIComponent(link[1].replace(/\+/g, ' '))).trim());
      }
    }
    // Keep the first occurrence; repeat listings (multi-day) carry the same tags.
    if (!byUid.has(uid)) byUid.set(uid, { shortId, subtypes });
  }
  return byUid;
}

// ---------- main ----------

const [ics, listHtml] = await Promise.all([get('/all.ics'), get('/list/descriptions')]);
const rawEvents = parseIcs(ics);
const listData = parseListDescriptions(listHtml);

let joined = 0;
const events = rawEvents.map((ev) => {
  const uid = ev.UID;
  const extra = listData.get(uid);
  if (extra) joined++;
  const { track, flags } = parseCategories(ev.CATEGORIES);
  const location = ev.LOCATION ?? '';
  return {
    uid,
    shortId: extra?.shortId ?? null,
    title: ev.SUMMARY ?? '',
    start: toLocalIso(ev.DTSTART),
    end: toLocalIso(ev.DTEND),
    track,
    subtypes: extra?.subtypes ?? [],
    flags,
    // "Room 18 (Mezzanine), 111 Harbor Dr, ..." -> room is everything before the street address
    room: location.split(/, \d+ [A-Z]/)[0] || location,
    location,
    description: ev.DESCRIPTION ?? '',
    url: extra?.shortId ? `${SITE}/event/${extra.shortId}` : ev.URL ?? null,
  };
});

events.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || a.title.localeCompare(b.title));

const { writeFile, mkdir } = await import('node:fs/promises');
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/events.json', import.meta.url), JSON.stringify(events, null, 1));
await writeFile(
  new URL('../data/meta.json', import.meta.url),
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      site: SITE,
      timezone: TZ,
      eventCount: events.length,
      joinedWithListView: joined,
      tracks: [...new Set(events.map((e) => e.track).filter(Boolean))].sort(),
    },
    null,
    1,
  ),
);

console.log(`${events.length} events written to data/events.json (${joined} joined with list view)`);
