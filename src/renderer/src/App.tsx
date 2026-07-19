import { SpineProvider, useSpine, type ViewMode } from './state/spine'
import { useSchedule } from './state/useSchedule'
import { FiltersTab } from './sidebar/FiltersTab'
import { ScheduleView } from './views/schedule/ScheduleView'

/**
 * App frame: title bar, view toggle, sidebar, view surface.
 *
 * U2 shipped the frame and the toggle; U5 replaces the schedule placeholder
 * with the real planning surface and fills the sidebar. The graph surface stays
 * a placeholder until U6 — the toggle already proves the shared-state contract,
 * because both sides read the same spine.
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

/** Placeholder until U6. Reads the spine so the toggle still demonstrates that
 *  selection and stars survive a view switch. */
function GraphView() {
  const { selectedUid } = useSpine()
  const { byUid, filteredCount } = useSchedule()
  const selected = selectedUid ? byUid.get(selectedUid) : null

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <span
        className="block h-3.5 w-3.5 rounded-full"
        style={{
          background: selected ? 'var(--color-lumen-bright)' : 'var(--color-ink-fringe)',
          boxShadow: selected ? '0 0 22px 4px var(--color-lumen-dim)' : 'none',
        }}
      />
      <span className="max-w-[280px] text-[12px] leading-snug text-ink-faint">
        {selected ? selected.title : `${filteredCount.toLocaleString()} events in the filter`}
      </span>
      <span className="text-[11px] text-ink-fringe">U6 replaces this with the ego network</span>
    </div>
  )
}

function Shell() {
  const { view } = useSpine()
  return (
    <div className="flex h-full flex-col bg-ground-900">
      <header className="titlebar-drag flex h-[52px] shrink-0 items-center justify-between border-b border-line px-5 pl-20">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink-bright">
            SDCC Schedule
          </span>
          <span className="text-[11px] text-ink-faint">2026</span>
        </div>
        <ViewToggle />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-ground-950">
          <FiltersTab />
          <SelectionReadout />
        </aside>

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
