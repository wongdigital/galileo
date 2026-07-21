# CLAUDE.md

Galileo—an Electron app for browsing the San Diego Comic-Con program schedule. React 19,
TypeScript, Vite via electron-vite, Tailwind v4. AGPL-3.0.

## Commands

```sh
npm run dev        # launch the app
npm run typecheck  # tsc --build --force (run this, not `tsc` bare)
npm test           # vitest run
npm run lint       # eslint-plugin-jsx-a11y (strict) over renderer TSX — a11y gate only
npm run fetch      # pull today's schedule from Sched into data/
npm run build      # electron-vite build
```

Typecheck and tests both need to pass before anything is considered done.

## The data posture (read this first)

This repo ships **code and derived facts**. It never ships Sched's program data.

`data/events.json` and `data/meta.json` are Sched-authored prose and are gitignored. Each
instance fetches them at runtime and joins against the committed enrichment index. Do not
commit them, do not paste their contents into docs or commit messages, and do not add a
fixture built from live data outside `tests/fixtures/live/` (also gitignored). `.env` holds
the Anthropic key for the enrichment compile and is likewise gitignored.

What *is* committed under `data/` is the derived index and the hand-curated tables:
`enrichment.json` (extracted people and franchise ids), `facet-map.json`, `aliases.json`,
`franchise-seed.json`. These are facts about the schedule, not Sched's prose.

If a change makes it *convenient* to commit fetched data, the change is wrong. See README for
the full table of what is and isn't committed.

## Architecture

```
src/main/      Electron main process. All I/O lives here—fs, network, safeStorage, IPC handlers.
src/preload/   The bridge. Channel definitions only.
src/renderer/  React app. Sandboxed; never gets node or fs access.
src/shared/    Pure logic, imported by all three.
```

**`src/shared/` is pure.** No `node:` imports, no `electron` imports, no React, no I/O. This
is the constraint that keeps the renderer's sandbox from ever needing to be relaxed, and it's
what makes the schedule/filter/graph logic testable without a browser or an Electron host.
The `npm run fetch` CLI is a thin wrapper over `src/shared/schedule/`, so the CLI and the app
cannot drift.

LLM API keys live in main behind `safeStorage` and never cross to the renderer.

Both tsconfigs run `strict` plus `noUncheckedIndexedAccess`—indexed access yields `T |
undefined`, so expect to narrow or `!` deliberately rather than by habit.

## Testing

Tests colocate in `__tests__/` beside what they test; the suite globs
`src/{shared,main,renderer}/**/__tests__/**/*.test.{ts,tsx}`. The root `tests/` directory
holds fixtures only.

The default environment is **node**, not jsdom. The pure layer needs no DOM and the suite
shouldn't pay for one. Files that genuinely need a DOM opt in per file with a
`// @vitest-environment jsdom` docblock.

**Modules that import `electron` stay out of the suite.** Main-process code that needs an
Electron API takes it as a structural interface parameter instead—`SafeStorage` in
`src/main/llm/keyStore.ts`, `LlmIpcHost` in `src/main/llm/ipc.ts`. The logic is then testable
with a plain object and no Electron host. Follow that pattern rather than reaching for a
module mock of `electron`.

Canvas views are tested by stubbing the renderer and asserting the contract around it, not
the pixels—see `docs/solutions/2026-07-19-testing-a-canvas-view-in-jsdom.md`.

`npm run test:live` runs provider evals against a real API. It's gated twice, on `RUN_LIVE=1`
*and* a provider key, so `npm test` and CI never touch the network. It costs real money; run
it deliberately.

## Identity

`uid` (32-hex, from Sched) is the identity key for everything: the star store, the snapshot
diff, the unseen-change log, graph nodes, and exported ICS entries. `shortId` builds the
public URL and is not an identity. Sched UIDs survive edits; this was verified, not assumed—
see `docs/solutions/2026-07-18-uid-is-the-identity-key.md`.

## Docs

```
docs/solutions/    what past problems taught us—bugs, decisions, conventions
docs/plans/        implementation plans, YYYY-MM-DD-NNN-<type>-<slug>-plan.md
docs/brainstorms/  requirements documents that precede plans
```

`docs/solutions/` is the knowledge store, and it's worth searching before debugging or making
a decision in an area it covers. Flat directory, one file per learning, named
`YYYY-MM-DD-<slug>.md`, with frontmatter:

```yaml
---
title: "..."
type: bug | decision | convention
date: YYYY-MM-DD
unit: U8                 # the plan's implementation unit, when it maps to one
requirements: [R14, R15] # the brainstorm's requirement ids
---
```

Plans are decision artifacts. Don't edit a plan body to record execution progress—progress
lives in git.

## Commits

Conventional commits with a scope naming the subsystem: `feat(chat):`, `fix(graph):`,
`test(chat):`, `chore:`. Subject lines describe what changed for a reader, not which files
moved.

## Accessibility

Follow strictly the accessibility rules defined in the file: https://github.com/fecarrico/A11Y.md/blob/main/docs/en/A11Y.md

Target profile: **Standard (AA)**. Decisions between conformant alternatives are logged in
`docs/A11Y-DECISIONS.md`; deliberate relaxations (with mitigations) in `docs/EXCEPTIONS.md`.

## Gotchas

- Vite is pinned to `^7` and `@vitejs/plugin-react` to `^5`. electron-vite 5 peers Vite ≤7
  while current defaults resolve Vite 8. Don't "helpfully" unpin them.
- The app diffs its own snapshots rather than trusting Sched's `NEW`/`UPDATED`/`CANCELLED`
  flags—those are static editorial annotation, not a change feed. Measured: flag counts held
  byte-identical across 31 hours while nine events changed underneath them.
- Electron's `userData` directory follows the package name. Renaming the app orphans the star
  store and the encrypted key file.
- `npm run enrich` fires a real Anthropic batch—roughly $4–5 and well under an hour per full
  run. It is a maintainer runbook step, not part of a normal build. Only people and franchises
  come from the LLM; event classes, offering clusters, and facets are computed at runtime in
  `src/shared/enrichment/` and need no compile step. Runbook and review checklist: README.
