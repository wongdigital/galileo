import { useState } from 'react'
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

/**
 * App frame: title bar, view toggle, sidebar, view surface.
 *
 * U2 shipped the frame and the toggle; U5 filled in the planning surface and
 * the sidebar; U6 replaced the graph placeholder with the ego network. Both
 * views read and write the same spine, which is what makes a star set in one
 * appear in the other with no wiring between them (R10).
 */

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'graph', label: 'Graph' },
  { id: 'schedule', label: '5-Day' },
]

function ViewToggle() {
  const { view, setView } = useSpine()
  const { itemRef, box } = useSlidingIndicator(view)
  return (
    <div className="titlebar-no-drag relative flex items-center gap-px rounded-lg border border-line bg-ground-850 p-px">
      <SegmentedThumb box={box} />
      {VIEWS.map((v) => {
        const active = view === v.id
        return (
          <button
            key={v.id}
            ref={itemRef(v.id)}
            onClick={() => setView(v.id)}
            className={[
              'relative rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium',
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

function ThemeToggle() {
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
      className="titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-dim transition-colors duration-150 hover:border-line-strong hover:text-ink"
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
function Sidebar() {
  const [tab, setTab] = useState<SidebarTab>('filter')
  const { filter } = useSpine()
  const filterActive = !isEmptyFilter(filter)
  const { itemRef, box } = useSlidingIndicator(tab)

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-ground-950">
      {/* h-rail: this row, the day rail, and the graph toolbar share the
          titlebar's 52px beat so their dividers align across the seam. */}
      <div className="flex h-rail shrink-0 items-center border-b border-line px-2">
        <div className="relative flex flex-1 items-center gap-px rounded-lg border border-line bg-ground-850 p-px">
          <SegmentedThumb box={box} />
          {SIDEBAR_TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                ref={itemRef(t.id)}
                onClick={() => setTab(t.id)}
                aria-pressed={active}
                className={[
                  'relative flex-1 rounded-[7px] px-3 py-1.5 text-[13px] font-medium',
                  'transition-colors duration-(--duration-toggle) ease-(--ease-instrument)',
                  active ? 'text-ink-bright' : 'text-ink-dim hover:text-ink',
                ].join(' ')}
              >
                {t.label}
                {/* A live dot when the filter is doing something, so the
                    indicator is visible even while the Chat tab is open. */}
                {t.id === 'filter' && filterActive ? (
                  <span
                    aria-label="filters active"
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
      <div className={tab === 'filter' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <FiltersTab />
      </div>
      <div className={tab === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <ChatTab />
      </div>
      <SelectionReadout />
    </aside>
  )
}

function Shell() {
  const { view } = useSpine()
  return (
    <div className="flex h-full flex-col bg-ground-900">
      <header className="titlebar-drag relative flex h-[52px] shrink-0 items-center justify-between border-b border-line px-5 pl-20">
        {/* The dataset badge — a button because switching cons is the planned
            gesture here; disabled until there is a second dataset to switch to. */}
        <button
          type="button"
          disabled
          className="rounded border border-line px-2 py-1 text-[11px] text-ink-dim"
        >
          San Diego 2026
        </button>
        {/* Centered on the window, not the flex row — absolute so the uneven
            widths of the badge and the toggles cannot pull it off-axis. */}
        <span className="font-display absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[15px] font-bold tracking-tight text-ink-bright">
          Galileo
        </span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <ViewToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar />

        <main className="flex min-w-0 flex-1 flex-col">
          {view === 'schedule' ? <ScheduleView /> : <GraphView />}
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
