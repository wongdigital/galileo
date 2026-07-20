/**
 * Shared measurement for sliding active-state indicators (U9).
 *
 * Segmented controls (view toggle, sidebar tabs, lens selector) and the day
 * rail all mark their active item the same way: one indicator element that
 * *moves* to the active item rather than each item painting its own. The hook
 * owns the measuring; each surface renders its own indicator styled to taste,
 * positioned from the returned box and animated with the Observatory motion
 * tokens (`--duration-toggle`, `--ease-instrument`).
 *
 * Contract: the container must be `relative` (and be the buttons'
 * offsetParent) — the box is in offsetLeft/offsetWidth coordinates.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export interface IndicatorBox {
  left: number
  width: number
}

export function useSlidingIndicator<K extends string>(activeKey: K | null): {
  itemRef: (key: K) => (el: HTMLElement | null) => void
  box: IndicatorBox | null
} {
  const items = useRef(new Map<K, HTMLElement>())
  // Ref callbacks are cached per key so React doesn't detach/re-attach them
  // on every render.
  const refCache = useRef(new Map<K, (el: HTMLElement | null) => void>())
  const [box, setBox] = useState<IndicatorBox | null>(null)

  const itemRef = useCallback((key: K) => {
    let fn = refCache.current.get(key)
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        if (el) items.current.set(key, el)
        else items.current.delete(key)
      }
      refCache.current.set(key, fn)
    }
    return fn
  }, [])

  // Deliberately no dependency array: any render can change a *sibling* tab's
  // width (a count updates upstream of the active one) and shift the active
  // tab sideways without `activeKey` changing. Re-measuring every render
  // self-heals; the setter bails when nothing moved, so no render loop.
  useLayoutEffect(() => {
    const el = activeKey === null ? undefined : items.current.get(activeKey)
    if (!el) return
    const next = { left: el.offsetLeft, width: el.offsetWidth }
    setBox((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next))
  })

  // The indicator mounts already at its measured position (state is set in a
  // layout effect, before paint), so first paint never animates — CSS
  // transitions only run on changes to an already-painted element.
  return { itemRef, box }
}
