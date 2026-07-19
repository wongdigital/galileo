// @vitest-environment jsdom

/**
 * Object constancy, asserted rather than hoped for.
 *
 * This is the one contract in the map that no type can enforce and no visual
 * check reliably catches: identity is correct or the layout detonates, and the
 * symptom (every node re-entering from the origin on a lens switch) only shows
 * up with the map open at the moment the data changes. So the assertions here
 * are on object identity itself — `toBe`, not `toEqual`.
 *
 * The lens-switch test is the load-bearing one: hubs are expected to be
 * replaced, event dots are expected to survive untouched, and `nodesChanged`
 * has to tell those two apart so the view knows whether to re-fit.
 */

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EntityMapEvent, EntityMapHub, EntityMapNode } from '@renderer/state/useEntityMap'
import { eventNodeId, type BipartiteLink } from '@shared/graph'
import type { ScheduleEvent } from '@shared/schedule'
import { useNodeCache, type GraphNodeObject } from '../useNodeCache'

const scheduleEvent = (uid: string): ScheduleEvent => ({
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

const evt = (uid: string, partial: Partial<EntityMapEvent> = {}): EntityMapEvent => ({
  id: eventNodeId(uid),
  kind: 'event',
  uid,
  event: scheduleEvent(uid),
  title: `Event ${uid}`,
  time: '10:00a',
  room: 'Room 1',
  starred: false,
  states: [],
  degree: 1,
  fringe: false,
  ...partial,
})

const hub = (id: string, partial: Partial<EntityMapHub> = {}): EntityMapHub => ({
  id,
  kind: 'entity',
  label: id,
  degree: 2,
  entity: { id, label: id, lens: 'ip' },
  ...partial,
})

/** Links always run event -> entity, as the builder emits them. */
const link = (uid: string, entityId: string): BipartiteLink => ({
  source: eventNodeId(uid),
  target: entityId,
})

/** Half of `JITTER`, plus room for a hub's own jitter on top of a jittered
 *  neighbour — the first build places everything within one hop of the origin. */
const JITTER_BOUND = 24

type Props = { m: EntityMapNode[]; l: BipartiteLink[] }
const mount = (initialProps: Props) =>
  renderHook(({ m, l }: Props) => useNodeCache(m, l), { initialProps })

const byId = (nodes: readonly GraphNodeObject[], id: string): GraphNodeObject =>
  nodes.find((n) => n.id === id)!

describe('useNodeCache — identity', () => {
  it('keeps the same node object across a re-render', () => {
    const { result, rerender } = mount({
      m: [hub('ip:x'), evt('a'), evt('b')],
      l: [link('a', 'ip:x'), link('b', 'ip:x')],
    })
    const first = byId(result.current.nodes, 'event:b')
    first.x = 120
    first.y = -40

    // A star click produces a new model array with the same ids. The node
    // object — and therefore its position — has to survive it.
    rerender({
      m: [hub('ip:x'), evt('a'), evt('b', { starred: true })],
      l: [link('a', 'ip:x'), link('b', 'ip:x')],
    })

    const second = byId(result.current.nodes, 'event:b')
    expect(second).toBe(first)
    expect(second.x).toBe(120)
    expect(second.y).toBe(-40)
    expect((second.model as EntityMapEvent).starred).toBe(true)
  })

  it('drops removed events and keeps the survivors, which is a refresh', () => {
    const { result, rerender } = mount({ m: [evt('a'), evt('b'), evt('c')], l: [] })
    const survivor = byId(result.current.nodes, 'event:b')
    survivor.x = 55

    rerender({ m: [evt('a'), evt('b')], l: [] })

    expect(result.current.nodes.map((n) => n.id)).toEqual(['event:a', 'event:b'])
    expect(byId(result.current.nodes, 'event:b')).toBe(survivor)
    expect(survivor.x).toBe(55)
    expect(result.current.nodesChanged).toBe(true)
  })

  it('rebuilds link objects every pass, since force-graph mutates them', () => {
    const { result, rerender } = mount({ m: [hub('ip:x'), evt('a')], l: [link('a', 'ip:x')] })
    const before = result.current.links[0]

    rerender({ m: [hub('ip:x'), evt('a')], l: [link('a', 'ip:x')] })

    expect(result.current.links[0]).not.toBe(before)
    expect(result.current.links[0]).toEqual({ source: 'event:a', target: 'ip:x' })
  })
})

/**
 * The whole point of the `event:` prefix. An event's id never mentions the lens,
 * so a lens switch is a cache hit for every dot and a miss for every hub — and
 * `nodesChanged` must stay false so the view does not re-fit mid-reorganization.
 */
describe('useNodeCache — lens switch (R3, AE4)', () => {
  it('keeps every event object and swaps only the hubs', () => {
    const { result, rerender } = mount({
      m: [hub('ip:x'), evt('a'), evt('b')],
      l: [link('a', 'ip:x'), link('b', 'ip:x')],
    })
    const eventsBefore = result.current.nodes.filter((n) => n.model.kind === 'event')
    eventsBefore.forEach((n, i) => {
      n.x = 100 * (i + 1)
      n.y = 50
    })

    // ip -> people: a different hub, over the same two events.
    rerender({
      m: [hub('person:ada'), evt('a'), evt('b')],
      l: [link('a', 'person:ada'), link('b', 'person:ada')],
    })

    expect(byId(result.current.nodes, 'event:a')).toBe(eventsBefore[0])
    expect(byId(result.current.nodes, 'event:b')).toBe(eventsBefore[1])
    expect(byId(result.current.nodes, 'event:a').x).toBe(100)
    expect(result.current.nodes.map((n) => n.id)).toContain('person:ada')
    expect(result.current.nodes.map((n) => n.id)).not.toContain('ip:x')
  })

  it('reports nodesChanged false when only hubs swapped', () => {
    const { result, rerender } = mount({
      m: [hub('ip:x'), evt('a'), evt('b')],
      l: [link('a', 'ip:x'), link('b', 'ip:x')],
    })

    rerender({
      m: [hub('person:ada'), evt('a'), evt('b')],
      l: [link('a', 'person:ada'), link('b', 'person:ada')],
    })

    expect(result.current.nodesChanged).toBe(false)
  })

  it('reports nodesChanged true when the filter narrows the event population', () => {
    const { result, rerender } = mount({
      m: [hub('ip:x'), evt('a'), evt('b')],
      l: [link('a', 'ip:x'), link('b', 'ip:x')],
    })

    rerender({ m: [evt('a')], l: [] })

    expect(result.current.nodesChanged).toBe(true)
  })

  it('stays false when an event only moves between the core and the fringe', () => {
    const { result, rerender } = mount({
      m: [hub('ip:x'), evt('a'), evt('b')],
      l: [link('a', 'ip:x'), link('b', 'ip:x')],
    })

    // Same two events, but nothing joins them under the new lens — every dot
    // becomes fringe. The population did not change, so neither does the fit.
    rerender({ m: [evt('a', { fringe: true, degree: 0 }), evt('b', { fringe: true, degree: 0 })], l: [] })

    expect(result.current.nodesChanged).toBe(false)
    expect((byId(result.current.nodes, 'event:a').model as EntityMapEvent).fringe).toBe(true)
  })
})

describe('useNodeCache — spawning', () => {
  it('spawns a new event beside a hub it carries, not at the origin', () => {
    const { result, rerender } = mount({ m: [hub('ip:x')], l: [] })
    const hubNode = result.current.nodes[0]!
    hubNode.x = 300
    hubNode.y = 300

    rerender({ m: [hub('ip:x'), evt('a')], l: [link('a', 'ip:x')] })

    const added = byId(result.current.nodes, 'event:a')
    expect(Math.abs(added.x! - 300)).toBeLessThan(20)
    expect(Math.abs(added.y! - 300)).toBeLessThan(20)
    expect(result.current.nodesChanged).toBe(true)
  })

  /**
   * A hub entering on a lens switch eases out of the middle of its cluster.
   * Spawning it beside one arbitrary member would streak it across the canvas
   * from wherever that member happens to sit.
   */
  it('spawns a hub at the centroid of its member events', () => {
    const { result, rerender } = mount({ m: [evt('a'), evt('b'), evt('c')], l: [] })
    const positions: Record<string, [number, number]> = {
      'event:a': [0, 0],
      'event:b': [200, 0],
      'event:c': [100, 300],
    }
    for (const node of result.current.nodes) {
      ;[node.x, node.y] = positions[node.id]!
    }

    rerender({
      m: [hub('ip:x'), evt('a'), evt('b'), evt('c')],
      l: [link('a', 'ip:x'), link('b', 'ip:x'), link('c', 'ip:x')],
    })

    const added = byId(result.current.nodes, 'ip:x')
    // Centroid of (0,0), (200,0), (100,300) is (100,100).
    expect(Math.abs(added.x! - 100)).toBeLessThan(20)
    expect(Math.abs(added.y! - 100)).toBeLessThan(20)
    // A hub arriving is not a scope change.
    expect(result.current.nodesChanged).toBe(false)
  })

  it('ignores unpositioned members when averaging', () => {
    const { result, rerender } = mount({ m: [evt('a'), evt('b')], l: [] })
    const a = byId(result.current.nodes, 'event:a')
    a.x = 500
    a.y = 500
    const b = byId(result.current.nodes, 'event:b')
    b.x = undefined
    b.y = undefined

    rerender({
      m: [hub('ip:x'), evt('a'), evt('b')],
      l: [link('a', 'ip:x'), link('b', 'ip:x')],
    })

    const added = byId(result.current.nodes, 'ip:x')
    expect(Math.abs(added.x! - 500)).toBeLessThan(20)
    expect(Math.abs(added.y! - 500)).toBeLessThan(20)
  })

  it('falls back to the origin region when nothing is placed yet', () => {
    const { result } = mount({ m: [hub('ip:x'), evt('a')], l: [link('a', 'ip:x')] })

    for (const node of result.current.nodes) {
      expect(Math.abs(node.x!)).toBeLessThanOrEqual(JITTER_BOUND)
      expect(Math.abs(node.y!)).toBeLessThanOrEqual(JITTER_BOUND)
    }
  })

  it('never pins a node — the seed model is gone', () => {
    const { result } = mount({
      m: [hub('ip:x'), evt('a'), evt('b')],
      l: [link('a', 'ip:x'), link('b', 'ip:x')],
    })

    expect(result.current.nodes.every((n) => n.fx === undefined && n.fy === undefined)).toBe(true)
  })
})
