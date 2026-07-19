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

/**
 * Stands in for the TanStack virtualizer's two-method surface. `topIndex` is
 * what the user has scrolled to; the hook reads it after every commit.
 */
function fakeVirtualizer(topIndex = 0) {
  return {
    topIndex,
    scrollToIndex: vi.fn<(index: number, options?: { align?: 'start' }) => void>(),
    getVirtualItems() {
      return [{ index: this.topIndex }]
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
