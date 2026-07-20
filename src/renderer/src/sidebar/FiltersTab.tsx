/**
 * The Filters tab — the single source of truth for what the views show (R12).
 *
 * The sidebar's job is to make the union/intersection rule legible without
 * explaining it. Interest dimensions say "any of these" in their header;
 * constraint dimensions say "narrow to". That is the whole UI affordance for
 * the semantics: click two genres and you get more, click two constraints and
 * you get less, and the headers told you which was which before you clicked.
 */

import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  EMPTY_FILTER,
  FILTER_DIMENSIONS,
  facetOptions,
  hasChip,
  toggleChip,
  type FilterChip,
  type FilterDimension,
} from '@shared/filter'
import { useSpine } from '@renderer/state/spine'
import { useSchedule } from '@renderer/state/useSchedule'
import { valueLabel } from './labels'

/** Values below this in a dimension stay behind "show all" — a rail with 26
 *  genres on it is a rail nobody reads to the bottom of. */
const VISIBLE_VALUES = 8

/** Facet chips are tri-state on constraint dimensions: off, included (lumen),
 *  excluded (cancelled, "not" prefixed — the same language the active-chips
 *  row and the chat compiler use). */
type ChipState = 'off' | 'on' | 'not'

function Chip({
  chip,
  count,
  state,
  title,
  onClick,
}: {
  chip: FilterChip
  count?: number
  state: ChipState
  title?: string
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={state !== 'off'}
      title={title}
      onClick={onClick}
      className={[
        'flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-all duration-150',
        state === 'on'
          ? 'border-lumen-dim bg-lumen/10 text-ink-bright shadow-[0_0_12px_-4px_var(--color-lumen)]'
          : state === 'not'
            ? 'border-cancelled/60 bg-cancelled/10 text-ink-bright shadow-[0_0_12px_-4px_var(--color-cancelled)]'
            : 'border-line bg-ground-850 text-ink-dim hover:border-line-strong hover:text-ink',
      ].join(' ')}
    >
      {state === 'not' ? <span className="text-cancelled">not</span> : null}
      <span className="truncate">{valueLabel(chip.dimension, chip.value)}</span>
      {count !== undefined ? (
        <span
          className={`font-mono text-[10px] ${
            state === 'on' ? 'text-lumen' : state === 'not' ? 'text-cancelled' : 'text-ink-fringe'
          }`}
        >
          {count.toLocaleString()}
        </span>
      ) : null}
    </button>
  )
}

function DimensionSection({ dimension }: { dimension: FilterDimension }) {
  const { filter, setFilter } = useSpine()
  const { candidates, matchContext } = useSchedule()
  const [expanded, setExpanded] = useState(false)

  const options = useMemo(
    () => facetOptions(candidates, filter, matchContext, dimension.id),
    [candidates, filter, matchContext, dimension.id],
  )

  // A dimension with no values in the corpus renders nothing at all. This is
  // how `ip` and `person` stay registered in the engine while their compiled
  // data has not reached the renderer yet — no placeholder, no empty section.
  if (options.length === 0) return null

  const shown = expanded ? options : options.slice(0, VISIBLE_VALUES)

  return (
    <section className="flex flex-col gap-2 border-b border-line-soft px-4 py-3.5">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-dim">
          {dimension.label}
        </h3>
        <span className="text-[10px] text-ink-fringe">
          {dimension.kind === 'interest' ? 'any of' : 'narrow to'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {shown.map((option) => {
          const chip: FilterChip = { dimension: option.dimension, value: option.value }
          const negChip: FilterChip = { ...chip, negated: true }
          const state: ChipState = hasChip(filter, chip) ? 'on' : hasChip(filter, negChip) ? 'not' : 'off'
          // Exclusion is constraints-only, mirroring the FilterChip contract:
          // negating an interest in an additive union would remove nothing.
          const canNegate = dimension.kind === 'constraint'
          return (
            <Chip
              key={option.value}
              chip={chip}
              count={option.count}
              state={state}
              title={
                canNegate
                  ? state === 'not'
                    ? '⌥-click to clear the exclusion'
                    : '⌥-click to exclude'
                  : undefined
              }
              // toggleChip on the opposite sign *replaces* (addChip drops the
              // twin), so this one call is the whole tri-state machine:
              // click ↔ include, ⌥-click ↔ exclude, each converting the other.
              onClick={(e) => setFilter(toggleChip(filter, canNegate && e.altKey ? negChip : chip))}
            />
          )
        })}
        {options.length > VISIBLE_VALUES ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-full px-2 py-1 text-[11px] text-ink-faint transition-colors duration-150 hover:text-lumen"
          >
            {expanded ? 'less' : `+${options.length - VISIBLE_VALUES} more`}
          </button>
        ) : null}
      </div>
    </section>
  )
}

function ActiveChips() {
  const { filter, setFilter } = useSpine()
  if (filter.chips.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-3">
      {filter.chips.map((chip) => (
        <button
          key={`${chip.dimension}:${chip.value}:${chip.negated ? 'not' : ''}`}
          type="button"
          onClick={() => setFilter(toggleChip(filter, chip))}
          title="Remove"
          className="flex items-center gap-1.5 rounded-full border border-lumen-dim bg-lumen/10 px-2.5 py-1 text-[11.5px] text-ink-bright transition-colors duration-150 hover:border-cancelled/60 hover:text-cancelled"
        >
          {chip.negated ? <span className="text-cancelled">not</span> : null}
          <span className="truncate">{valueLabel(chip.dimension, chip.value)}</span>
          <span aria-hidden="true" className="text-ink-faint">
            ×
          </span>
        </button>
      ))}
    </div>
  )
}

function Toggle({
  label,
  active,
  onClick,
  accent,
}: {
  label: string
  active: boolean
  onClick: () => void
  accent: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        'flex-1 rounded-md border px-2 py-1.5 text-[11.5px] transition-colors duration-150',
        active ? 'bg-ground-800 text-ink-bright' : 'border-line text-ink-dim hover:text-ink',
      ].join(' ')}
      style={active ? { borderColor: accent, color: accent } : undefined}
    >
      {label}
    </button>
  )
}

export function FiltersTab() {
  const { filter, setFilter, status, refresh, dataset } = useSpine()
  const { filteredCount, totalCount, allGhosts } = useSchedule()

  const changedCount = Object.keys(dataset?.changes ?? {}).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* h-rail: the second beat — this row, the chat's Concierge row, and the
          schedule's Open-all-day shelf header share it, so the second hairline
          is also continuous across the seam. */}
      <div className="flex h-rail shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="font-mono text-[12px] text-lumen">{filteredCount.toLocaleString()}</span>
        <span className="text-[11px] text-ink-faint">of {totalCount.toLocaleString()}</span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={status === 'loading'}
          title="Fetch the latest schedule from Sched"
          className="ml-auto rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim transition-colors duration-150 hover:border-lumen-dim hover:text-lumen disabled:opacity-40"
        >
          {status === 'loading' ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="shrink-0 border-b border-line px-4 py-3">
        <input
          type="search"
          value={filter.text}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
          placeholder="Search titles, rooms, descriptions"
          className="w-full rounded-md border border-line bg-ground-850 px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-fringe focus:border-lumen-dim focus:outline-none"
        />
        <div className="mt-2 flex gap-1.5">
          <Toggle
            label="Starred"
            active={filter.starredOnly}
            accent="var(--color-star)"
            onClick={() => setFilter({ ...filter, starredOnly: !filter.starredOnly })}
          />
          <Toggle
            label={changedCount > 0 ? `Changed ${changedCount}` : 'Changed'}
            active={filter.changedOnly}
            accent="var(--color-moved)"
            onClick={() => setFilter({ ...filter, changedOnly: !filter.changedOnly })}
          />
        </div>
        {allGhosts.length > 0 ? (
          <p className="mt-2 text-[11px] text-cancelled">
            {allGhosts.length} starred {allGhosts.length === 1 ? 'event is' : 'events are'} no
            longer in the feed
          </p>
        ) : null}
      </div>

      <ActiveChips />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {FILTER_DIMENSIONS.filter((d) => d.rail === 'primary').map((dimension) => (
          <DimensionSection key={dimension.id} dimension={dimension} />
        ))}
        <MoreFilters />
      </div>

      <button
        type="button"
        onClick={() => setFilter(EMPTY_FILTER)}
        className="shrink-0 border-t border-line px-4 py-2.5 text-left text-[11.5px] text-ink-faint transition-colors duration-150 hover:text-cancelled"
      >
        Clear all filters
      </button>
    </div>
  )
}

function MoreFilters() {
  const [open, setOpen] = useState(false)
  const more = FILTER_DIMENSIONS.filter((d) => d.rail === 'more')

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint transition-colors duration-150 hover:text-ink-dim"
      >
        <span
          className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          ▸
        </span>
        More filters
      </button>
      {open ? more.map((d) => <DimensionSection key={d.id} dimension={d} />) : null}
    </>
  )
}
