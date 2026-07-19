/**
 * Scroll anchoring by UID.
 *
 * The list is virtualized by index, but the index of an event is not a property
 * of the event — it is a property of the current filter. Refresh with a filter
 * on and the array changes length; the row that was at index 40 is now at 37,
 * and an index-restoring scroll lands three rows off. Anchoring to the UID at
 * the top of the viewport is the only version that survives a dataset swap,
 * which is the whole point of the manual-refresh model.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'

interface AnchorableVirtualizer {
  getVirtualItems: () => { index: number }[]
  scrollToIndex: (index: number, options?: { align?: 'start' }) => void
}

export function useUidAnchor(
  virtualizer: AnchorableVirtualizer,
  uids: readonly string[],
  /** Changing this drops the anchor and returns to the top — switching days is
   *  a deliberate move to somewhere else, not a swap under a fixed position. */
  resetKey: string | null
): void {
  const anchor = useRef<string | null>(null)
  const previousUids = useRef(uids)
  const previousReset = useRef(resetKey)

  // Runs after every commit, so the anchor is whatever is on screen right now.
  useEffect(() => {
    const first = virtualizer.getVirtualItems()[0]
    if (first) anchor.current = uids[first.index] ?? anchor.current
  })

  useLayoutEffect(() => {
    if (previousReset.current !== resetKey) {
      previousReset.current = resetKey
      previousUids.current = uids
      anchor.current = null
      virtualizer.scrollToIndex(0, { align: 'start' })
      return
    }

    if (previousUids.current === uids) return
    previousUids.current = uids

    const uid = anchor.current
    if (!uid) return
    const index = uids.indexOf(uid)
    // A negative index means the anchored event was filtered out or dropped
    // from the feed. Staying put is better than jumping: the surrounding rows
    // are still the ones the user was reading.
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'start' })
  }, [uids, resetKey, virtualizer])
}
