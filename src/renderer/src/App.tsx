import { SpineProvider, useSpine, type ViewMode } from './state/spine'

/**
 * App frame: title bar, view toggle, sidebar, view surface.
 *
 * U2 ships the frame and the toggle only. The two view surfaces are
 * placeholders that prove the shared-state contract — selecting in one view and
 * toggling shows the selection survived, because both read the same spine.
 */

const VIEWS: { id: ViewMode; label: string; hint: string }[] = [
  { id: 'graph', label: 'Graph', hint: 'Relatedness' },
  { id: 'schedule', label: '5-Day', hint: 'Planning' },
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

/** Stand-in until U3 lands real data. Lets the toggle prove shared state now. */
const PLACEHOLDER = [
  { uid: 'demo-1', title: 'Teaching and Learning with Comics', room: 'Room 23ABC', time: '10:00' },
  { uid: 'demo-2', title: "Star Trek's Future in a Time of Flux", room: 'Room 6BCF', time: '11:30' },
  { uid: 'demo-3', title: 'Diversity in Fantasy', room: 'Room 5AB', time: '13:00' },
]

function SelectionReadout() {
  const { selectedUid } = useSpine()
  const selected = PLACEHOLDER.find((e) => e.uid === selectedUid)
  return (
    <div className="border-t border-line-soft px-5 py-3 font-mono text-[11px] text-ink-faint">
      {selected ? (
        <>
          <span className="text-ink-dim">selected</span>{' '}
          <span className="text-lumen">{selected.uid}</span>{' '}
          <span className="text-ink-faint">— {selected.title}</span>
        </>
      ) : (
        <span>no selection</span>
      )}
    </div>
  )
}

function ScheduleView() {
  const { selectedUid, setSelectedUid } = useSpine()
  return (
    <div className="flex-1 overflow-auto p-5">
      <div className="mb-4 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint">
        Wednesday · Preview Night
      </div>
      <div className="flex flex-col gap-px">
        {PLACEHOLDER.map((e) => {
          const active = selectedUid === e.uid
          return (
            <button
              key={e.uid}
              onClick={() => setSelectedUid(active ? null : e.uid)}
              className={[
                'group flex items-baseline gap-4 rounded-md border px-4 py-3 text-left transition-colors duration-150',
                active
                  ? 'border-lumen-dim bg-ground-800'
                  : 'border-transparent hover:border-line hover:bg-ground-850',
              ].join(' ')}
            >
              <span className="font-mono text-[12px] text-ink-faint">{e.time}</span>
              <span className="flex-1">
                <span className={active ? 'text-ink-bright' : 'text-ink'}>{e.title}</span>
                <span className="ml-2 text-[12px] text-ink-faint">{e.room}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function GraphView() {
  const { selectedUid, setSelectedUid } = useSpine()
  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center gap-10">
        {PLACEHOLDER.map((e) => {
          const active = selectedUid === e.uid
          return (
            <button
              key={e.uid}
              onClick={() => setSelectedUid(active ? null : e.uid)}
              className="flex flex-col items-center gap-3"
            >
              <span
                className="block h-3.5 w-3.5 rounded-full transition-all duration-300"
                style={{
                  background: active ? 'var(--color-lumen-bright)' : 'var(--color-ink-fringe)',
                  boxShadow: active ? '0 0 22px 4px var(--color-lumen-dim)' : 'none',
                }}
              />
              <span
                className={[
                  'max-w-[130px] text-center text-[11px] leading-snug transition-colors duration-300',
                  active ? 'text-ink-bright' : 'text-ink-faint',
                ].join(' ')}
              >
                {e.title}
              </span>
            </button>
          )
        })}
      </div>
      <div className="absolute bottom-4 left-0 right-0 text-center text-[11px] text-ink-faint">
        Graph surface — U6 replaces this with the ego network
      </div>
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
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-line bg-ground-950">
          <div className="border-b border-line-soft px-5 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint">
            Filters
          </div>
          <div className="flex-1 px-5 py-4 text-[13px] text-ink-faint">U5 fills this in.</div>
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
