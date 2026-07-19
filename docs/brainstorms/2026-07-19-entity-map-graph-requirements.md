---
date: 2026-07-19
topic: entity-map-graph
---

# Entity Map: the Graph's Second Model

## Problem Frame

The shipped graph (U6) draws events only and connects two events when they share an entity. Measured against the real corpus, that model fails at its own job: a shared entity becomes a clique, a multi-entity event is one dot torn between clusters, and the Comics slice renders as a 256-node blob with 215 isolates rather than as legible structure. The seed-and-expand interaction confused its one user, and the ego view answers "what is like this event" but cannot answer the question Roger actually asked: "which programs is Mark Waid in?"

The bipartite spike (`src/shared/graph/bipartite.ts`, `src/renderer/src/views/graph/BipartiteSpike.tsx`) drew both kinds of thing — entities as sized hubs, events as small dots, one link per event-entity pair — and the picture worked. Roger's verdict after using it: this replaces the ego model.

This document records the decisions that turn the spike into the graph. It supersedes R5, and amends R6–R9, of `docs/brainstorms/2026-07-17-relatedness-graph-requirements.md`.

---

## Requirements

**The map**
- R1. The graph is a single bipartite map: entity hubs and event dots, one link per event-entity pair, no event-to-event edges. The ego view, its seed state, and the seed prompt are deleted, not kept as a mode.
- R2. The active filter is the map's scope. The graph draws exactly the filter's result set; no filter means the whole schedule. There is no graph-local scope control — the sidebar chips are the only scope authority, and the graph and the 5-day list always describe the same population.
- R3. Lenses stay one-at-a-time (amends R6 of the parent doc: same rule, new meaning). A lens decides which kind of hub exists. On switch, event dots persist with object constancy and re-cluster; hub dots swap. This is the R7 "constellation reorganizes" moment, restated for two node kinds: constancy applies to events, never to hubs.
- R4. Entities appearing on only one in-scope event are never drawn as hubs. Entity degree is computed against the current scope, not the corpus.

**Fringe honesty (amends R8)**
- R5. Events left with no drawn hub gather as a dim fringe halo at the map's rim — present, hoverable, never hidden. The full filtered population is always on the canvas; the halo is the visible answer to "what am I not seeing under this lens."

**Interaction**
- R6. Hover previews: an entity's events (or an event's entities) light up, everything else dims. Transient, no state.
- R7. Click pins: the hover state persists and a compact card opens. Background click dismisses both.
- R8. An entity's card shows its name, in-scope event count, and its events as a list — each row starrable in place and clickable to pin that event.
- R9. An event's card shows title, time, room, star control, and the event description.
- R10. Starring from the map writes the same spine state as starring in the list (parent R10/AE4 unchanged: star ring and change marks render identically in both views).

**The event detail card (shared surface)**
- R11. The event card is one component serving both views: clicking an event in the 5-day list opens the same card the map opens. This is the first surface in the app to show event descriptions.

**Legibility (this change, not U9)**
- R12. Label size and visibility scale continuously with entity degree — big hubs read from a distance, small hubs appear as you zoom. No binary show/hide threshold.
- R13. Hover/pin dimming and the halo treatment ship now. Community-coloured edges, glow refinement, and motion polish are deferred to U9. The dividing line: what's load-bearing for reading the map ships here; what makes it gorgeous waits.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given the Comics filter and the IP lens, the map shows ~94 franchise hubs and all 486 filtered events (271 connected, 215 in the halo) — and the sidebar count and the graph population agree.
- AE2. **Covers R1.** An event carrying Marvel, DC, and Star Wars is one dot with three links, sitting visibly between the three hubs — never duplicated, never welding clusters.
- AE3. **Covers R6, R8.** Hovering the Mark Waid hub under the People lens lights up his 8 in-scope programs; clicking pins them and lists them in a card where each can be starred without leaving the map.
- AE4. **Covers R3.** Switching IP → People over the same filter: event dots animate to new positions, franchise hubs disappear, people hubs appear. No re-seed, no scope change, no full re-layout from scratch.
- AE5. **Covers R2.** Clearing the last filter chip redraws the map over the whole schedule (~481 IP hubs, ~2,045 events at current data). Slow-but-navigable is acceptable; blank or frozen is not.
- AE6. **Covers R11.** Clicking a row in the 5-day list opens the same event card as clicking a dot on the map, description included.

---

## Success Criteria

- The Mark Waid question is answerable by pointing: find a person or franchise, see their programs, star from there — without a seed, a mode, or a view switch.
- The parent doc's bet gets a fair trial: during real con planning, Roger reaches for the map over the list at least some of the time.
- Planning can proceed without inventing behavior: every interaction on the map is specified above; what remains open is tuning and technique, listed below.

---

## Scope Boundaries

- No composed lenses (IP + People simultaneously). Revisit post-con if the one-at-a-time map creates the appetite.
- No community-coloured edges, palette work, or motion polish — that is U9's brief, now with a concrete surface to elevate.
- No min-entity-size knob or scope checkbox in the UI. The spike's controls were instruments for judging; the judged answers are R2 and R4.
- No drill-down/re-scope navigation on entity click (the "click narrows the map" model was considered and rejected — pin + card won).
- Chat (U8), .ics export, and the 5-day view are untouched except for R11's shared card.

---

## Key Decisions

- **Replace, don't add**: the entity map is the graph; ego is deleted. One mental model, and the seed-prompt confusion (old task #11) dissolves rather than getting patched.
- **Filter is the scope**: keeps R12's "chips are the single source of truth" and makes the graph and list two projections of one result set.
- **Parent R5 is reversed**: "never the whole corpus at once" dies with the ego view. An empty filter draws ~2,500 nodes; the spike proved it renders. The structural cap is replaced by a performance obligation (see planning questions).
- **Fringe halo over pruning**: R8's honesty rule applied to the new model, and the strongest visual idea in the inspo set (the patent-graph rim).
- **Legibility now, beauty later**: continuous label sizing is what makes the dense core readable at all — it is not polish.

---

## Dependencies / Assumptions

- Enrichment quality is what it is: hub structure inherits the compiled index's people/franchise extraction, including the review-bucket gaps. Genre and Offering lenses are deterministic and unaffected.
- Event descriptions (R9/R11) are Sched prose: displayable in-app from local data, never committed to the repo. The card must not create a new path for description text to leak into committed fixtures or exports.
- The spike's force-tuning observations carry forward: charge/link-distance must scale with node count or the whole-schedule map flies apart.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] Halo mechanics: pinned ring vs. letting weak radial force produce the rim naturally. The inspo look suggests a ring; the force-natural version may be cheaper and good enough.
- [Affects R3][Technical] Hub transition on lens switch: fade/swap in place vs. exit-enter animation, and whether hub positions seed from the centroid of their events.
- [Affects R2, AE5][Technical] Performance posture for the unfiltered map (~2,500 nodes, ~3,000 links): charge scaling numbers, cooldown budget, and whether label painting needs culling at low zoom.
- [Affects R11][Technical] Where the shared card lives and how the list invokes it (the list currently has no click-to-detail affordance at all).
- [Affects R12][Technical] The label-size curve (linear vs. sqrt vs. log in degree) — a feel decision to make against the real corpus, per the plan's existing convention on force-feel tuning.

---

## Next Steps

→ `/ce-plan` to amend `docs/plans/2026-07-17-001-feat-relatedness-graph-app-plan.md`: U6 is superseded by this model (the plan's U6 unit is built and shipped; this defines its replacement), U9's brief shrinks to what R13 defers, and the shared event card is a new small unit touching the 5-day view.
