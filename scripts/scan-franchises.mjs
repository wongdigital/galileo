#!/usr/bin/env node
/**
 * U11 day-one prerequisite: seed the canonical franchise vocabulary.
 *
 * Scans titles + descriptions for recurring proper-noun phrases and ranks them
 * by document frequency. Output is a *candidate* list for human curation into
 * data/franchise-seed.json — not an authority. The batch prompt constrains
 * `canonical` to this enum plus an `other` escape; anything landing in `other`
 * gets promoted via data/aliases.json between compiles, no rerun needed.
 *
 * Usage: node scripts/scan-franchises.mjs [--top N]
 */

import { readFile } from 'node:fs/promises';

const TOP = Number(process.argv.includes('--top') ? process.argv[process.argv.indexOf('--top') + 1] : 250);

const events = JSON.parse(await readFile(new URL('../data/events.json', import.meta.url), 'utf8'));

// Words that start a sentence or are generic enough that a capitalized run
// containing only these is noise rather than a franchise.
const STOP = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'In', 'On', 'At', 'For', 'With', 'From',
  'And', 'But', 'Or', 'To', 'Of', 'By', 'As', 'It', 'Is', 'Are', 'Was', 'Were', 'Be', 'Been',
  'He', 'She', 'They', 'We', 'You', 'I', 'His', 'Her', 'Their', 'Our', 'Your', 'My',
  'What', 'When', 'Where', 'Who', 'Why', 'How', 'All', 'New', 'More', 'Most', 'Other',
  'Comic', 'Comics', 'Con', 'Panel', 'Panels', 'Room', 'Hall', 'Day', 'Days', 'Year', 'Years',
  'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'San', 'Diego', 'Comic-Con', 'International', 'Convention', 'Center',
  'Q&A', 'Special', 'Guest', 'Guests', 'Signing', 'Screening', 'Presentation',
  'Join', 'Come', 'Learn', 'Meet', 'Get', 'See', 'Don', 'Plus', 'Also', 'Then', 'Now',
  'Award', 'Awards', 'Series', 'Show', 'Films', 'Film', 'Movie', 'Movies', 'Book', 'Books',
  // Sched/CCI boilerplate that recurs in description prose, not franchise names.
  'Capacity', 'Moderated', 'Panelists', 'Participating', 'Held', 'Hepburn', 'Japanese',
  'English', 'Subtitled', 'Dubbed', 'Session', 'Sessions', 'Edition', 'Players', 'Player',
  'However', 'Despite', 'Whether', 'There', 'Using', 'Welcome', 'After', 'Before', 'During',
  'Autograph', 'Spotlight', 'Portfolio', 'Review', 'Conference', 'Workshop', 'Demo',
  'Earth', 'Tokyo', 'America', 'American', 'Hollywood', 'Los', 'Angeles', 'York',
]);

// Extract runs of capitalized tokens: "Star Wars", "Dungeons & Dragons", "X-Men".
const PHRASE = /\b([A-Z][\w'’\-]*(?:[ ](?:&|of|the|and|in|de|vs\.?)[ ][A-Z\w'’\-]+|[ ][A-Z][\w'’\-]*){0,4})\b/g;

const docFreq = new Map();  // phrase -> Set of uids (document frequency, not raw count)
const titleFreq = new Map(); // phrase -> count of appearances in a TITLE (stronger signal)

for (const ev of events) {
  const seen = new Set();
  const scan = (text, isTitle) => {
    if (!text) return;
    for (const m of text.matchAll(PHRASE)) {
      const phrase = m[1].trim().replace(/[’']s$/, '');
      const words = phrase.split(/\s+/);
      if (words.length < 2 && phrase.length < 5) continue;   // single short words are noise
      if (words.every((w) => STOP.has(w))) continue;
      if (STOP.has(words[0]) && words.length < 3) continue;
      if (phrase.length > 45) continue;
      if (!seen.has(phrase)) {
        seen.add(phrase);
        if (!docFreq.has(phrase)) docFreq.set(phrase, new Set());
        docFreq.get(phrase).add(ev.uid);
      }
      if (isTitle) titleFreq.set(phrase, (titleFreq.get(phrase) ?? 0) + 1);
    }
  };
  scan(ev.title, true);
  scan(ev.description, false);
}

// Rank: document frequency, with title appearances weighted heavily — a phrase
// in many event *titles* is far more likely a franchise than one buried in prose.
const ranked = [...docFreq.entries()]
  .map(([phrase, uids]) => ({
    phrase,
    docs: uids.size,
    titles: titleFreq.get(phrase) ?? 0,
    score: uids.size + (titleFreq.get(phrase) ?? 0) * 4,
  }))
  // A franchise earns its place by recurring in event *titles*. Phrases that
  // appear only in description prose are almost always boilerplate or sentence
  // fragments, however high their raw document frequency.
  .filter((r) => r.titles >= 2 || (r.titles >= 1 && r.docs >= 6))
  .sort((a, b) => b.score - a.score);

// Drop phrases fully contained in a higher-ranked phrase with similar frequency
// ("Star" under "Star Wars", "Dungeons" under "Dungeons & Dragons").
const kept = [];
for (const r of ranked) {
  const swallowed = kept.some(
    (k) => k.phrase.includes(r.phrase) && r.docs <= k.docs * 1.35,
  );
  if (!swallowed) kept.push(r);
}

// Track spread, computed only for surviving candidates (keeps this O(events × kept),
// not O(events × every phrase)). A franchise appearing in PROGRAMS *and* GAMES *and*
// AUTOGRAPHS is the high-value case for the IP lens; one confined to a single track is
// usually a screening's repeat sessions, which the offering-cluster lens already links.
const shortlist = kept.slice(0, Math.max(TOP, 400));
const spread = new Map(shortlist.map((r) => [r.phrase, new Set()]));
for (const ev of events) {
  const text = `${ev.title} ${ev.description ?? ''}`;
  for (const r of shortlist) {
    if (text.includes(r.phrase)) spread.get(r.phrase).add(ev.track ?? 'none');
  }
}
for (const r of shortlist) {
  r.tracks = spread.get(r.phrase).size;
  // Description-borne share: the fraction of appearances a title-string match would MISS.
  // High values are exactly what LLM extraction buys and nothing else can.
  r.hidden = r.docs > 0 ? Math.round(((r.docs - r.titles) / r.docs) * 100) : 0;
  // IP-lens value: cross-track reach, amplified by how much of it is invisible to string matching.
  r.lensValue = r.tracks * (1 + r.hidden / 100) * Math.log2(r.docs + 1);
}

const byLensValue = [...shortlist].sort((a, b) => b.lensValue - a.lensValue);

console.log(`# franchise candidates — ${kept.length} phrases from ${events.length} events`);
console.log('# ranked by IP-lens value = tracks x description-borne share x log(docs)');
console.log('# hidden% = share of appearances a title string-match would MISS');
console.log('# curate the top of this list into data/franchise-seed.json\n');
console.log('lensVal\tdocs\ttitles\ttracks\thidden%\tphrase');
for (const r of byLensValue.slice(0, TOP)) {
  console.log(`${r.lensValue.toFixed(1)}\t${r.docs}\t${r.titles}\t${r.tracks}\t${r.hidden}\t${r.phrase}`);
}
