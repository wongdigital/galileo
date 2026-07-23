// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityMapModel } from '@renderer/state/useEntityMap'
import { RelatedPanel } from '../RelatedPanel'

const state = vi.hoisted(() => ({
  selectedUid: null as string | null,
  focusedEntityId: null as string | null,
  setSelectedUid: vi.fn(),
  setFocusedEntityId: vi.fn(),
}))

const map = vi.hoisted(() => ({
  current: {
    ready: true,
    indexReady: true,
    lens: 'ip',
    indexes: new Map(),
    hubs: [
      {
        id: 'ip:star-wars',
        kind: 'entity',
        label: 'Star Wars',
        degree: 2,
        entity: { id: 'ip:star-wars', label: 'Star Wars', lens: 'ip' },
      },
      {
        id: 'ip:star-trek',
        kind: 'entity',
        label: 'Star Trek',
        degree: 1,
        entity: { id: 'ip:star-trek', label: 'Star Trek', lens: 'ip' },
      },
    ],
    events: [
      {
        id: 'event:p1',
        kind: 'event',
        uid: 'p1',
        event: { uid: 'p1' },
        title: 'Panel One',
        time: '10:00 AM',
        room: 'Room 1',
        starred: false,
        states: [],
        degree: 1,
        fringe: false,
      },
      {
        id: 'event:p2',
        kind: 'event',
        uid: 'p2',
        event: { uid: 'p2' },
        title: 'Panel Two',
        time: '11:00 AM',
        room: 'Room 2',
        starred: false,
        states: [],
        degree: 1,
        fringe: false,
      },
    ],
    nodes: [],
    links: [
      { source: 'event:p1', target: 'ip:star-wars' },
      { source: 'event:p2', target: 'ip:star-wars' },
    ],
    hubCount: 2,
    connectedCount: 2,
    fringeCount: 0,
    scopeUids: ['p1', 'p2'],
    filterActive: false,
  } as unknown as EntityMapModel,
}))

vi.mock('@renderer/state/spine', () => ({
  useSpine: () => state,
}))

vi.mock('@renderer/state/useEntityMap', () => ({
  useEntityMap: () => map.current,
}))

afterEach(cleanup)

beforeEach(() => {
  state.selectedUid = null
  state.focusedEntityId = null
  state.setSelectedUid.mockReset()
  state.setFocusedEntityId.mockReset()
})

describe('RelatedPanel', () => {
  it('renders a designed no-selection state with keyboard-reachable top hubs', () => {
    render(<RelatedPanel />)

    expect(screen.getByRole('heading', { name: 'Related' })).toBeTruthy()
    expect(screen.getByText(/Choose a hub/)).toBeTruthy()
    const hubs = screen.getAllByRole('button')
    expect(hubs.map((button) => button.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Star Wars'), expect.stringContaining('Star Trek')]),
    )
    for (const hub of hubs) expect(hub.tabIndex).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: /Star Wars/ }))
    expect(state.setFocusedEntityId).toHaveBeenCalledWith('ip:star-wars')
  })

  it('lists every related entity for the selected event as a real button', () => {
    state.selectedUid = 'p1'
    render(<RelatedPanel />)

    expect(screen.getByRole('heading', { name: 'Related to Panel One' })).toBeTruthy()
    const starWars = screen.getByRole('button', { name: /Star Wars/ })
    expect(starWars.tabIndex).toBe(0)
    fireEvent.keyDown(starWars, { key: 'Enter' })
    fireEvent.click(starWars)

    expect(state.setFocusedEntityId).toHaveBeenLastCalledWith('ip:star-wars')
    expect(state.setSelectedUid).toHaveBeenCalledWith(null)
  })

  it('lists a focused entity’s events and keeps selection mutually exclusive', () => {
    state.focusedEntityId = 'ip:star-wars'
    render(<RelatedPanel />)

    expect(screen.getByRole('heading', { name: 'Related to Star Wars' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Panel One/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Panel Two/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Panel Two/ }))
    expect(state.setSelectedUid).toHaveBeenCalledWith('p2')
    expect(state.setFocusedEntityId).toHaveBeenCalledWith(null)
  })
})
