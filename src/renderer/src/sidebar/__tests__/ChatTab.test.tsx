// @vitest-environment jsdom

/**
 * The chat tab end to end against a faked bridge: key gating, a turn that
 * drives the filter, event references, and a proposed action that only commits
 * on a tap. The real spine and filter engine run; only window.api is faked.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpineProvider, useSpine } from '../../state/spine'
import { ChatTab } from '../ChatTab'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'
import type { ChatResponse, KeyStatus } from '@shared/chat'
import type { StarRecord } from '@shared/stars'

vi.mock('@data/enrichment.json', () => ({
  default: {
    schema_version: 1,
    generated_at: '2026-07-18T00:00:00Z',
    provenance: { model: 't', batch_id: 't', franchise_seed_version: 1, system_prompt_sha: 't', event_count: 0 },
    entries: {},
  },
}))

const SAT = '2026-07-25'

function event(uid: string, partial: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    uid,
    shortId: null,
    title: `Event ${uid}`,
    start: `${SAT}T10:00:00-07:00`,
    end: `${SAT}T10:50:00-07:00`,
    track: '1: PROGRAMS',
    subtypes: [],
    flags: [],
    room: 'Room 5AB',
    location: 'Room 5AB',
    description: '',
    url: null,
    ...partial,
  }
}

const HORROR = event('horror-sat', { title: 'Drawing Monsters for a Living', subtypes: ['Horror and Suspense'] })
const COMICS = event('comics-sat', { title: 'Inking Techniques Workshop', subtypes: ['Comics'] })

function projection(): DatasetProjection {
  return { events: [HORROR, COMICS], changes: {}, fetchedAt: '2026-07-20T18:00:00.000Z', stale: false }
}

const HORROR_FILTER = { chips: [{ dimension: 'genre', value: 'Horror' }], text: '', starredOnly: false, changedOnly: false }

let persisted: StarRecord[]
let keyStatus: KeyStatus
let chat: ReturnType<typeof vi.fn>
let syncDataset: ReturnType<typeof vi.fn>
let setKey: ReturnType<typeof vi.fn>

beforeEach(() => {
  persisted = []
  keyStatus = { anthropic: true, openai: false, openrouter: false }
  chat = vi.fn()
  syncDataset = vi.fn().mockResolvedValue({ received: 2 })
  setKey = vi.fn((provider: string) => Promise.resolve({ ok: true, status: { ...keyStatus, [provider]: true } }))
  ;(window as unknown as { api: unknown }).api = {
    schedule: { refresh: vi.fn().mockResolvedValue(projection()) },
    changes: { acknowledge: vi.fn().mockResolvedValue({}) },
    stars: {
      get: vi.fn(() => Promise.resolve(persisted)),
      set: vi.fn((stars: StarRecord[]) => {
        persisted = stars
        return Promise.resolve(persisted)
      }),
    },
    export: { ics: vi.fn() },
    llm: {
      keyStatus: vi.fn(() => Promise.resolve(keyStatus)),
      setKey,
      clearKey: vi.fn(() => Promise.resolve(keyStatus)),
      syncDataset,
      chat,
    },
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as unknown as { api?: unknown }).api
})

function FilterProbe() {
  const { filter } = useSpine()
  return <div data-testid="chips">{filter.chips.map((c) => `${c.dimension}:${c.value}`).join(',')}</div>
}

async function mount() {
  const view = render(
    <SpineProvider>
      <ChatTab />
      <FilterProbe />
    </SpineProvider>,
  )
  // The dataset load settles before we drive the tab.
  await waitFor(() => expect(syncDataset).toHaveBeenCalled())
  return view
}

async function sendMessage(text: string) {
  const box = screen.getByPlaceholderText('Ask, filter, or plan…') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('ChatTab', () => {
  it('opens setup and disables the composer when no key is stored', async () => {
    keyStatus = { anthropic: false, openai: false, openrouter: false }
    render(
      <SpineProvider>
        <ChatTab />
      </SpineProvider>,
    )
    await waitFor(() => expect(screen.getByText('Model & keys')).toBeTruthy())
    expect(screen.getByPlaceholderText(/Anthropic API key/)).toBeTruthy()
    expect((screen.getByPlaceholderText('Add an API key to start') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('remembers a draft key for one provider while entering another', async () => {
    keyStatus = { anthropic: false, openai: false, openrouter: false }
    render(
      <SpineProvider>
        <ChatTab />
      </SpineProvider>,
    )
    await waitFor(() => expect(screen.getByText('Model & keys')).toBeTruthy())

    const keyField = () => screen.getByLabelText('API key', { selector: 'input' }) as HTMLInputElement
    fireEvent.change(keyField(), { target: { value: 'sk-ant-draft' } })

    // Switch to OpenAI, type its key, then back — the Anthropic draft survives.
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } })
    expect(keyField().value).toBe('')
    fireEvent.change(keyField(), { target: { value: 'sk-oai-draft' } })
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'anthropic' } })
    expect(keyField().value).toBe('sk-ant-draft')

    // Save persists every provider that got a draft, and closes setup.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(setKey).toHaveBeenCalledWith('anthropic', 'sk-ant-draft'))
    expect(setKey).toHaveBeenCalledWith('openai', 'sk-oai-draft')
  })

  it('syncs the candidate index to main on load', async () => {
    await mount()
    expect(syncDataset).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ uid: 'horror-sat' })]))
  })

  it('applies a returned filter patch through the spine and renders the reply', async () => {
    const response: ChatResponse = {
      ok: true,
      turn: {
        message: { role: 'assistant', content: '1 event matches Horror — filtered.' },
        patch: { filter: HORROR_FILTER },
        eventUids: ['horror-sat'],
        toolTrace: ['apply_filters', 'get_event'],
      },
    }
    chat.mockResolvedValue(response)
    await mount()

    await sendMessage("I'm into horror")

    await waitFor(() => expect(screen.getByText('1 event matches Horror — filtered.')).toBeTruthy())
    // The patch reached the spine — same object a chip click would build.
    expect(screen.getByTestId('chips').textContent).toBe('genre:Horror')
    // The get_event uid rendered as a reference.
    expect(screen.getByText('Drawing Monsters for a Living')).toBeTruthy()
    // The user's message is echoed too.
    expect(screen.getByText("I'm into horror")).toBeTruthy()
  })

  it('sends the current state snapshot with the turn', async () => {
    chat.mockResolvedValue({
      ok: true,
      turn: { message: { role: 'assistant', content: 'ok' }, eventUids: [], toolTrace: [] },
    })
    await mount()
    await sendMessage('hello')
    await waitFor(() => expect(chat).toHaveBeenCalled())
    const request = chat.mock.calls[0]![0]
    expect(request.provider).toBe('anthropic')
    expect(request.messages.at(-1)).toEqual({ role: 'user', content: 'hello' })
    expect(request.filter).toBeDefined()
    expect(request.lens).toBe('ip')
  })

  it('proposes a star action that only commits on confirm', async () => {
    chat.mockResolvedValue({
      ok: true,
      turn: {
        message: { role: 'assistant', content: 'Star this?' },
        eventUids: [],
        proposedAction: {
          kind: 'star',
          events: [{ uid: 'horror-sat', title: 'Drawing Monsters for a Living', start: `${SAT}T10:00:00-07:00`, room: 'Room 5AB', track: '1: PROGRAMS' }],
        },
        toolTrace: ['propose_action'],
      },
    })
    await mount()
    await sendMessage('star the horror panel')

    const confirm = await screen.findByRole('button', { name: /Star 1/ })
    // Nothing committed yet.
    expect(persisted).toEqual([])

    fireEvent.click(confirm)
    await waitFor(() => expect(persisted.some((s) => s.uid === 'horror-sat')).toBe(true))
    expect(screen.getByText('Starred.')).toBeTruthy()
  })

  it('surfaces a rejected key and opens the key panel', async () => {
    chat.mockResolvedValue({ ok: false, error: { kind: 'auth', message: 'The API key was rejected. Check it and try again.' } })
    await mount()
    await sendMessage('hi')
    await waitFor(() => expect(screen.getByText(/API key was rejected/)).toBeTruthy())
    // Setup reopens so the user can fix the key.
    expect(screen.getByText('Model & keys')).toBeTruthy()
  })
})
