import { describe, expect, it } from 'vitest'
import { runChatTurn, type ChatDeps, type GenerateFn } from '../loop'
import { EMPTY_FILTER, type FilterCandidate } from '../../../shared/filter/types'
import type { ChatRequest } from '../../../shared/chat'
import type { ScheduleEvent } from '../../../shared/schedule'

const candidates: FilterCandidate[] = [
  { uid: 'a', dimensions: { genre: ['Horror'] }, haystack: 'panel a horror' },
  { uid: 'b', dimensions: { genre: ['Comedy'] }, haystack: 'panel b comedy' },
]
const events: ScheduleEvent[] = candidates.map((c, i) => ({
  uid: c.uid,
  shortId: null,
  title: `Panel ${c.uid}`,
  start: null,
  end: null,
  track: null,
  subtypes: [],
  flags: [],
  room: `Room ${i}`,
  location: '',
  description: `desc ${c.uid}`,
  url: null,
}))

const request: ChatRequest = {
  provider: 'anthropic',
  messages: [{ role: 'user', content: 'show me horror' }],
  filter: EMPTY_FILTER,
  lens: 'ip',
  view: 'schedule',
  starredUids: [],
  changedUids: [],
}

const call = (input: unknown, tool: { execute?: unknown }): Promise<unknown> =>
  (tool.execute as (i: unknown, o: unknown) => Promise<unknown>)(input, { toolCallId: 't', messages: [] })

function deps(generate: GenerateFn, key: string | null = 'sk-test'): ChatDeps {
  return {
    keyStore: { get: () => key },
    getEvents: () => events,
    getCandidates: () => candidates,
    generate,
  }
}

describe('runChatTurn', () => {
  it('returns no-key without calling the model when no key is stored', async () => {
    let called = false
    const generate: GenerateFn = async () => {
      called = true
      return { text: '' }
    }
    const res = await runChatTurn(deps(generate, null), request)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('no-key')
    expect(called).toBe(false)
  })

  it('assembles the turn from the effects the tools captured', async () => {
    const generate: GenerateFn = async ({ tools }) => {
      await call({ add: [{ dimension: 'genre', value: 'horror' }] }, tools.apply_filters)
      await call({ uid: 'a' }, tools.get_event)
      return { text: 'Filtered to horror; here is Panel a.' }
    }
    const res = await runChatTurn(deps(generate), request)

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.turn.message.content).toBe('Filtered to horror; here is Panel a.')
    expect(res.turn.patch?.filter?.chips).toEqual([{ dimension: 'genre', value: 'Horror' }])
    expect(res.turn.eventUids).toEqual(['a'])
    expect(res.turn.toolTrace).toEqual(['apply_filters', 'get_event'])
    expect(res.turn.proposedAction).toBeUndefined()
  })

  it('surfaces a proposed action from the turn', async () => {
    const generate: GenerateFn = async ({ tools }) => {
      await call({ kind: 'star', uids: ['a'] }, tools.propose_action)
      return { text: 'Star Panel a?' }
    }
    const res = await runChatTurn(deps(generate), request)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.turn.proposedAction?.kind).toBe('star')
    expect(res.turn.proposedAction?.events[0]?.uid).toBe('a')
  })

  it('classifies a 401 as an auth error the tab can act on', async () => {
    const generate: GenerateFn = async () => {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    }
    const res = await runChatTurn(deps(generate), request)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('auth')
  })

  it('classifies an unknown failure as a provider error', async () => {
    const generate: GenerateFn = async () => {
      throw new Error('socket hang up')
    }
    const res = await runChatTurn(deps(generate), request)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.kind).toBe('provider')
      expect(res.error.message).toMatch(/socket hang up/)
    }
  })
})
