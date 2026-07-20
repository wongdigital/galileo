/**
 * Mount/unmount choreography for the docked cards (U9).
 *
 * Hosts render cards conditionally, and React unmounts instantly — leaving no
 * frame for an exit animation. This wrapper keeps the last card mounted while
 * CardShell plays the reverse wipe, then lets go. The pair talk through
 * context rather than a wrapper element: CardShell positions itself
 * absolutely, and a zero-size wrapper box would have nothing to clip.
 *
 * Content swaps while open (a different uid, hub card to event card) render
 * directly with no re-wipe — the animation marks appearing and disappearing,
 * not changing.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

interface CardMotion {
  /** True while the card is playing its exit wipe and about to unmount. */
  closing: boolean
  /** CardShell calls this when the conceal animation finishes. */
  onExited: () => void
}

const CardMotionContext = createContext<CardMotion | null>(null)

/** Null outside CardPresence — cards rendered bare (tests, future hosts)
 *  simply play their reveal and close instantly. */
export function useCardMotion(): CardMotion | null {
  return useContext(CardMotionContext)
}

/** Exit animations can only play with a real compositor and no reduced-motion
 *  preference. jsdom has neither matchMedia nor CSS animations, so tests get
 *  instant closes — same path a reduced-motion user takes. */
function canAnimateExit(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Belt over the animationend suspenders: if the event never arrives (the
 *  element lost visibility mid-close, a future style regression), the card
 *  still unmounts instead of lingering forever. Comfortably above
 *  --duration-card without chasing its exact value. */
const EXIT_FALLBACK_MS = 600

export function CardPresence({ children }: { children: ReactNode | null }) {
  const [closing, setClosing] = useState(false)
  // The last real card, held only so the exit wipe has something to play over.
  const lastChildren = useRef<ReactNode>(null)
  const wasOpen = useRef(false)

  if (children != null) lastChildren.current = children

  useEffect(() => {
    if (children != null) {
      wasOpen.current = true
      if (closing) setClosing(false)
    } else if (wasOpen.current) {
      wasOpen.current = false
      if (canAnimateExit()) setClosing(true)
    }
  }, [children, closing])

  const onExited = useCallback(() => setClosing(false), [])

  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(onExited, EXIT_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [closing, onExited])

  if (children != null) {
    return (
      <CardMotionContext.Provider value={{ closing: false, onExited }}>
        {children}
      </CardMotionContext.Provider>
    )
  }
  if (closing) {
    return (
      <CardMotionContext.Provider value={{ closing: true, onExited }}>
        {lastChildren.current}
      </CardMotionContext.Provider>
    )
  }
  return null
}
