---
title: "Physical iPad release rehearsal: verified paths and accepted follow-ups"
type: decision
date: 2026-07-22
last_updated: 2026-07-22
unit: U11
requirements: [R7, R8, R9, R13, R14, R15]
---

# Physical iPad release rehearsal: verified paths and accepted follow-ups

Galileo was built with Xcode 26.6, signed for development, installed, and
launched on an iPad Pro 13-inch (M4) running iPadOS 26.5.2. The rehearsal used
the production Sched corpus and a production Capacitor build.

## Passed on hardware

- Signed build, install, launch, suspend/resume, force termination, and cold
  relaunch.
- Live production fetch of 3,079 events and persistence of both snapshot
  generations in the app's `Library/NoCloud` container.
- Offline cold launch with all 3,079 saved events and the explicit
  "Showing the last saved schedule" banner.
- A refresh stalled with Xcode's 100% packet-loss profile, backgrounded while
  in flight, resumed, and failed back to the complete saved schedule. Normal
  networking was restored immediately afterward.
- Update/reinstall followed by an offline launch retained the snapshots.
- Landscape and portrait schedule layouts, graph rotation, graph drag/pinch,
  Related groups, and the planning overlay.
- Anthropic key entry from the password manager, protected-key status,
  progressive streaming, Stop, and a live Wi-Fi interruption with partial
  response retention.
- Native ICS file creation and share-sheet presentation.

The Xcode `sendMemoryWarning` device action returned an OS-level
`NSPOSIXErrorDomain` error before reaching the app. The app process remained
alive; this is recorded as an Xcode/device tooling limitation, not an
application failure.

## Device fixes produced by the rehearsal

### Split View must use the visual viewport

At half width, iPadOS kept `window.innerWidth` at the full layout width while
`window.visualViewport.width` reflected the visible Galileo tile. The app
therefore stayed in its wide tier and squeezed the graph beside the persistent
sidebar.

The first device fix made viewport-tier selection prefer the visual viewport
and subscribe to its resize events. A regression holds `innerWidth` at 1,024
while changing the visual viewport to 683 and verifies the tier changes from
wide to medium
(`src/renderer/src/state/__tests__/useViewportTier.test.tsx:92-115`). The
rebuilt device app displayed the full-width 5-Day view and the Related fallback
at half width.

That first fix was necessary but incomplete. Follow-up review (session history)
found two ways that raw `visualViewport.width` plus a resize listener could
still select the wrong tier:

- Pinch zoom reduces the visual viewport's CSS-pixel width even though the
  underlying responsive layout width has not changed. Treating the raw width
  as layout geometry could demote the shell during magnification.
- The hook reads its initial width during render but installs listeners later
  in an effect. A viewport transition between those stages could be missed
  until another resize event arrived.

The durable rule is to normalize visual geometry before applying breakpoints.
When both values are finite and positive, Galileo uses
`visualViewport.width * visualViewport.scale`; otherwise it falls back to
`window.innerWidth` (`src/renderer/src/state/useViewportTier.ts:50-63`). At
scale 1 the product still follows the Split View tile. At 2x zoom, a visual
width of 341.5 produces the same 683-pixel responsive width, so zoom does not
masquerade as window resizing.

The hook then registers its window, visual-viewport, and media-query listeners
before calling the shared `update()` function once. That post-subscription
resample closes the render-to-effect handoff without creating another event
path, and cleanup removes every listener symmetrically
(`src/renderer/src/state/useViewportTier.ts:66-85`).

The regression matrix preserves all four boundaries of this behavior:

- Split View can narrow the tier while `innerWidth` remains unchanged
  (`src/renderer/src/state/__tests__/useViewportTier.test.tsx:92-115`).
- Reciprocal visual width and scale changes preserve the tier during pinch
  zoom (`src/renderer/src/state/__tests__/useViewportTier.test.tsx:117-145`).
- A width change during listener installation is reconciled without requiring
  another event
  (`src/renderer/src/state/__tests__/useViewportTier.test.tsx:147-165`).
- Unmount cleanup and invalid visual-viewport fallback remain covered
  (`src/renderer/src/state/__tests__/useViewportTier.test.tsx:167-204`).

Future responsive code should consume the centralized
`compact | medium | wide` result rather than reading browser geometry
independently. The hook owns both its zoom-normalized measurement and the
directional hysteresis policy
(`src/renderer/src/state/useViewportTier.ts:3-41`).

### iPadOS window controls need reserved space

In overlay mode, the iPadOS 26 window-control pill covered Galileo's planning
menu. The current shell reserves native-only leading space for the menu when
the app runs under the `capacitor:` protocol
(`src/renderer/src/App.tsx:384-421`). The rebuilt app showed distinct system
and Galileo controls with a full touch target.

## Accepted follow-ups

### VoiceOver event rows

VoiceOver traversed the header, list, Chat controls, and Related groups without
other reported issues, but event rows failed their primary action:
double-tapping a row starred it instead of opening its detail card, and the
focus rectangle covered several following rows.

The confirmed cause is a parent `role="button"` containing the real star
button in `EventRow`, `AmbientShelf`, and `EntityCard`. ARIA buttons require
presentational descendants, so WebKit/VoiceOver flattens an invalid nested
control tree. The fix and physical acceptance checks are deferred by explicit
product choice and recorded in `docs/TODO.md`.

### Calendar import and time-zone rendering

iPadOS recognized the ICS file but exposed no Calendar destination in either
the share sheet or Files preview. Calendar duplicate/update behavior and
device-time-zone rendering therefore could not be observed. The EventKit
decision and both acceptance checks remain in `docs/TODO.md`; the pure builder
tests continue to verify stable UIDs and `America/Los_Angeles` `TZID` output.

### Dynamic Type

The v1 fixed CSS type ramp remains the declared posture in
`docs/EXCEPTIONS.md`. The rehearsal does not claim native Dynamic Type
adaptation. The 5-Day and Related list paths remain available at all tested
widths.

### Drift guard and exact mid-write termination

The live Sched feed remained healthy, so it did not naturally trigger the
drift guard. The production filesystem replace window was also too short to
target deterministically. Both paths retain automated coverage: the drift guard
holds suspect data until explicit acceptance
(`src/shared/schedule/__tests__/refresh.test.ts:119-132`), while interrupted
snapshot promotion and atomic JSON replacement retain readable data
(`src/shared/schedule/__tests__/refresh.test.ts:200-214`,
`src/main/__tests__/nodeJsonStore.test.ts:27-61`). The remaining hardware
fault-injection decisions are explicit entries in `docs/TODO.md`.

## Release disposition

The iPad port is installable and its core offline planning, graph, native
storage, native fetch, and chat paths are hardware-verified. The VoiceOver
event-row action and direct Calendar integration are known product gaps,
durably scoped, and not represented as passing. No App Store submission claim
is made.
