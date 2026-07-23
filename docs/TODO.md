# Project TODO

Durable follow-ups discovered during implementation and release rehearsal.
Completed items should be removed in the commit that resolves them; the linked
plan and findings documents retain the history.

## iPad release follow-ups

- [ ] Fix VoiceOver event-row activation and focus bounds.
  - Observed on a physical iPad Pro 13-inch (M4), iPadOS 26.5.2: double-tapping
    a schedule event stars it instead of opening its detail card, and the
    VoiceOver focus rectangle extends across several following rows.
  - Root cause: `EventRow`, `AmbientShelf`, and `EntityCard` expose a parent
    `role="button"` containing the real star `<button>`. ARIA buttons require
    presentational descendants, so WebKit/VoiceOver flattens the nested
    controls into an invalid accessibility subtree.
  - Fix: make the detail action and star action sibling native buttons with
    independent accessible names and bounds.
  - Regression coverage: assert that each detail control opens the correct
    card, the adjacent star changes only star state, and no detail button
    contains another focusable control.
  - Device acceptance: double-tap opens the detail card; the star is a separate
    swipe stop; each VoiceOver focus rectangle matches one visible control; no
    focus trap in regular rows, all-day rows, or entity-card rows.

- [ ] Decide and implement the native Calendar handoff for iPad.
  - Observed on iPadOS 26.5.2: the system share sheet recognizes Galileo's
    export as an ICS file, but Calendar is not a destination. Saving to Files
    and opening the ICS preview also offers no Add to Calendar action.
  - Follow-up decision from U1: evaluate an EventKit-backed Capacitor calendar
    plugin rather than claiming that share-sheet delivery reaches Calendar.
  - Device acceptance: import an event, re-export the same stable UID, record
    update/duplicate behavior, and verify Pacific `TZID` rendering with the
    device set to another time zone.

## Rehearsal evidence still to close

- [ ] Record the physical-device spike and release-rehearsal findings under
  `docs/solutions/`, including passed checks, deferred findings, and tooling
  limitations.
- [ ] Record the live OpenAI browser-CORS result if an OpenAI key is available;
  otherwise explicitly mark it unobserved and retain the buffered native HTTP
  fallback.
- [ ] Record the mid-write termination limitation: production filesystem
  writes complete too quickly to target deterministically without a
  throwaway instrumented build; retain the automated recovery coverage and
  decide whether a separate fault-injection spike is warranted.
- [ ] Exercise or explicitly disposition the live drift-warning path; the
  current Sched feed is healthy and does not naturally trigger the guard.
