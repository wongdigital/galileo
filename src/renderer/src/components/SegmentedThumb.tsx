/**
 * The sliding active-state thumb shared by the segmented controls (view
 * toggle, sidebar tabs, lens selector). One element that travels to the
 * active button on the Observatory motion tokens, instead of each button
 * painting its own background — which is what makes the switch read as
 * movement rather than a swap (U9).
 *
 * Render it as the first child of a `relative` container measured by
 * `useSlidingIndicator`; the buttons after it must be `relative` so their
 * labels paint above it.
 */

import type { IndicatorBox } from './useSlidingIndicator'

export function SegmentedThumb({ box }: { box: IndicatorBox | null }) {
  if (!box || box.width === 0) return null
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-px rounded-[7px] bg-ground-700 shadow-[0_0_0_1px_var(--color-line-strong),0_0_18px_-6px_var(--color-lumen)] transition-[left,width] duration-(--duration-toggle) ease-(--ease-instrument) motion-reduce:transition-none"
      style={{ left: box.left, width: box.width }}
    />
  )
}
