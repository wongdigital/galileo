---
title: "The real iPad spike retired three assumptions and rejected share-to-Calendar"
type: decision
date: 2026-07-22
unit: U1
requirements: [R6, R12, R14]
---

# The real iPad spike retired three assumptions and rejected share-to-Calendar

The U1 hardware spike ran against the production Capacitor build because the
physical device became available after U10 was already implemented. The device
was an iPad Pro 13-inch (M4) running iPadOS 26.5.2. No device identifier,
account, API key, or other private value is recorded here.

## Decisions

### The entity map is viable in WKWebView

The production graph rendered 3,079 events, 454 entity hubs, and 1,444
unconnected events on the device. Dragging, pinching, and rotating between
landscape and portrait stayed responsive. The device tester described the
interaction as "really smooth." No graph-specific performance fallback or
lower hardware gate is needed.

### Native Sched fetch and snapshot storage work

`CapacitorHttp.request()` fetched the production Sched calendar and list
sources and produced all 3,079 events. The app container held both
`last-fetched.json` and `last-known-good.json` in `Library/NoCloud/galileo`,
each approximately 2.5 MB, plus the unseen-change log. This verifies the
native HTTP path, filesystem adapter, backup posture, and two-generation
snapshot layout on hardware.

### Anthropic streams from the Capacitor origin

After a key was entered from the device password manager, Anthropic output
arrived progressively from the `capacitor://localhost` application. Tapping
Stop retained the partial answer without applying unfinished effects. A
separate live turn survived a Wi-Fi interruption with its partial text intact
and the app responsive after connectivity returned.

The OpenAI browser-CORS state was not observed because no OpenAI key was
entered. Galileo retains the decided buffered `CapacitorHttp` fallback. A live
OpenAI observation remains in `docs/TODO.md`.

### Share-sheet ICS does not reach Calendar on this iPadOS build

The share sheet recognized Galileo's export as a 2 KB ICS file, but Calendar
was not offered as a destination. Saving the file to Files and opening its
preview also offered no Add to Calendar action. The generated file handoff is
valid; the assumed Calendar import path is not.

Per the plan's scoped escalation rule, direct Calendar delivery now requires
an EventKit-backed Capacitor integration decision. It is not silently added to
v1. The implementation and its acceptance checks are recorded in
`docs/TODO.md`.

## Storage interruption limitation

A production filesystem replace finishes too quickly to target the
delete/move window deterministically from Xcode tooling. The spike therefore
did not claim a real mid-write kill observation. Device evidence still covered
force termination, cold relaunch, update-then-offline launch, and packet-loss
refresh recovery without snapshot loss. The exact replace failure windows
remain covered by the injected adapter and shared-slot test suites; a
throwaway delayed-write build is the durable follow-up if hardware ground
truth is still required.

## Outcome

The graph, native fetch/storage, and Anthropic streaming assumptions are
retired as hardware-verified. Direct share-to-Calendar is rejected for this
iPadOS release and dispositioned as an EventKit follow-up. OpenAI CORS and the
sub-millisecond filesystem replace window remain explicitly unobserved rather
than inferred.
