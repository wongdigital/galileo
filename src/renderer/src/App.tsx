import { useState } from 'react'
import { SpineProvider, useSpine, type ViewMode } from './state/spine'
import { useSchedule } from './state/useSchedule'
import { isEmptyFilter } from '@shared/filter'
import { FiltersTab } from './sidebar/FiltersTab'
import { ChatTab } from './sidebar/ChatTab'
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
  return (
    <div className="titlebar-no-drag flex items-center gap-px rounded-lg border border-line bg-ground-850 p-px">
      {VIEWS.map((v) => {
        const active = view === v.id
        return (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={[
              'rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium transition-all duration-200',
              active
                ? 'bg-ground-700 text-ink-bright shadow-[0_0_0_1px_var(--color-line-strong),0_0_18px_-6px_var(--color-lumen)]'
                : 'text-ink-dim hover:text-ink',
            ].join(' ')}
          >
            {v.label}
          </button>
        )
      })}
    </div>
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

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-ground-950">
      <div className="shrink-0 border-b border-line p-2">
        <div className="flex items-center gap-px rounded-lg border border-line bg-ground-850 p-px">
          {SIDEBAR_TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={active}
                className={[
                  'relative flex-1 rounded-[7px] px-3 py-1.5 text-[13px] font-medium',
                  'transition-all duration-[--duration-toggle] ease-[--ease-instrument]',
                  active
                    ? 'bg-ground-700 text-ink-bright shadow-[0_0_0_1px_var(--color-line-strong),0_0_18px_-6px_var(--color-lumen)]'
                    : 'text-ink-dim hover:text-ink',
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
      <header className="titlebar-drag flex h-[52px] shrink-0 items-center justify-between border-b border-line px-5 pl-20">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink-bright">
            Galileo
          </span>
          <span className="text-[11px] text-ink-faint">2026</span>
        </div>
        <ViewToggle />
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
