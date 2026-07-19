---
title: "feat: Entity map replaces the ego graph"
type: feat
status: completed
date: 2026-07-19
origin: docs/brainstorms/2026-07-19-entity-map-graph-requirements.md
---

# feat: Entity Map Replaces the Ego Graph

## Overview

Replace the shipped ego-network graph (parent plan U6) with a bipartite event↔entity map: entities as sized hubs, events as small dots, one link per event-entity pair, the active filter as the only scope. Delete the seed model outright. Add the app's first event-detail surface — a card shared by the graph and the 5-day list, showing the description.

This plan supersedes U6 of `docs/plans/2026-07-17-001-feat-relatedness-graph-app-plan.md` (built and shipped as designed; its model is what's being replaced) and shrinks parent U9's brief by the legibility work R13 pulls forward.

---

## Problem Frame

Measured against the real corpus, the ego model failed at its own job: shared entities become cliques (Comics+IP: 659 links, one 256-node component, 215 isolates), multi-entity events weld clusters together, and the seed-prompt interaction confused its one user. The bipartite spike proved the alternative shape works and Roger chose it: replace, don't add. Full decision record in the origin doc (see origin: docs/brainstorms/2026-07-19-entity-map-graph-requirements.md).

---

## Requirements Trace

Carried verbatim from the origin doc:

- R1. Single bipartite map; ego view, seed state, and seed prompt deleted, not kept as a mode.
- R2. Active filter is the map's scope; no graph-local scope control.
- R3. Lenses one-at-a-time; event dots persist with object constancy across switches, hubs swap.
- R4. Single-appearance entities (per current scope) are never drawn as hubs.
- R5. Hub-less events gather as a dim fringe halo at the rim — present, hoverable, never hidden.
- R6. Hover previews neighbourhoods (light up + dim), transient.
- R7. Click pins the hover state and opens a card; background click dismisses.
- R8. Entity card: name, in-scope count, event list — starrable and clickable per row.
- R9. Event card: title, time, room, star control, description.
- R10. Starring from the map writes the same spine state as the list; encodings identical in both views.
- R11. The event card is one component serving both views; list rows open it too.
- R12. Label size/visibility scale continuously with entity degree; no binary threshold.
- R13. Hover/pin dimming and halo ship now; community-coloured edges, glow, motion polish stay in parent U9.

**Origin acceptance examples:** AE1 (covers R1, R2), AE2 (covers R1), AE3 (covers R6, R8), AE4 (covers R3), AE5 (covers R2), AE6 (covers R11).

---

## Scope Boundaries

- No composed lenses; no min-entity-size knob or scope checkbox in the UI; no drill-down/re-scope on entity click (all rejected in origin).
- No visual work beyond R12/R13's legibility line — parent U9 keeps community-coloured edges, palette, glow, and motion.
- Chat (parent U8), `.ics` export, filters, and the 5-day view's row/virtualizer machinery are untouched; the list changes only by hosting the card (R11).
- No new IPC and no main-process changes: descriptions already ride the `DatasetProjection`.

### Deferred to Follow-Up Work

- Parent-plan edits marking U6 superseded and U9 shrunk land with U7 of this plan, not as a separate pass.

---

## Context & Research

### Relevant Code and Patterns

- `src/shared/graph/bipartite.ts` — spike pure layer; becomes the real builder (options collapse per R2/R4/R5).
- `src/shared/graph/lensIndex.ts` — survives unchanged; the map is built from `LensIndex`.
- `src/shared/graph/ego.ts` — deleted at the end (`expandEgo`, `linksWithin`, `fringeUids`, `specificity`); `degreesByLens`/`degreeFor` in lensIndex.ts die with the zero-edge escape hatch.
- `src/renderer/src/views/graph/useNodeCache.ts` — the object-constancy contract (Map outliving renders, in-place mutation, spawn-near-neighbour). Generalizes to two node kinds; this file's header comment is the spec.
- `src/renderer/src/views/graph/paint.ts` — palette + event encodings (star ring, cancelled strike, change dot) reused verbatim for event dots; `withAlpha` helper for dimming.
- `src/renderer/src/views/graph/EdgeInspector.tsx` — deleted (hubs make edges self-explanatory), but its docked-panel pattern (absolute, stopPropagation, canvas stays live) is the card's template.
- `src/renderer/src/state/useGraph.ts` — layers 1–2 (records, lens indexes) survive as the map's input; layers 3–4 (ego, links) are replaced.
- `src/renderer/src/state/useSchedule.ts` — `filteredUids` (identity-stable since `1900183`) is the scope input.
- `src/renderer/src/views/schedule/EventRow.tsx` / `ScheduleView.tsx` — row click currently toggles `selectedUid` only; the card hooks into that existing selection, no new row plumbing.
- Test conventions: `src/renderer/src/views/graph/__tests__/GraphView.test.tsx` (force-graph mocked, `sizeTheDom()` ResizeObserver stub, synthetic `@data/enrichment.json`), `src/renderer/src/state/__tests__/useGraph.test.tsx` (spine + hook harness, echo-back star stubs).

### Institutional Learnings

- `docs/solutions/2026-07-18-uid-is-the-identity-key.md` — UID keys the node cache (named explicitly as one of the five UID-keyed subsystems). Events can vanish from the feed with no CANCELLED flag, so any surface keyed by UID — the card above all — must tolerate a UID that resolves to nothing. Sched's editorial flags are not change signals; the card shows diff-engine states only (already true of `buildRow`).

### External References

- None used — local patterns cover the work; the halo force is a documented d3-force API already accessible through the shipped force-graph integration.

---

## Key Technical Decisions

- **Event node ids keep the `event:` prefix; entity ids are already lens-namespaced.** One id space on the canvas, no collisions, and the event-node id is stable across lens switches — which is what makes R3's constancy free.
- **The card keys off `selectedUid`; entity pins are graph-local state.** Entities aren't spine UIDs; putting them in the spine would grow its contract for one view's transient state. Event selection is already cross-view — the card inherits R11 for free.
- **Pin precedence is mutual exclusion, and "card open = pinned" is the single rule.** Pinning an entity clears `selectedUid`; selecting an event clears the entity pin. A `selectedUid` arriving from the list opens on the map as a full pin — dimming applied — never as a card floating over an undimmed graph. Clicking a row inside EntityCard replaces the entity pin with that event's pin (the card swaps; background click still dismisses whatever is pinned).
- **Hover while pinned is override-and-revert.** Hovering another node temporarily previews its neighbourhood; mouse-out restores the pinned state. This keeps the pin-one-hub-then-compare-neighbours exploration loop alive without a mode.
- **A pinned entity that vanishes on lens switch dismisses cleanly.** Hubs swap wholesale under R3, so an entity pin whose hub is absent under the new lens clears itself — card and pin together, never a frozen card describing a hub that is no longer drawn.
- **Halo via a radial force on zero-degree events, not pinned positions.** A pinned ring fights the simulation and hard-codes a radius; a weak `forceRadial` scoped to fringe nodes lets the core push outward naturally and keeps fringe dots hoverable like everything else. `forceRadial` is a constructor react-force-graph-2d does not export — `d3-force` (+ types) becomes a direct dependency (it is already in the tree transitively via force-graph; declaring it pins the same code with types rather than deep-importing an undeclared transitive).
- **Hubs spawn at the centroid of their member events.** Generalizes `spawnNear`: a hub entering on lens switch eases out from where its cluster already sits instead of streaking in from the origin (AE4).
- **Re-fit on scope change only, never on lens switch — and it executes on engine stop, not on a timer.** `nodesChanged` splits: filter edits change the event population (arm a re-fit); lens switches swap only hubs (no re-fit — the reorganization is the point, per R3). The armed fit fires on `onEngineStop`, replacing GraphView's fixed 420ms/650ms timers: the spike established that at map scale the settle outlasts any fixed delay, and fitting early frames a shape still flying apart. The MAX_ZOOM clamp survives, applied after the fit.
- **Fixed pruning at scope-degree ≥ 2 (R4), no knob.** The spike's threshold control existed to make this judgment; the judgment is made.

---

## Open Questions

### Resolved During Planning

- Halo mechanics: radial force, not pinned ring (see decisions).
- Hub transition: centroid spawn + no exit animation — canvas repaints, removed objects simply stop being drawn.
- Whole-schedule performance: stepped simulation params by node count (spike's −14/−40 charge split is the starting point), zoom-gated label painting, bounded cooldown. AE5's bar is navigable, not gorgeous.
- Card placement: one docked component, `EdgeInspector` pattern, hosted per-view.

### Deferred to Implementation

- Label-size curve in degree (sqrt vs. log) and exact force numbers: feel decisions against the live corpus, per the parent plan's convention that force tuning is judged by hand.
- Whether the halo needs its own radius adaptation as filters shrink the core, or one radius reads fine at all scales.
- Card max-height/scroll behavior for long descriptions — judged with real Sched prose on screen.

---

## Implementation Units

- U1. **Bipartite pure layer, finalized**

**Goal:** Turn the spike's builder into the real one: fixed R4 pruning, halo membership as first-class output, per-node degrees for R12 labels.

**Requirements:** R1, R2 (scope input contract), R4, R5

**Dependencies:** None

**Files:**
- Modify: `src/shared/graph/bipartite.ts`, `src/shared/graph/index.ts`
- Test: `src/shared/graph/__tests__/bipartite.test.ts` (create)

**Approach:**
- Drop `minEntityDegree`/`includeIsolatedEvents` options; scope-degree ≥ 2 is the rule, and hub-less in-scope events are always returned, marked as fringe rather than dropped or optional.
- Node model carries `kind`, `degree`, and fringe membership; entity degree counted against scope (already true in the spike — keep it and test it).
- Delete the spike-era header comment; this is now load-bearing code.

**Execution note:** Test-first — the shared layer is the tested layer by repo convention, and the spike shipped untested by design.

**Patterns to follow:** `src/shared/graph/lensIndex.ts` for shape and doc style; fixtures in `src/shared/graph/__tests__/fixtures.ts`.

**Test scenarios:**
- Happy path: entity on 3 in-scope events → one hub node (degree 3) + 3 links; events carry their entity counts.
- Happy path (Covers AE2): event with 3 entities → one event node, 3 links, never duplicated.
- Edge case (R4): entity with 5 corpus events but 1 in scope → no hub; its event joins the fringe if nothing else claims it.
- Edge case (Covers AE1): fringe accounting — in-scope events with no surviving hub are returned marked fringe; connected + fringe = scope size exactly.
- Edge case: empty scope → empty graph, no throw; scope with zero qualifying entities → all events fringe.
- Edge case: same entity id from overlapping records → one hub, deduped links, first-spelling label (mirrors lensIndex contract).

**Verification:** Builder output over the Comics fixture slice reproduces the spike's measured shape (~94 hubs / 271 connected / 215 fringe at current data) with fringe events present rather than hidden.

---

- U2. **State: seed dies, the map's view model replaces useGraph**

**Goal:** Build the map's view model: a `useEntityMap` hook that joins the bipartite builder to schedule state (titles, star/change states, selection), landing alongside `useGraph` — the ego hook and the spine's seed state stay untouched until U5/U7 remove their consumers.

**Requirements:** R1, R2, R3, R10

**Dependencies:** U1

**Files:**
- Create: `src/renderer/src/state/useEntityMap.ts` (replaces `src/renderer/src/state/useGraph.ts`, which is deleted in U7 along with the spine's seed fields)
- Test: `src/renderer/src/state/__tests__/useEntityMap.test.tsx` (replaces `useGraph.test.tsx`, deleted in U7)

**Approach:**
- Keep useGraph's layers 1–2 verbatim (records from dataset + enrichment, `buildLensIndexes` once per dataset); layer 3 becomes `buildBipartite(index, filteredUids)`.
- Event node models reuse `buildRow` outputs so star/change/cancelled states mean exactly what the list means (R10 / parent AE4).
- Every derived array must be identity-stable when inputs haven't changed — the `filteredUids` regression (`1900183`) is the cautionary tale; its `toBe` test pattern is the enforcement tool.
- U2 is purely additive: `useEntityMap` lands alongside `useGraph`, and the spine keeps `seed`/`setSeed`/`GraphSeed` untouched until their consumers die — GraphView stops reading them in U5, and the fields plus `useGraph` itself are deleted in U7's sweep. Deleting them here would break typecheck for three units straight, which is exactly the broken-intermediate-tree state U7's sequencing rule forbids.

**Patterns to follow:** `src/renderer/src/state/useGraph.ts` layer ordering and memo discipline; `src/renderer/src/state/__tests__/useGraph.test.tsx` harness (synthetic enrichment mock, spine wrapper).

**Test scenarios:**
- Happy path: Comics-like fixture filter → model contains hubs + events + fringe from U1, with titles resolved and starred states correct.
- Happy path (Covers AE4): lens switch ip→people → event node models keep identity-relevant keys; hub set swaps; no scope change.
- Happy path (Covers AE5): empty filter → model spans the full fixture corpus.
- Edge case: filter matching zero events → empty model, no throw. (The graph view owns its own one-line empty state per U5 — the list's ZeroResults is not visible from the graph.)
- Integration (Covers AE3 partially, R10): starring a uid through the spine updates the map model's starred flag and the list's row state in the same render pass.
- Regression: model arrays are `toBe`-stable across unrelated state changes (hover/selection).

**Verification:** New hook tests green with the full suite still passing — U2 adds, it does not yet delete, so the tree stays green at the unit boundary.

---

- U3. **Node cache generalized to two node kinds**

**Goal:** Extend the object-constancy cache to entity + event nodes: in-place mutation, centroid spawning for hubs, and the re-fit signal split (scope change vs. lens switch).

**Requirements:** R3, plus AE4's no-restart contract

**Dependencies:** U2

**Files:**
- Modify: `src/renderer/src/views/graph/useNodeCache.ts`
- Test: `src/renderer/src/views/graph/__tests__/useNodeCache.test.tsx`

**Approach:**
- Cache keys are node ids (`event:` prefix / entity id), so event objects survive lens switches untouched — position, velocity, everything.
- New hubs spawn at the centroid of their member events' current positions (fall back to spawn-near for hubs whose events are all new).
- `nodesChanged` becomes scope-sensitive: true when the event population changed, false when only hubs swapped — this is the "re-fit on scope change only" decision made mechanical.
- Pinning logic (single-seed fx/fy) is deleted with the seed model.

**Patterns to follow:** The file's own header comment is the contract; extend it, don't dilute it.

**Test scenarios:**
- Happy path (Covers AE4): same scope, lens switch → every surviving event object is `toBe`-identical; hub objects for the old lens are gone; `nodesChanged` false.
- Happy path: filter narrows → removed events dropped from cache, `nodesChanged` true.
- Edge case: hub entering when its events have positions → spawns within their bounding region, not at origin.
- Edge case: refresh removes a uid mid-session → cache drops it without disturbing survivors (mirrors the existing useGraph survivor test).

**Verification:** Existing useNodeCache tests adapted and green; the lens-switch identity test is the load-bearing one.

---

- U4. **The card family: shared EventCard, graph-only EntityCard**

**Goal:** Build the docked detail surface — the app's first place a description is readable (R9), shared by both views (R11), with the entity list variant for hubs (R8).

**Requirements:** R7 (dismissal contract), R8, R9, R10, R11

**Dependencies:** None (component-level; consumes existing derive/spine types)

**Files:**
- Create: `src/renderer/src/components/EventCard.tsx`, `src/renderer/src/components/EntityCard.tsx`
- Test: `src/renderer/src/components/__tests__/EventCard.test.tsx`, `src/renderer/src/components/__tests__/EntityCard.test.tsx`

**Approach:**
- Docked panel per the EdgeInspector pattern: absolute-positioned inside the hosting view, `stopPropagation`, host stays live behind it. Hosts mount it; the card never portals.
- EventCard: title, time, room, star control (spine `toggleStar`), change badges from `buildRow` states (never Sched flags), description as scrollable prose.
- Vanished-UID tolerance (institutional learning): a selectedUid absent from the dataset renders from the star record's ghost snapshot when starred, and dismisses otherwise — never throws, never shows a blank shell.
- EntityCard: label, in-scope count, member events as rows (time + title + star), row click re-pins that event (host provides the callback; per the pin-precedence decision, this swaps the dock to that event's card). The row list gets a max-height with internal scrolling — top hubs at whole corpus carry dozens of member events, and an unbounded list would push past the docked panel's edge.
- Descriptions are Sched prose rendered from local data only — nothing here writes, exports, or fixtures them.

**Patterns to follow:** `src/renderer/src/views/graph/EdgeInspector.tsx` (docked shell, dismissal); `src/renderer/src/views/schedule/EventRow.tsx` (StateBadge, StarButton usage).

**Test scenarios:**
- Happy path (Covers AE6 partially): render with a full event → title, time, room, description visible; star toggle calls through and reflects echo-back.
- Happy path (Covers AE3): EntityCard lists member events; starring a row updates without dismissing the card; clicking a row fires the re-pin callback.
- Edge case: empty description → card renders without an empty prose region (no dangling section).
- Edge case: starred uid vanished from dataset → ghost render from snapshot fields, visually marked as no longer live.
- Error path: unstarred uid vanished → card dismisses (host callback), no throw.
- Integration (R10): star from card → spine list state reflects it (same harness as useGraph's cross-view star test).

**Verification:** Cards render standalone under the jsdom harness with the stubbed bridge; both AE-linked scenarios pass.

---

- U5. **The map view: GraphView rewritten around the entity map**

**Goal:** Replace GraphView's ego internals with the map: bipartite render, halo force, continuous labels, hover/pin dimming, event encodings, card hosting. Delete the spike, the seed prompt, and the edge inspector.

**Requirements:** R1, R2, R3, R5, R6, R7, R12, R13; AE1, AE2, AE5

**Dependencies:** U1, U2, U3, U4

**Files:**
- Modify: `src/renderer/src/views/graph/GraphView.tsx`, `src/renderer/src/views/graph/paint.ts`, `package.json` (add `d3-force` + types for the halo's `forceRadial`). GraphView stops consuming `seed` here, but the spine fields themselves wait for U7 — `useGraph.ts` still reads them until its deletion.
- Delete: `src/renderer/src/views/graph/BipartiteSpike.tsx`, `src/renderer/src/views/graph/SeedPrompt.tsx`, `src/renderer/src/views/graph/EdgeInspector.tsx`
- Test: `src/renderer/src/views/graph/__tests__/GraphView.test.tsx` (rewrite)

**Approach:**
- Toolbar: LensSelector survives (degrees column dies with `degreesByLens`); Ego/Entities toggle, Expand/Collapse, Clear, seed strip all deleted.
- Painters extend `paint.ts`: entity hubs sized by degree with labels by R12's continuous rule, event dots at spike scale but carrying the full encoding set — star ring, cancelled strike, change dot — via the existing helpers (R10). Hubs carry the painter's *existing* shadowBlur glow (the shipped Observatory base treatment) unchanged; designing a new glow treatment is U9's brief per R13 — this unit scales size, not light.
- Hover = transient light-up/dim (spike behavior, kept); click = pin + card (EventCard/EntityCard from U4); background click clears pin and card together (R7).
- Halo: weak radial force registered through the force accessor, applied to fringe nodes only; fringe dots stay dim per R5 but hover/tooltip like everything else.
- Simulation params stepped by node count; `useSize` callback-ref hook and the canvas-mount regression test survive as-is.
- A scope with events but zero qualifying hubs (narrow filter, lens-sparse track) is a designed state, not an accident: the all-fringe map renders with an overlay naming which lenses *do* produce hubs for this scope — a cheap per-lens hub count over the already-built indexes, replacing the deleted `degreesByLens` escape hatch at map level ("No IP hubs here — People has 12").
- Keep the `min-h-0` flex chain and zoom-clamp lessons from the shipped view.

**Execution note:** Rendering is feel-tested by convention; the tests below cover the chrome and mount logic, not force behavior.

**Patterns to follow:** Current `GraphView.tsx` structure (toolbar/canvas/overlay layering, engine ref); spike's dimming approach; `sizeTheDom()` harness.

**Test scenarios:**
- Happy path (Covers AE1): mounts directly to the map — no seed prompt, no empty-state gate; canvas appears once sized (regression test adapted, still asserting the canvas mounts).
- Happy path (Covers AE3): clicking an entity node pins and shows EntityCard; background click dismisses card and pin.
- Happy path: clicking an event node sets `selectedUid` and shows EventCard; pinning an entity afterwards clears `selectedUid` (mutual exclusion — one card at a time).
- Edge case (Covers AE4): lens switch with an entity pinned whose hub is absent under the new lens → pin and card dismiss cleanly.
- Edge case: arriving at the graph with a `selectedUid` set from the list → EventCard opens as a full pin with neighbourhood dimming applied, not a card over an undimmed map.
- Edge case: scope with events but zero hubs → all-fringe map plus the lens-escape overlay, naming a lens with hubs when one exists.
- Edge case (Covers AE5): whole-corpus fixture → renders without throwing; node count reported in toolbar matches scope.
- Edge case: filter → zero events → empty canvas state with a one-line explanation, not a crash or a stale map.
- Integration (R2): changing the filter re-derives the map — no local scope state anywhere in the view.

**Verification:** Manual feel pass against live data on both the Comics slice and the unfiltered corpus (AE5's navigable bar); all chrome tests green; deleted files gone from the tree.

---

- U6. **The list learns the card**

**Goal:** Clicking a row opens the shared EventCard over the 5-day view (AE6) — same component, same selection state, no new plumbing.

**Requirements:** R11; AE6

**Dependencies:** U4

**Files:**
- Modify: `src/renderer/src/views/schedule/ScheduleView.tsx`
- Test: `src/renderer/src/views/schedule/__tests__/ScheduleView.test.tsx` (create; harness per `src/renderer/src/__tests__/App.integration.test.tsx`, which is where the list's integration coverage actually lives)

**Approach:**
- Row click already toggles `selectedUid`; ScheduleView mounts EventCard when it's set, docked over the scroll region. Deselect (click again / background per R7) dismisses.
- Ambient-shelf and ghost-band selection paths get the card for free by sharing `selectedUid`.

**Test scenarios:**
- Happy path (Covers AE6): click a row → card shows that event's title and description; click again → card gone.
- Edge case: selection set from the graph view survives the view toggle → list shows the card for the same uid (R10's shared-spine contract).
- Integration: starring from the card updates the row's star state in place.

**Verification:** Existing `App.integration.test.tsx` scenarios covering the list stay green alongside the new ScheduleView tests — the virtualizer path is untouched.

---

- U7. **Sweep and record**

**Goal:** Delete the orphaned ego layer, align the docs: parent plan supersession notes, README graph section, solutions entries for the learnings this work surfaced.

**Requirements:** R1 (the deletion half); housekeeping for everything above

**Dependencies:** U5, U6

**Files:**
- Delete: `src/shared/graph/ego.ts`, `src/shared/graph/__tests__/ego.test.ts`, `src/renderer/src/state/useGraph.ts`, `src/renderer/src/state/__tests__/useGraph.test.tsx`
- Modify: `src/renderer/src/state/spine.tsx` (delete `seed`/`setSeed`/`GraphSeed` — their last reader dies with `useGraph.ts` in this unit), `src/shared/graph/index.ts`, `src/shared/graph/types.ts` (drop `GraphLink`), `src/shared/graph/lensIndex.ts` (drop `degreeFor`/`degreesByLens`), `docs/plans/2026-07-17-001-feat-relatedness-graph-app-plan.md` (U6 superseded → this plan; U9 brief shrunk per R13), `README.md`
- Create: `docs/solutions/` entries — the memo-identity lesson (`filteredUids`) and the jsdom/canvas test conventions, both flagged as unwritten by the learnings search

**Approach:** Deletion after both consumers land so the tree never holds a broken intermediate state; typecheck is the orphan detector.

**Test scenarios:**
- Test expectation: none — deletion and docs. The suite passing after removal is the test.

**Verification:** Full suite green; typecheck clean; no source file references `expandEgo`, `GraphSeed`, or `SeedPrompt`; parent plan's U6 carries a dated supersession note pointing here.

---

## System-Wide Impact

- **Interaction graph:** The spine loses `seed` — the compiler surfaces every consumer. `selectedUid` gains a second reader (the card) in both views; its toggle semantics (`click again = deselect`) become the card's dismissal path, so changing them later breaks two surfaces.
- **Error propagation:** A vanished UID must degrade at the card (ghost or dismiss), never throw — same contract the ghost band already honors.
- **State lifecycle risks:** The node cache holds mutable objects across renders; the two-kind generalization must preserve the in-place-mutation rule or lens switches restart the layout (the exact class of bug fixed in `1900183`).
- **API surface parity:** Star/change encodings now render in three places (list row, map dot, card badges) — all three read `buildRow`-derived state, none read Sched flags.
- **Integration coverage:** Cross-view scenarios (star from card → row updates; select in graph → card in list) are asserted in U4/U6 through the real spine, not mocks.
- **Unchanged invariants:** Filter engine, enrichment compile, snapshot/diff, stars persistence, `.ics` export, and all main-process code are untouched. `LensIndex` remains the graph's substrate — only what's built from it changes.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Whole-corpus map (~3,955 nodes: 3,474 events + ~481 hubs, fringe always drawn per R5) too slow to feel navigable (AE5) | Stepped force params + zoom-gated labels are the tools, but the spike's 2,032-node proof *excluded* isolated events — the first whole-corpus feel pass validates ~40% beyond proven territory. Bar is explicitly "navigable, not gorgeous"; fallbacks in order: coarser param tier for the empty-filter state, then a cheaper paint path for fringe dots |
| Halo force fights cluster layout (fringe ring collapses inward or clusters get squeezed) | Radial force is weak and fringe-scoped; fallback is accepting force-natural fringe placement — R5 requires presence, not a perfect ring |
| Deleting seed breaks an untracked consumer | `seed` is typed spine state — typecheck enumerates consumers exhaustively (verified: 10 files reference the ego symbols, all named in this plan) |
| Card over canvas swallows drag/zoom gestures near the dock | EdgeInspector already solved this (stopPropagation + bounded panel); reuse, don't reinvent |
| Continuous labels still collide in the dense core at low zoom | R12 scales visibility with degree too — low-degree labels wait for zoom; exact curve is a deferred feel decision with a cheap iteration loop |

---

## Documentation / Operational Notes

- Parent plan U6/U9 edits and README's graph description land in U7.
- Two `docs/solutions/` entries owed (memo identity, canvas test harness) — written in U7 while fresh.
- No packaging, IPC, or data-pipeline impact; nothing new is committed under `data/`.

---

## Sources & References

- **Origin document:** docs/brainstorms/2026-07-19-entity-map-graph-requirements.md
- **Superseded unit:** docs/plans/2026-07-17-001-feat-relatedness-graph-app-plan.md (U6; U9 brief shrunk)
- Related code: `src/shared/graph/`, `src/renderer/src/views/graph/`, `src/renderer/src/state/`
- Related commits: `cab468e` (spike), `1900183` (filteredUids identity), `8fa6443` (canvas-mount regression)
- Institutional learning: docs/solutions/2026-07-18-uid-is-the-identity-key.md
