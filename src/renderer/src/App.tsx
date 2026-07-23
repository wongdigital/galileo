import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { SpineProvider, useSpine, type ViewMode } from './state/spine'
import { useSchedule } from './state/useSchedule'
import { isEmptyFilter } from '@shared/filter'
import { FiltersTab } from './sidebar/FiltersTab'
import { ChatTab } from './sidebar/ChatTab'
import { SegmentedThumb } from './components/SegmentedThumb'
import { useSlidingIndicator } from './components/useSlidingIndicator'
import { useTheme } from './state/theme'
import { ScheduleView } from './views/schedule/ScheduleView'
import { GraphView } from './views/graph/GraphView'
import { RelatedPanel } from './views/related/RelatedPanel'
import { bridge, isElectronShell } from './bridge'
import { useViewportTier, type ViewportTier } from './state/useViewportTier'

/**
 * App frame: title bar, view toggle, sidebar, view surface.
 *
 * U2 shipped the frame and the toggle; U5 filled in the planning surface and
 * the sidebar; U6 replaced the graph placeholder with the ego network. Both
 * views read and write the same spine, which is what makes a star set in one
 * appear in the other with no wiring between them (R10).
 */

function ViewToggle({
  touch = false,
  graphLabel = 'Graph',
}: {
  touch?: boolean
  graphLabel?: 'Graph' | 'Related'
}) {
  const { view, setView } = useSpine()
  const { itemRef, box } = useSlidingIndicator(view)
  const views: { id: ViewMode; label: string }[] = [
    { id: 'graph', label: graphLabel },
    { id: 'schedule', label: '5-Day' },
  ]
  return (
    <div className="titlebar-no-drag relative flex items-center gap-px rounded-lg border border-line bg-ground-850 p-px">
      <SegmentedThumb box={box} />
      {views.map((v) => {
        const active = view === v.id
        return (
          <button
            key={v.id}
            type="button"
            ref={itemRef(v.id)}
            aria-label={v.label}
            onClick={() => setView(v.id)}
            className={[
              'relative rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium',
              touch ? 'min-h-11' : '',
              'transition-colors duration-(--duration-toggle) ease-(--ease-instrument)',
              active ? 'text-ink-bright' : 'text-ink-dim hover:text-ink',
            ].join(' ')}
          >
            {v.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Starred events → .ics, one click. The same main-process pipeline the chat
 * concierge's action card confirms into — this button is the no-API-key path
 * to it, which is why it lives in the titlebar rather than behind chat.
 * Success and cancel need no readout (the OS save dialog is the feedback);
 * a failed write marks the button until the next attempt.
 */
function ExportButton({ touch = false }: { touch?: boolean }) {
  const { stars } = useSpine()
  const [failed, setFailed] = useState(false)
  const none = stars.length === 0
  const label = none
    ? 'Star events to export them to calendar'
    : failed
      ? 'Export failed—try again'
      : `Export ${stars.length.toLocaleString()} starred event${stars.length === 1 ? '' : 's'} to calendar (.ics)`

  const exportStarred = async (): Promise<void> => {
    const api = bridge()
    if (!api) return
    const result = (await api.export.ics({ uids: stars.map((s) => s.uid) })) as {
      status?: string
    } | null
    setFailed(result?.status === 'failed')
  }

  return (
    <button
      type="button"
      disabled={none}
      onClick={() => void exportStarred()}
      aria-label={label}
      title={label}
      className={[
        'titlebar-no-drag relative flex items-center justify-center rounded-lg border border-line text-ink-dim transition-colors duration-150 hover:border-line-strong hover:text-ink disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-dim',
        touch ? 'h-11 w-11' : 'h-8 w-8',
      ].join(' ')}
    >
      {/* Arrow into a tray — export as macOS draws it, rotated toward disk. */}
      <svg
        viewBox="0 0 16 16"
        className="h-4 w-4"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 2.2v7.2" />
        <path d="M5.2 6.6 8 9.4l2.8-2.8" />
        <path d="M2.6 10.8v1.7a1.3 1.3 0 0 0 1.3 1.3h8.2a1.3 1.3 0 0 0 1.3-1.3v-1.7" />
      </svg>
      {failed ? (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-cancelled shadow-[0_0_6px_var(--color-cancelled)]"
        />
      ) : null}
    </button>
  )
}

function ThemeToggle({ touch = false }: { touch?: boolean }) {
  const { theme, setTheme } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      // A toggle whose label names the action, not the state — screen readers
      // announce exactly what pressing it will do.
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={[
        'titlebar-no-drag flex items-center justify-center rounded-lg border border-line text-ink-dim transition-colors duration-150 hover:border-line-strong hover:text-ink',
        touch ? 'h-11 w-11' : 'h-8 w-8',
      ].join(' ')}
    >
      {dark ? (
        // Sun — the destination, not the current state.
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <circle cx="8" cy="8" r="3.2" />
          <path d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3" />
        </svg>
      ) : (
        // Moon
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3Z" />
        </svg>
      )}
    </button>
  )
}

function SelectionReadout() {
  const { selectedUid } = useSpine()
  const { byUid } = useSchedule()
  const selected = selectedUid ? byUid.get(selectedUid) : null

  return (
    <div className="shrink-0 border-t border-line-soft px-4 py-3 font-mono text-[11px] text-ink-faint">
      {selected ? (
        <>
          <span className="text-lumen">{selected.shortId ?? selected.uid.slice(0, 8)}</span>{' '}
          <span className="text-ink-dim">{selected.title}</span>
        </>
      ) : (
        <span>no selection</span>
      )}
    </div>
  )
}

type SidebarTab = 'filter' | 'chat'

const SIDEBAR_TABS: { id: SidebarTab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'filter', label: 'Filter' },
]

/**
 * The left sidebar's two ways to shape what the views show: the Filter chips
 * and the Chat concierge. Both write the same spine filter, so switching tabs
 * never loses what you set in the other (R15).
 */
interface SidebarProps {
  tier: ViewportTier
  open: boolean
  onClose: () => void
  invokerRef: RefObject<HTMLButtonElement | null>
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

function Sidebar({ tier, open, onClose, invokerRef }: SidebarProps) {
  const [tab, setTab] = useState<SidebarTab>('filter')
  const { filter } = useSpine()
  const filterActive = !isEmptyFilter(filter)
  const { itemRef, box } = useSlidingIndicator(tab)
  const panelRef = useRef<HTMLElement>(null)
  const wasOpen = useRef(false)
  const overlay = tier !== 'wide'

  useEffect(() => {
    if (overlay && open) {
      panelRef.current
        ?.querySelector<HTMLButtonElement>('[data-sidebar-close]')
        ?.focus()
    } else if (wasOpen.current && invokerRef.current?.isConnected) {
      invokerRef.current.focus()
    }
    wasOpen.current = overlay && open
  }, [invokerRef, open, overlay])

  const selectTab = (next: SidebarTab, focus = false): void => {
    setTab(next)
    if (focus) {
      panelRef.current
        ?.querySelector<HTMLButtonElement>(`#sidebar-tab-${next}`)
        ?.focus()
    }
  }

  const onTabsKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const current = SIDEBAR_TABS.findIndex((candidate) => candidate.id === tab)
    let next = current
    if (event.key === 'ArrowRight') next = (current + 1) % SIDEBAR_TABS.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + SIDEBAR_TABS.length) % SIDEBAR_TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = SIDEBAR_TABS.length - 1
    else return
    event.preventDefault()
    selectTab(SIDEBAR_TABS[next]!.id, true)
  }

  useEffect(() => {
    if (!overlay || !open) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
        .filter((element) => element.tabIndex >= 0 && !element.closest('[hidden]'))
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open, overlay])

  return (
    <aside
      ref={panelRef}
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay ? true : undefined}
      aria-label="Planning tools"
      hidden={overlay && !open}
      className={[
        'flex shrink-0 flex-col border-r border-line bg-ground-950',
        overlay
          ? 'absolute inset-y-0 left-0 z-30 w-[min(340px,calc(100%-44px))] shadow-2xl'
          : 'w-[300px]',
      ].join(' ')}
    >
      {/* h-rail: this row, the day rail, and the graph toolbar share the
          titlebar's 52px beat so their dividers align across the seam. */}
      <div className="flex h-rail shrink-0 items-center border-b border-line px-2">
        {overlay ? (
          <button
            data-sidebar-close
            type="button"
            aria-label="Close planning sidebar"
            onClick={onClose}
            className="order-2 ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-xl text-ink-dim hover:border-line-strong hover:text-ink"
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
        <div
          role="tablist"
          tabIndex={-1}
          aria-label="Planning tools"
          onKeyDown={onTabsKeyDown}
          className="order-1 relative flex flex-1 items-center gap-px rounded-lg border border-line bg-ground-850 p-px"
        >
          <SegmentedThumb box={box} />
          {SIDEBAR_TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                id={`sidebar-tab-${t.id}`}
                type="button"
                ref={itemRef(t.id)}
                role="tab"
                aria-selected={active}
                aria-controls={`sidebar-panel-${t.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => selectTab(t.id)}
                className={[
                  'relative flex-1 rounded-[7px] px-3 py-1.5 text-[13px] font-medium',
                  overlay ? 'min-h-11' : '',
                  'transition-colors duration-(--duration-toggle) ease-(--ease-instrument)',
                  active ? 'text-ink-bright' : 'text-ink-dim hover:text-ink',
                ].join(' ')}
              >
                {t.label}
                {/* A live dot when the filter is doing something, so the
                    indicator is visible even while the Chat tab is open. */}
                {t.id === 'filter' && filterActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-lumen shadow-[0_0_8px_1px_var(--color-lumen-dim)]"
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
      {/* Both mounted; hiding rather than unmounting keeps the chat transcript
          and the filter's expand state alive across tab switches. */}
      <div
        id="sidebar-panel-filter"
        role="tabpanel"
        aria-labelledby="sidebar-tab-filter"
        hidden={tab !== 'filter'}
        className="min-h-0 flex-1 flex-col data-[active=true]:flex"
        data-active={tab === 'filter'}
      >
        <FiltersTab />
      </div>
      <div
        id="sidebar-panel-chat"
        role="tabpanel"
        aria-labelledby="sidebar-tab-chat"
        hidden={tab !== 'chat'}
        className="min-h-0 flex-1 flex-col data-[active=true]:flex"
        data-active={tab === 'chat'}
      >
        <ChatTab />
      </div>
      <SelectionReadout />
    </aside>
  )
}

function Shell() {
  const { view, status } = useSpine()
  const tier = useViewportTier()
  const electron = isElectronShell()
  const overlay = tier !== 'wide'
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const sidebarInvokerRef = useRef<HTMLButtonElement>(null)
  const previousTier = useRef(tier)
  const crossedIntoRelated = previousTier.current === 'wide' && tier !== 'wide'

  useEffect(() => {
    if (!overlay) setSidebarOpen(false)
  }, [overlay])

  useEffect(() => {
    previousTier.current = tier
  }, [tier])

  return (
    <div
      data-viewport-tier={tier}
      data-touch-layout={overlay}
      className="flex h-full flex-col bg-ground-900"
    >
      <header
        inert={sidebarOpen && overlay}
        className={[
          'relative flex h-[52px] shrink-0 items-center justify-between border-b border-line px-5',
          electron ? 'titlebar-drag pl-20' : '',
        ].join(' ')}
      >
        {/* The dataset badge — a button because switching cons is the planned
            gesture here; disabled until there is a second dataset to switch to. */}
        <div className="flex items-center gap-2">
          {overlay ? (
            <button
              ref={sidebarInvokerRef}
              type="button"
              aria-label="Open planning sidebar"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
              className="titlebar-no-drag flex h-11 w-11 items-center justify-center rounded-lg border border-line text-ink-dim hover:border-line-strong hover:text-ink"
            >
              <span aria-hidden="true">☰</span>
            </button>
          ) : null}
          {tier !== 'compact' ? (
            <button
              type="button"
              disabled
              className="rounded border border-line px-2 py-1 text-[11px] text-ink-dim"
            >
              San Diego 2026
            </button>
          ) : null}
        </div>
        {/* Centered on the window, not the flex row — absolute so the uneven
            widths of the badge and the toggles cannot pull it off-axis. */}
        <span className="font-display absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[15px] font-bold tracking-tight text-ink-bright">
          Galileo
        </span>
        <div className="flex items-center gap-2">
          {tier !== 'compact' ? <ExportButton touch={overlay} /> : null}
          <ThemeToggle touch={overlay} />
          <ViewToggle
            touch={overlay}
            graphLabel={tier === 'wide' ? 'Graph' : 'Related'}
          />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {overlay && sidebarOpen ? (
          <button
            type="button"
            aria-label="Dismiss planning sidebar"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 z-20 cursor-default bg-black/55"
          />
        ) : null}
        <Sidebar
          tier={tier}
          open={!overlay || sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          invokerRef={sidebarInvokerRef}
        />

        <main
          inert={sidebarOpen && overlay}
          aria-busy={status === 'loading'}
          className="flex min-w-0 flex-1 flex-col"
        >
          {view === 'schedule' ? (
            <ScheduleView />
          ) : (
            <>
              <div
                hidden={tier !== 'wide'}
                data-active={tier === 'wide'}
                className="min-h-0 flex-1 flex-col data-[active=true]:flex"
              >
                <GraphView active={tier === 'wide'} />
              </div>
              {tier !== 'wide' ? (
                <RelatedPanel focusHeading={crossedIntoRelated} />
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <SpineProvider>
      <Shell />
    </SpineProvider>
  )
}
