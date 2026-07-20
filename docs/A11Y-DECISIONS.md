# A11Y-DECISIONS

Decisions between equally conformant alternatives, indexed by pattern, per the
[A11Y.md ruleset](https://github.com/fecarrico/A11Y.md/blob/main/docs/en/A11Y.md)
(Complex Component Protocol and decision-logging requirement). Target profile:
Standard (AA).

## docked-card (EventCard / EntityCard)

**Decision:** non-modal complementary panel (`<aside>`), no focus trap, Escape
closes, no focus return.

The card docks over a live surface that stays interactive—clicking another row
or node *replaces* the card's contents. A `dialog` with a trap would break that
model and would be the wrong ARIA pattern for content that never blocks the
page. Escape mirrors the canvas background-click dismissal for keyboard parity.
Focus is not force-moved into the card on open, because opening is a side
effect of browsing (row click, dot click) and yanking focus would break the
scan-through-rows flow.

## chip-tri-state (filter facet chips)

**Decision:** `aria-pressed` on/off with the negated state expressed in the
accessible name (the visible "not" prefix), rather than `aria-pressed="mixed"`.

"Mixed" announces as a partially-checked state, which is not what an exclusion
is. "not Wednesday, pressed" reads correctly through the visible text alone,
with color as a redundant channel (Icon + Text + Color rule).

## theme-toggle

**Decision:** a toggle button whose accessible name states the *action*
("Switch to light theme"), re-labelled after each press, rather than
`aria-pressed` state on a fixed label.

Both are conformant; action-naming avoids the double-negative of "Dark theme,
pressed: false" and matches the visual (the icon shows the destination, not
the current state).

## graph-canvas

**Decision:** the force-directed map is a visual alternative, not the sole
path—every event and entity it draws is reachable through the 5-Day list, the
filter chips, and the chat, all fully keyboard-operable. Canvas hit-testing is
mouse-only; the equivalent-task rule (Task Completion as the metric) is
satisfied by the list route. Hub/dot hover tooltips duplicate onto the pinned
card, which is real DOM.

## live-regions

**Decision:** `role="status"` (implicit polite) for filter result counts,
stale-data banner, chat tool-loop progress, and index loading; `role="alert"`
only for the chat error banner. Result counts change on every chip click, so
assertive would be hostile; the error banner is the one surface where missing
it means a silently failed turn.
