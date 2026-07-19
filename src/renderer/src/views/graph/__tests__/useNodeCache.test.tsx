// @vitest-environment jsdom

/**
 * Object constancy, asserted rather than hoped for.
 *
 * This is the one contract in the graph that no type can enforce and no visual
 * check reliably catches: identity is correct or the layout detonates, and the
 * symptom (every node re-entering from the origin on a refresh) only shows up
 * with the graph open at the moment new data arrives. So the assertions here are
 * on object identity itself — `toBe`, not `toEqual`.
 */

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GraphNodeModel } from '@renderer/state/useGraph'
import type { GraphLink } from '@shared/graph'
import type { ScheduleEvent } from '@shared/schedule'
import { useNodeCache } from '../useNodeCache'

const event = (uid: string): ScheduleEvent => ({
  uid,
  shortId: uid,
  title: `Event ${uid}`,
  start: '2026-07-23T10:00:00-07:00',
  end: '2026-07-23T11:00:00-07:00',
  track: 'PROGRAMS',
  subtypes: [],
  flags: [],
  room: 'Room 1',
  location: 'Room 1',
  description: '',
  url: null,
})

const node = (uid: string, partial: Partial<GraphNodeModel> = {}): GraphNodeModel => ({
  uid,
  event: event(uid),
  title: `Event ${uid}`,
  time: '10:00a',
  room: 'Room 1',
  starred: false,
  states: [],
  seed: false,
  fringe: false,
  ...partial,
})

const link = (source: string, target: string): GraphLink => ({
  source,
  target,
  entities: [{ id: 'ip:x', label: 'X', lens: 'ip' }],
  strength: 1,
})

describe('useNodeCache', () => {
  it('keeps the same node object across a re-render', () => {
    const models = [node('a', { seed: true }), node('b')]
    const { result, rerender } = renderHook(
      ({ m, l }: { m: GraphNodeModel[]; l: GraphLink[] }) => useNodeCache(m, l),
      { initialProps: { m: models, l: [link('a', 'b')] } },
    )
    const first = result.current.nodes.find((n) => n.id === 'b')!
    first.x = 120
    first.y = -40

    // A star click produces a new model array with the same UIDs. The node
    // object — and therefore its position — has to survive it.
    rerender({ m: [node('a', { seed: true }), node('b', { starred: true })], l: [link('a', 'b')] })

    const second = result.current.nodes.find((n) => n.id === 'b')!
    expect(second).toBe(first)
    expect(second.x).toBe(120)
    expect(second.y).toBe(-40)
    expect(second.model.starred).toBe(true)
  })

  it('keeps node objects across a lens switch and swaps only links', () => {
    const models = [node('a', { seed: true }), node('b')]
    const { result, rerender } = renderHook(
      ({ l }: { l: GraphLink[] }) => useNodeCache(models, l),
      { initialProps: { l: [link('a', 'b')] } },
    )
    const before = [...result.current.nodes]

    rerender({ l: [] })

    expect(result.current.nodes[0]).toBe(before[0])
    expect(result.current.nodes[1]).toBe(before[1])
    expect(result.current.links).toHaveLength(0)
    expect(result.current.nodesChanged).toBe(false)
  })

  it('spawns a new node at a neighbour position, not at the origin', () => {
    const { result, rerender } = renderHook(
      ({ m, l }: { m: GraphNodeModel[]; l: GraphLink[] }) => useNodeCache(m, l),
      { initialProps: { m: [node('a', { seed: true })], l: [] as GraphLink[] } },
    )
    const seedNode = result.current.nodes[0]!
    seedNode.x = 300
    seedNode.y = 300

    rerender({ m: [node('a', { seed: true }), node('b')], l: [link('a', 'b')] })

    const added = result.current.nodes.find((n) => n.id === 'b')!
    // Near its neighbour — a streak in from (0,0) is what this prevents.
    expect(Math.abs(added.x! - 300)).toBeLessThan(20)
    expect(Math.abs(added.y! - 300)).toBeLessThan(20)
    expect(result.current.nodesChanged).toBe(true)
  })

  it('drops removed UIDs and keeps the survivors, which is a refresh', () => {
    const { result, rerender } = renderHook(
      ({ m }: { m: GraphNodeModel[] }) => useNodeCache(m, []),
      { initialProps: { m: [node('a', { seed: true }), node('b'), node('c')] } },
    )
    const survivor = result.current.nodes.find((n) => n.id === 'b')!
    survivor.x = 55

    rerender({ m: [node('a', { seed: true }), node('b')] })

    expect(result.current.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(result.current.nodes.find((n) => n.id === 'b')).toBe(survivor)
    expect(survivor.x).toBe(55)
    expect(result.current.nodesChanged).toBe(true)
  })

  it('pins a single seed and unpins it when the seed moves', () => {
    const { result, rerender } = renderHook(
      ({ m }: { m: GraphNodeModel[] }) => useNodeCache(m, []),
      { initialProps: { m: [node('a', { seed: true }), node('b')] } },
    )
    expect(result.current.nodes.find((n) => n.id === 'a')?.fx).toBe(0)
    expect(result.current.nodes.find((n) => n.id === 'b')?.fx).toBeUndefined()

    rerender({ m: [node('a'), node('b', { seed: true })] })

    expect(result.current.nodes.find((n) => n.id === 'a')?.fx).toBeUndefined()
    expect(result.current.nodes.find((n) => n.id === 'b')?.fx).toBe(0)
  })

  it('leaves a multi-seed set unpinned', () => {
    const { result } = renderHook(() =>
      useNodeCache([node('a', { seed: true }), node('b', { seed: true })], []),
    )
    expect(result.current.nodes.every((n) => n.fx === undefined)).toBe(true)
  })
})
