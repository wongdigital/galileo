---
title: "Physical iPad release rehearsal: verified paths and accepted follow-ups"
type: decision
date: 2026-07-22
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

Commit `70259a0` makes viewport-tier selection prefer the visual viewport and
subscribe to its resize events. A regression test holds `innerWidth` at 1,024
while changing the visual viewport to 683 and verifies the tier changes from
wide to medium. The rebuilt device app displayed the full-width 5-Day view and
the Related fallback at half width.

### iPadOS window controls need reserved space

In overlay mode, the iPadOS 26 window-control pill covered Galileo's planning
menu. Commit `d10da0e` reserves native-only leading space for the menu when the
app runs under the `capacitor:` protocol. The rebuilt app showed distinct
system and Galileo controls with a full touch target.

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
target deterministically. Both paths retain automated coverage; the remaining
hardware fault-injection decisions are explicit entries in `docs/TODO.md`.

## Release disposition

The iPad port is installable and its core offline planning, graph, native
storage, native fetch, and chat paths are hardware-verified. The VoiceOver
event-row action and direct Calendar integration are known product gaps,
durably scoped, and not represented as passing. No App Store submission claim
is made.
