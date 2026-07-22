---
date: 2026-07-22
topic: capacitor-ipad-port
---

# Capacitor iPad Port

## Problem Frame

Galileo is an Electron app, and Electron is desktop-only. Roger's real usage splits by
device: Mac at home for planning the con schedule, iPad at the con for browsing on the go
(hotspot or cached data on the floor). Today the iPad half of that workflow doesn't exist.

The port targets iPad first via Capacitor—wrapping the existing React renderer in a native
iOS shell—with a responsive phone pass (iPhone/Android) as a later phase. The architecture
work (platform bridge, shared-logic refactor, breakpoint system) is designed so the phone
phase is mostly layout work plus a build-target flip, not a second port.

There is no deadline. SDCC 2026 is this week and this project is explicitly not racing it.

---

## Key Flows

- F1. Con-floor browse (offline)
  - **Trigger:** Roger opens the app on the con floor with no usable network.
  - **Steps:** App launches from the last stored snapshot → browse, filter, and star events
    → staleness indicator shows when data was last fetched.
  - **Outcome:** Full browse/filter/star capability with zero network; no errors, no blocked UI.
  - **Covered by:** R6, R7, R8

- F2. Opportunistic refresh (hotspot)
  - **Trigger:** Roger gets connectivity and pulls to refresh (or taps refresh).
  - **Steps:** Device fetches Sched data directly via native HTTP → snapshot diff runs →
    drift warning and unseen-change flow behave as on desktop → failure mid-fetch leaves the
    prior snapshot intact.
  - **Outcome:** Fresh data when the network cooperates; unharmed cached data when it doesn't.
  - **Covered by:** R5, R6, R9

- F3. Export to Calendar
  - **Trigger:** Roger wants starred panels on the iPad's calendar.
  - **Steps:** Select events → export ICS → iOS share sheet opens → hand off to Calendar
    (or Files, AirDrop, etc.).
  - **Outcome:** Starred panels land in the device calendar without leaving the app.
  - **Covered by:** R10, R11

- F4. Chat on the go
  - **Trigger:** Roger asks the schedule chat a question from the floor (network required).
  - **Steps:** Key read from Keychain → chat request with streaming response → tool loop
    grounds answers in the synced dataset, as on desktop.
  - **Outcome:** Same chat capability as desktop; offline, chat degrades gracefully while the
    rest of the app keeps working.
  - **Covered by:** R7, R12, R15, R16

---

## Requirements

**Platform and architecture**
- R1. The iPad app is built with Capacitor inside the existing repo. The generated `ios/`
  Xcode project is committed (Pods and build products gitignored). No separate repo.
- R2. A second build target—a plain Vite web build of the renderer—exists alongside the
  electron-vite build. The Electron app remains buildable and shippable throughout the port.
- R3. The renderer talks only to a single platform-bridge interface (the current
  `window.api` shape). Two implementations: the existing Electron preload path and a new
  Capacitor/web path. Renderer code carries no platform conditionals beyond bridge selection
  and viewport breakpoints.
- R4. Platform-neutral logic currently in `src/main/` (LLM tool loop, snapshot
  drift-checking, ICS assembly) moves into `src/shared/` under its existing purity rule;
  `src/main/` shrinks to a thin Electron adapter with the same role as the Capacitor bridge.
- R5. Snapshot diffing, drift warning, and unseen-change acknowledgment behave identically
  to desktop—one shared implementation, not a mobile re-creation.

**Data posture and offline**
- R6. Each device fetches Sched data itself at runtime over native HTTP with the existing
  User-Agent. No hosted mirror, proxy, or relay of Sched program data—the repo's data
  posture (code and derived facts only) extends unchanged to mobile. Committed enrichment
  indexes ship in the app bundle.
- R7. The app is fully usable offline from the last stored snapshot: browse, filter, star,
  graph/related views, and ICS export all work with zero network. Refresh is opportunistic;
  chat is the only feature allowed to require connectivity.
- R8. Data staleness is visible: the UI shows when the current snapshot was last fetched.
- R9. A failed or interrupted fetch never corrupts or discards the prior snapshot.

**Feature parity**
- R10. V1 is full desktop parity: schedule browse and filtering, stars, the entity-map
  graph (viewport-gated per R14), chat, and ICS export. Nothing is left behind.
- R11. ICS export goes through the iOS share sheet, so Calendar is a first-class
  destination alongside Files/AirDrop.
- R12. Chat ships in v1 with parity: all three providers (Anthropic, OpenAI, OpenRouter),
  streaming, and the tool loop grounded in the synced dataset.

**Layout and orientation**
- R13. Both orientations are supported. The breakpoint system is designed for three tiers
  from the start (wide/landscape-iPad, medium/portrait-iPad, compact/phone), because the
  phone phase needs the same machinery. Portrait-tier polish may trail landscape, but
  rotation must never break or hide functionality.
- R14. The graph view is gated by viewport width, not by platform. Below the graph's
  minimum width, the same relatedness data is expressed as a related-panels list. An iPad in
  Split View gets the compact expression; a wide window gets the graph.
- R15. Interaction is touch-first: hover-dependent affordances get touch equivalents, and
  the existing accessibility bar (AA target, jsx-a11y lint gate) applies to all new and
  modified renderer code.

**Keys and security**
- R16. LLM API keys are stored in the iOS Keychain. The documented security boundary
  changes from "keys never leave the Electron main process" to "keys are hardware-protected
  at rest and enter the shared JS context only at call time." This relaxation is a recorded
  decision (see Key Decisions), and key values are never logged, never persisted outside the
  Keychain, and never echoed to the UI (status-only, as today).

**Distribution and licensing**
- R17. V1 distribution is a direct Xcode install to Roger's own iPad. No review, no
  listing. But no v1 choice may foreclose a later App Store release: the app must not depend
  on anything Store-ineligible, and the iOS project is kept signing-clean.
- R18. The AGPL/App Store question (sole-copyright-holder exception or dual license) must
  be decided and recorded before any Store submission. It does not block v1.

---

## Acceptance Examples

- AE1. **Covers R7, R8.** Given the iPad fetched data yesterday and has no network today,
  when the app launches, the full schedule browses and filters normally and the UI indicates
  the data is a day old. No error modal, no blocked feature except chat.
- AE2. **Covers R13, R14.** Given the app is running on an iPad in landscape showing the
  graph view, when the device rotates to portrait (or enters Split View), the view switches
  to the related-panels expression without losing the user's place or selection.
- AE3. **Covers R2, R3.** Given the Capacitor port is mid-development, when
  `npm run dist` runs on main, the macOS Electron app builds and behaves exactly as before
  the port began.
- AE4. **Covers R6.** Given a reviewer audits network traffic, all Sched program data
  requests originate from the device itself and no Galileo-operated host serves Sched prose.

---

## Success Criteria

- Roger can plan nothing on the iPad, walk the con floor with it, and still browse, filter,
  star, and export the schedule—offline included—without wishing he'd brought the Mac.
- The Electron app never regresses during the port; both targets build from one repo, one
  renderer, one shared core.
- The phone phase, when it starts, requires no new architecture: a compact breakpoint tier,
  layout work, and `cap add android`.
- A planner can pick this document up and produce an implementation plan without inventing
  product behavior: parity scope, offline rules, orientation rules, key handling, and
  distribution tier are all decided here.

---

## Scope Boundaries

- No stars sync in v1. Mac and iPad stars are independent; starring is redone by hand on
  the second device. "Transferable stars" is a recorded future consideration, not a v1
  requirement.
- No phone-tier layout shipping in v1. The breakpoint system anticipates it (R13), but
  compact-tier design and Android (`cap add android`, Keystore, Play listing) are a later
  phase.
- No App Store submission in v1—only Store-readiness (R17, R18).
- No hosted data infrastructure of any kind (mirror, proxy, sync service). Ruled out by the
  data posture, not just deferred.
- No PWA/web distribution target. The web build exists as a development and test surface,
  not a product.

---

## Key Decisions

- **Capacitor over PWA or native rewrite:** PWA cannot fetch Sched directly (CORS) and a
  hosted mirror would violate the data posture; native HTTP solves this while reusing the
  entire renderer. A SwiftUI rewrite redoes the virtualized list, graph, and chat UI for no
  additional product value.
- **Same repo, two build targets:** the port's premise is renderer and shared-core reuse;
  a second repo would mean syncing `src/shared/` and `src/renderer/` forever.
- **Bridge-first sequencing with an early device spike:** the bulk of the port is
  platform-neutral TypeScript best iterated in a browser/vitest loop; Capacitor wraps a
  proven web build at the end. To blunt the late-surprise risk, an early throwaway scaffold
  spike verifies the two riskiest assumptions on real hardware: entity-map canvas
  performance and direct Sched fetch via native HTTP.
- **Three-tier breakpoints now, portrait polish may trail:** designing the breakpoint
  system once avoids re-architecting layout for the phone phase; only the polish is staged.
- **Key-boundary relaxation accepted:** Capacitor has no process separation, so the
  Electron-era rule "keys never cross to the renderer" cannot hold. Keychain-at-rest plus
  call-time-only exposure is the deliberate replacement, chosen over dropping stored-key
  providers from mobile.
- **Full chat in v1:** the con-floor "what should I see next?" moment is chat's best case;
  deferring it would carry a parity gap through the app's primary usage window.
- **No stars sync in v1:** accepted cost (manual re-starring) in exchange for zero sync
  infrastructure and no conflict semantics. Revisit after v1 ships.
- **Start personal, design for Store:** distribution begins as a personal install, but
  Store-readiness constraints (R17, R18) apply from day one so the door stays open.

---

## Dependencies / Assumptions

- Apple Developer Program membership ($99/year) for a personal install that doesn't expire
  every 7 days; Xcode on the Mac. Neither exists in the project yet (unverified assumption:
  no current membership).
- Assumption: Sched endpoints respond to native iOS HTTP the same way they respond to the
  Electron main process's `fetch` (same User-Agent, no cookie/session dependency). Verified
  behavior in Electron; the iOS equivalent is confirmed by the early device spike.
- Assumption: the entity-map canvas performs acceptably in WKWebView on Roger's iPad.
  Confirmed or refuted by the same spike; if refuted, the fallback is the related-panels
  expression at more widths.
- The Vite `^7` / electron-vite `5` pin (see repo gotchas) constrains the second build
  target's tooling; the web build must not force an unpin.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R12][Needs research] Streaming chat transport in WKWebView: CapacitorHttp's
  fetch patch may not support streamed response bodies. Likely split—direct `fetch` with
  CORS-permitting providers (Anthropic supports browser-origin requests) for chat,
  CapacitorHttp for the Sched fetch—but this needs verification per provider.
- [Affects R6, R7][Technical] Storage backend for stars and snapshots on iOS (IndexedDB vs
  Capacitor Filesystem/Preferences), including persistence guarantees under iOS storage
  eviction.
- [Affects R16][Technical] Which Keychain plugin (e.g., `capacitor-secure-storage-plugin`
  vs alternatives), and how the existing injected-`SafeStorage` interface maps onto it.
- [Affects R3][Technical] Bridge selection mechanism: build-time entry point vs runtime
  `Capacitor.isNativePlatform()` check.
- [Affects R13, R14][Technical] Exact breakpoint widths and which tier boundary gates the
  graph; interaction with Split View sizes.
- [Affects R2][Technical] Web-build config layout that coexists with the pinned
  electron-vite setup (shared config vs standalone `vite.web.config.ts`).
- [Affects R17][Needs research] App Store guideline 4.2 posture for a later submission:
  what the review-safe checklist looks like (offline capability, native integrations) so v1
  choices stay aligned.

---

## Next Steps

-> `ce-plan` for structured implementation planning, starting with the early device spike
and the `src/shared/` extraction as the first plannable units.
