#!/usr/bin/env node
/**
 * U11 — maintainer-side enrichment compiler.
 *
 * Runs a Claude Message Batch over every event description to extract the two
 * things the deterministic passes can't derive: **people** (names appear only in
 * prose — Sched has no structured speaker field for SDCC) and **franchises**
 * (which connect events across tracks; a title string-match finds a fraction —
 * Spider-Man appears in 37 events but only 4 titles).
 *
 * Everything else — event classes, offering clusters, facets — is deterministic
 * and lives in src/shared/enrichment (U4). This script is the LLM half only.
 *
 * Usage (needs ANTHROPIC_API_KEY; .env is gitignored):
 *   node --env-file=.env scripts/enrich.mjs submit    # build + fire the batch
 *   node --env-file=.env scripts/enrich.mjs poll      # check status
 *   node --env-file=.env scripts/enrich.mjs merge     # validate + write the index
 *   node --env-file=.env scripts/enrich.mjs run       # submit, wait, merge
 *
 * Batch intermediates land in data/batch-<id>/ — gitignored, they contain Sched
 * prose. The committed index carries extracted spans and canonical ids only.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const MODEL = 'claude-haiku-4-5-20251001';
const SCHEMA_VERSION = 1;
const ROOT = new URL('../', import.meta.url);
const STATE_FILE = new URL('data/.batch-state.json', ROOT);

const ROLES = ['panelist', 'moderator', 'creator', 'writer', 'artist', 'actor', 'host', 'other'];

// ---------- prompt + schema ----------

const SYSTEM = `You extract structured facts from convention program descriptions for a schedule app's relationship graph.

Extract two things:

PEOPLE — individuals named as participating in this event (panelists, moderators, creators, performers, hosts).
- "name" MUST be copied VERBATIM from the description, character for character. Do not correct spelling, expand initials, reorder, add or remove titles, or normalize anything. If the text says "J. Scott Campbell", return exactly "J. Scott Campbell".
- When the text combines two people under a shared surname — "Brad and Lisa Gullickson", "the Russo Brothers" — do NOT reconstruct individual full names. Copy the span exactly as written and return it as a single entry. A verbatim combined span is correct; an invented full name is not.
- Include only people participating in THIS event. Do NOT include: characters, fictional people, companies, people mentioned only as a subject of discussion, or people credited on a work being screened but not present.
- If no participants are named, return an empty array.

FRANCHISES — media properties, intellectual properties, publishers, and studios this event is about or connected to.
- "surface_text" MUST be copied VERBATIM from the description or title, character for character.
- "canonical" MUST be one of the allowed enum values. Use "other" when the property is real but not in the list — surface_text is preserved either way, so "other" is always safe and is strongly preferred over forcing a wrong match.
- Include a franchise when the event is about it, features it, or discusses it. A passing comparison ("fans of Star Wars will enjoy...") still counts.
- If no franchise applies, return an empty array.

Empty arrays are expected and correct for many events. Never invent a name or franchise to fill space.`;

function buildSchema(franchiseIds) {
  return {
    type: 'object',
    properties: {
      people: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Verbatim substring of the description' },
            role: { type: 'string', enum: ROLES },
          },
          required: ['name', 'role'],
          additionalProperties: false,
        },
      },
      franchises: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            surface_text: { type: 'string', description: 'Verbatim substring of title or description' },
            canonical: { type: 'string', enum: [...franchiseIds, 'other'] },
          },
          required: ['surface_text', 'canonical'],
          additionalProperties: false,
        },
      },
    },
    required: ['people', 'franchises'],
    additionalProperties: false,
  };
}

function userPrompt(ev) {
  return `TITLE: ${ev.title}
TRACK: ${ev.track ?? 'none'}
TAGS: ${ev.subtypes.join(', ') || 'none'}

DESCRIPTION:
${ev.description}`;
}

// ---------- helpers ----------

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));
const writeJson = (url, data) => writeFile(url, JSON.stringify(data, null, 1) + '\n');

async function loadInputs() {
  const events = await readJson(new URL('data/events.json', ROOT));
  const seed = await readJson(new URL('data/franchise-seed.json', ROOT));
  const franchiseIds = seed.franchises.map((f) => f.id);
  // Enrich only events that actually have prose to extract from.
  const targets = events.filter((e) => e.description && e.description.trim().length > 0);
  return { events, targets, seed, franchiseIds };
}

function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set. Run with: node --env-file=.env scripts/enrich.mjs <cmd>');
    process.exit(1);
  }
  return new Anthropic();
}

async function saveState(state) {
  await writeJson(STATE_FILE, state);
}

async function loadState() {
  if (!existsSync(STATE_FILE)) {
    console.error('No batch state found. Run `submit` first.');
    process.exit(1);
  }
  return readJson(STATE_FILE);
}

// ---------- submit ----------

async function submit() {
  const { targets, franchiseIds } = await loadInputs();
  const schema = buildSchema(franchiseIds);

  console.log(`Building batch: ${targets.length} events, ${franchiseIds.length} seed franchises`);

  const requests = targets.map((ev) => ({
    custom_id: ev.uid,
    params: {
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: userPrompt(ev) }],
    },
  }));

  const batch = await client().messages.batches.create({ requests });
  const state = { batchId: batch.id, model: MODEL, submittedAt: new Date().toISOString(), count: requests.length };
  await saveState(state);

  console.log(`Batch submitted: ${batch.id}`);
  console.log(`Status: ${batch.processing_status}`);
  console.log(`Poll with: node --env-file=.env scripts/enrich.mjs poll`);
  return state;
}

// ---------- poll ----------

async function poll({ quiet = false } = {}) {
  const state = await loadState();
  const batch = await client().messages.batches.retrieve(state.batchId);
  const c = batch.request_counts;
  if (!quiet) {
    console.log(`Batch ${state.batchId}: ${batch.processing_status}`);
    console.log(`  processing=${c.processing} succeeded=${c.succeeded} errored=${c.errored} canceled=${c.canceled} expired=${c.expired}`);
  }
  return batch;
}

// ---------- merge ----------

/**
 * Verbatim-substring validation, langextract-style grounding. An extracted span
 * that isn't literally present in the source is a hallucination regardless of how
 * plausible it reads — it goes to the review bucket, never into the index.
 */
function validateEntry(result, ev) {
  const haystack = `${ev.title}\n${ev.description}`;
  const people = [];
  const franchises = [];
  const rejected = [];

  for (const p of result.people ?? []) {
    if (typeof p?.name === 'string' && haystack.includes(p.name)) {
      people.push({ name: p.name, role: ROLES.includes(p.role) ? p.role : 'other' });
    } else {
      rejected.push({ kind: 'person', value: p?.name ?? null, reason: 'not-verbatim' });
    }
  }

  for (const f of result.franchises ?? []) {
    if (typeof f?.surface_text === 'string' && haystack.includes(f.surface_text)) {
      franchises.push({ surface_text: f.surface_text, canonical: f.canonical ?? 'other' });
    } else {
      rejected.push({ kind: 'franchise', value: f?.surface_text ?? null, reason: 'not-verbatim' });
    }
  }

  return { people, franchises, rejected };
}

/** Description content hash — a live description whose hash drifts from the
 *  compiled one is treated at join time like an absent entry (U4's degrade rule). */
async function hashDescription(text) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

async function merge() {
  const state = await loadState();
  const { targets, seed } = await loadInputs();
  const byUid = new Map(targets.map((e) => [e.uid, e]));
  const api = client();

  // Aliases are hand-maintained corrections; they are applied LAST and a rerun
  // must never clobber them.
  const aliasPath = new URL('data/aliases.json', ROOT);
  const aliases = existsSync(aliasPath) ? await readJson(aliasPath) : { franchises: {}, people: {} };
  const aliasMap = new Map(Object.entries(aliases.franchises ?? {}).map(([k, v]) => [k.toLowerCase(), v]));

  const entries = {};
  const reviewBucket = [];
  const stats = { succeeded: 0, errored: 0, expired: 0, canceled: 0, rejectedSpans: 0, people: 0, franchises: 0, other: 0 };
  const erroredIds = [];

  // Results arrive in ANY order — key by custom_id, never by position.
  for await (const r of await api.messages.batches.results(state.batchId)) {
    const ev = byUid.get(r.custom_id);
    if (!ev) continue;

    if (r.result.type !== 'succeeded') {
      stats[r.result.type] = (stats[r.result.type] ?? 0) + 1;
      erroredIds.push(r.custom_id);
      entries[r.custom_id] = { status: r.result.type, people: [], franchises: [] };
      continue;
    }
    stats.succeeded++;

    const block = r.result.message.content.find((b) => b.type === 'text');
    let parsed;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      erroredIds.push(r.custom_id);
      entries[r.custom_id] = { status: 'unparseable', people: [], franchises: [] };
      continue;
    }

    const { people, franchises, rejected } = validateEntry(parsed, ev);
    stats.rejectedSpans += rejected.length;
    if (rejected.length) reviewBucket.push({ uid: r.custom_id, title: ev.title, rejected });

    // Alias overrides applied last — surface text wins a canonical id even when
    // the model bucketed it as `other`.
    const resolved = franchises.map((f) => {
      const alias = aliasMap.get(f.surface_text.toLowerCase());
      return alias ? { ...f, canonical: alias } : f;
    });
    for (const f of resolved) if (f.canonical === 'other') stats.other++;

    stats.people += people.length;
    stats.franchises += resolved.length;

    entries[r.custom_id] = {
      status: 'ok',
      description_hash: await hashDescription(ev.description),
      // Explicit empty arrays: absence of a UID means "not yet enriched",
      // an empty array means "processed, nothing found". Different states.
      people,
      franchises: resolved,
    };
  }

  // Deterministic serialization — the index is reviewed as a git diff, so key
  // order must be stable across reruns or every recompile looks like a rewrite.
  const sortedEntries = {};
  for (const uid of Object.keys(entries).sort()) sortedEntries[uid] = entries[uid];

  const index = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    provenance: {
      model: state.model,
      batch_id: state.batchId,
      franchise_seed_version: seed.schema_version,
      system_prompt_sha: await hashDescription(SYSTEM),
      event_count: Object.keys(sortedEntries).length,
    },
    entries: sortedEntries,
  };

  await writeJson(new URL('data/enrichment.json', ROOT), index);

  if (reviewBucket.length) {
    await writeJson(new URL('data/review-bucket.json', ROOT), reviewBucket);
  }

  console.log('\n=== MERGE COMPLETE ===');
  console.log(`entries written: ${Object.keys(sortedEntries).length}`);
  console.log(`succeeded=${stats.succeeded} errored=${stats.errored} expired=${stats.expired} canceled=${stats.canceled}`);
  console.log(`people extracted: ${stats.people}`);
  console.log(`franchises extracted: ${stats.franchises} (${stats.other} bucketed as "other")`);
  console.log(`spans rejected as non-verbatim: ${stats.rejectedSpans}`);
  if (reviewBucket.length) console.log(`review bucket: ${reviewBucket.length} events -> data/review-bucket.json`);
  if (erroredIds.length) {
    await writeJson(new URL('data/.batch-retry.json', ROOT), erroredIds);
    console.log(`failed custom_ids -> data/.batch-retry.json (${erroredIds.length})`);
  }
  console.log('\nCoverage:');
  const withPeople = Object.values(sortedEntries).filter((e) => e.people?.length).length;
  const withFranchise = Object.values(sortedEntries).filter((e) => e.franchises?.length).length;
  const n = Object.keys(sortedEntries).length;
  console.log(`  events with >=1 person:    ${withPeople} (${((withPeople / n) * 100).toFixed(1)}%)`);
  console.log(`  events with >=1 franchise: ${withFranchise} (${((withFranchise / n) * 100).toFixed(1)}%)`);
}

// ---------- run (submit + wait + merge) ----------

async function run() {
  await submit();
  console.log('\nWaiting for batch to complete (checking every 60s)...');
  for (;;) {
    await new Promise((r) => setTimeout(r, 60_000));
    const batch = await poll({ quiet: true });
    const c = batch.request_counts;
    console.log(`  [${new Date().toISOString().slice(11, 19)}] ${batch.processing_status} — succeeded=${c.succeeded} processing=${c.processing} errored=${c.errored}`);
    if (batch.processing_status === 'ended') break;
  }
  await merge();
}

// ---------- dispatch ----------

const cmd = process.argv[2];
const commands = { submit, poll, merge, run };
if (!commands[cmd]) {
  console.error(`Usage: node --env-file=.env scripts/enrich.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
await commands[cmd]();
