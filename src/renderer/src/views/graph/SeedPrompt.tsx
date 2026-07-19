/**
 * The entry state: what the graph shows when nothing is seeded.
 *
 * The two failure modes the plan rules out are an empty canvas and the whole
 * corpus, and they fail for the same reason — neither answers "related to
 * what?". A relatedness graph without a subject has nothing to say, so the
 * honest opening is to ask for one, and to offer the subjects the user has
 * already chosen: what they starred, and what their filter currently holds.
 */

import type { SeedCandidate } from '@renderer/state/useGraph'

interface SeedPromptProps {
  candidates: SeedCandidate[]
  filteredCount: number
  filterActive: boolean
  cap: number
  onSeedEvent: (uid: string) => void
  onSeedFilter: () => void
}

export function SeedPrompt({
  candidates,
  filteredCount,
  filterActive,
  cap,
  onSeedEvent,
  onSeedFilter,
}: SeedPromptProps) {
  const stars = candidates.filter((c) => c.source === 'star')
  const fromFilter = candidates.filter((c) => c.source === 'filter')
  const tooWide = filteredCount > cap

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-[440px]">
        <span
          className="mx-auto mb-5 block h-2.5 w-2.5 rounded-full"
          style={{
            background: 'var(--color-lumen)',
            boxShadow: '0 0 26px 6px var(--color-lumen-dim)',
          }}
        />
        <h2 className="text-center font-display text-[15px] font-semibold text-ink-bright">
          Start from something
        </h2>
        <p className="mx-auto mt-1.5 max-w-[320px] text-center text-[12.5px] leading-relaxed text-ink-faint">
          The graph shows what a session connects to. Pick one to sit at the centre.
        </p>

        {stars.length > 0 ? (
          <Section title="Recently starred">
            {stars.map((candidate) => (
              <CandidateRow key={candidate.uid} candidate={candidate} onSelect={onSeedEvent} />
            ))}
          </Section>
        ) : null}

        {fromFilter.length > 0 ? (
          <Section title={filterActive ? 'In the current filter' : 'On this day'}>
            {fromFilter.slice(0, 4).map((candidate) => (
              <CandidateRow key={candidate.uid} candidate={candidate} onSelect={onSeedEvent} />
            ))}
          </Section>
        ) : null}

        {filteredCount > 1 ? (
          <button
            type="button"
            onClick={onSeedFilter}
            disabled={tooWide}
            className={[
              'mt-4 w-full rounded-lg border px-3 py-2.5 text-[12px] transition-colors duration-150',
              tooWide
                ? 'cursor-default border-line-soft text-ink-fringe'
                : 'border-line text-ink-dim hover:border-line-strong hover:text-ink',
            ].join(' ')}
          >
            {tooWide ? (
              <>
                {filteredCount.toLocaleString()} events match — narrow to {cap} or fewer to seed the whole
                filter
              </>
            ) : (
              <>Seed all {filteredCount.toLocaleString()} filtered events</>
            )}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <span className="font-mono text-[10px] tracking-[0.12em] text-ink-fringe">
        {title.toUpperCase()}
      </span>
      <div className="mt-1.5 flex flex-col gap-px">{children}</div>
    </div>
  )
}

function CandidateRow({
  candidate,
  onSelect,
}: {
  candidate: SeedCandidate
  onSelect: (uid: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(candidate.uid)}
      className="flex items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-150 hover:bg-ground-850"
    >
      {candidate.source === 'star' ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-star" />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-fringe" />
      )}
      <span className="w-12 shrink-0 font-mono text-[11px] text-ink-faint">{candidate.time}</span>
      <span className="truncate text-[12.5px] text-ink">{candidate.title}</span>
    </button>
  )
}
