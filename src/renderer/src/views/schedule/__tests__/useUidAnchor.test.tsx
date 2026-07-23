// @vitest-environment jsdom

/**
 * The scroll anchor is the piece of this view most likely to be quietly wrong,
 * because index-based restoration looks correct until the filtered array
 * changes length — which is exactly what a refresh does. So it gets a real test
 * rather than a reading.
 */

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useUidAnchor } from '../useUidAnchor'

const ROW = 10

/**
 * Stands in for the TanStack virtualizer's surface. `topIndex` is the first
 * row actually visible; `overscan` prepends off-screen rows to
 * `getVirtualItems()` exactly like the real defaultRangeExtractor does, so the
 * fake can't hide the difference between "first rendered" and "first visible".
 */
function fakeVirtualizer(topIndex = 0, overscan = 0) {
  return {
    topIndex,
    overscan,
    scrollOffset: topIndex * ROW,
    scrollToIndex: vi.fn<(index: number, options?: { align?: 'start' }) => void>(),
    getVirtualItems() {
      const first = Math.max(0, this.topIndex - this.overscan)
      const items: { index: number; end: number }[] = []
      for (let index = first; index <= this.topIndex + 2; index++) {
        items.push({ index, end: (index + 1) * ROW })
      }
      return items
    },
  }
}

function Harness({
  virtualizer,
  uids,
  resetKey,
}: {
  virtualizer: ReturnType<typeof fakeVirtualizer>
  uids: string[]
  resetKey: string | null
}) {
  useUidAnchor(virtualizer, uids, resetKey)
  return null
}

const DAY = '2026-07-25'

describe('useUidAnchor', () => {
  it('restores by UID when the array shortens under it', () => {
    const virtualizer = fakeVirtualizer(3)
    const before = ['a', 'b', 'c', 'd', 'e']
    const { rerender } = render(
      <Harness virtualizer={virtualizer} uids={before} resetKey={DAY} />
    )
    virtualizer.scrollToIndex.mockClear()

    // 'd' was at index 3; after two earlier events drop out it is at index 1.
    // An index-restoring scroll would land on 'f' — two rows off.
    rerender(<Harness virtualizer={virtualizer} uids={['c', 'd', 'e', 'f']} resetKey={DAY} />)

    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(1, { align: 'start' })
  })

  it('restores by UID when the array lengthens under it', () => {
    const virtualizer = fakeVirtualizer(1)
    const { rerender } = render(
      <Harness virtualizer={virtualizer} uids={['b', 'c']} resetKey={DAY} />
    )
    virtualizer.scrollToIndex.mockClear()

    rerender(<Harness virtualizer={virtualizer} uids={['a', 'b', 'c']} resetKey={DAY} />)

    // Anchored on 'c', which moved from index 1 to index 2.
    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(2, { align: 'start' })
  })

  it('stays put when the anchored event leaves the feed entirely', () => {
    const virtualizer = fakeVirtualizer(1)
    const { rerender } = render(
      <Harness virtualizer={virtualizer} uids={['a', 'b', 'c']} resetKey={DAY} />
    )
    virtualizer.scrollToIndex.mockClear()

    rerender(<Harness virtualizer={virtualizer} uids={['a', 'c']} resetKey={DAY} />)

    // Jumping somewhere arbitrary is worse than holding position: the rows
    // around where the user was are still the ones they were reading.
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
  })

  it('does nothing at all when the array is unchanged', () => {
    const virtualizer = fakeVirtualizer(2)
    const uids = ['a', 'b', 'c']
    const { rerender } = render(<Harness virtualizer={virtualizer} uids={uids} resetKey={DAY} />)
    virtualizer.scrollToIndex.mockClear()

    rerender(<Harness virtualizer={virtualizer} uids={uids} resetKey={DAY} />)

    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
  })

  it('does not scroll when the array identity changes but the content does not', () => {
    // A star click rebuilds the rows array without changing which uids are in
    // it. Restoring scroll for that "swap" is what made the list jump on star.
    const virtualizer = fakeVirtualizer(2)
    const { rerender } = render(
      <Harness virtualizer={virtualizer} uids={['a', 'b', 'c']} resetKey={DAY} />
    )
    virtualizer.scrollToIndex.mockClear()

    rerender(<Harness virtualizer={virtualizer} uids={['a', 'b', 'c']} resetKey={DAY} />)

    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
  })

  it('anchors to the first visible row, not an overscan row above the viewport', () => {
    // With overscan, getVirtualItems() starts rows above what the user can
    // see. Anchoring to one of those restores the scroll to an off-screen row
    // — the "list jumps part way up" bug.
    const virtualizer = fakeVirtualizer(3, 2)
    const before = ['a', 'b', 'c', 'd', 'e', 'f']
    const { rerender } = render(
      <Harness virtualizer={virtualizer} uids={before} resetKey={DAY} />
    )
    virtualizer.scrollToIndex.mockClear()

    // 'a' drops out; the visible top row 'd' moves from index 3 to index 2.
    // Anchoring to the overscan row 'b' would restore to index 0 instead.
    rerender(
      <Harness virtualizer={virtualizer} uids={['b', 'c', 'd', 'e', 'f']} resetKey={DAY} />
    )

    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(2, { align: 'start' })
  })

  it('returns to the top when the day changes, because that is a deliberate move', () => {
    const virtualizer = fakeVirtualizer(4)
    const { rerender } = render(
      <Harness virtualizer={virtualizer} uids={['a', 'b', 'c', 'd', 'e']} resetKey={DAY} />
    )
    virtualizer.scrollToIndex.mockClear()

    rerender(
      <Harness virtualizer={virtualizer} uids={['x', 'y', 'a']} resetKey="2026-07-26" />
    )

    // Note 'a' exists in the new array — the anchor is dropped anyway, because
    // switching days is going somewhere else, not the list moving underfoot.
    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(0, { align: 'start' })
  })
})
