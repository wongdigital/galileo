// @vitest-environment jsdom

/**
 * The chat tab end to end against a faked bridge: key gating, a turn that
 * drives the filter, event references, and a proposed action that only commits
 * on a tap. The real spine and filter engine run; only the platform bridge is faked.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpineProvider, useSpine } from '../../state/spine'
import { ChatTab } from '../ChatTab'
import type { DatasetProjection, ScheduleEvent } from '@shared/schedule'
import type { ChatResponse, KeyStatus } from '@shared/chat'
import type { StarRecord } from '@shared/stars'
import { clearFakeBridge, installFakeBridge, type FakePlatformBridge } from '../../test/fakeBridge'
import type { PlatformBridge } from '@shared/bridge/types'
import { defaultModels } from '../chatModels'

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
let chat: FakePlatformBridge['llm']['chat']
let syncDataset: FakePlatformBridge['llm']['syncDataset']
let setKey: FakePlatformBridge['llm']['setKey']
let deltaCb: ((d: { text?: string; status?: string }) => void) | null
let api: FakePlatformBridge

beforeEach(() => {
  persisted = []
  keyStatus = { anthropic: 'present', openai: 'absent', openrouter: 'absent' }
  chat = vi.fn<PlatformBridge['llm']['chat']>()
  syncDataset = vi.fn<PlatformBridge['llm']['syncDataset']>().mockResolvedValue({ received: 2 })
  setKey = vi.fn<PlatformBridge['llm']['setKey']>((provider) =>
    Promise.resolve({ ok: true, status: { ...keyStatus, [provider]: 'present' } }),
  )
  api = installFakeBridge({
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
      models: vi.fn(() => Promise.resolve([])),
      syncDataset,
      chat,
      cancelChat: vi.fn(() => Promise.resolve({ cancelled: true })),
      onChatDelta: vi.fn((cb: (d: { text?: string; status?: string }) => void) => {
        deltaCb = cb
        return () => {
          deltaCb = null
        }
      }),
    },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  clearFakeBridge()
})

function FilterProbe() {
  const { filter } = useSpine()
  return <div data-testid="chips">{filter.chips.map((c) => `${c.dimension}:${c.value}`).join(',')}</div>
}

function SelectionProbe() {
  const { selectedUid } = useSpine()
  return <div data-testid="sel">{selectedUid ?? ''}</div>
}

function StateProbe() {
  const { view, lens } = useSpine()
  return (
    <div>
      <span data-testid="view">{view}</span>
      <span data-testid="lens">{lens}</span>
    </div>
  )
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
  // The composer stays disabled until the first dataset sync lands; the ready
  // placeholder only appears once it does, so this also waits out that gate.
  const box = (await screen.findByPlaceholderText('Ask, filter, or plan…')) as HTMLTextAreaElement
  await waitFor(() => expect(box.disabled).toBe(false))
  fireEvent.change(box, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('ChatTab', () => {
  it('keeps the transcript session-only across a fresh mount', async () => {
    chat.mockResolvedValue({
      ok: true,
      turn: {
        message: { role: 'assistant', content: 'A session-only answer.' },
        eventUids: [],
        toolTrace: [],
      },
    })
    const view = await mount()
    await sendMessage('remember this for now')
    await screen.findByText('A session-only answer.')

    view.unmount()
    await mount()

    expect(screen.queryByText('A session-only answer.')).toBeNull()
    expect(api.settings.set).not.toHaveBeenCalledWith(
      expect.stringMatching(/chat.*(entries|transcript|history)/i),
      expect.anything(),
    )
  })

  it('opens setup and disables the composer when no key is stored', async () => {
    keyStatus = { anthropic: 'absent', openai: 'absent', openrouter: 'absent' }
    render(
      <SpineProvider>
        <ChatTab />
      </SpineProvider>,
    )
    await waitFor(() => expect(screen.getByText('Model & keys')).toBeTruthy())
    expect(screen.getByPlaceholderText(/Anthropic API key/)).toBeTruthy()
    expect((screen.getByPlaceholderText('Add an API key to start') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('does not let a slow model restore overwrite a new selection', async () => {
    keyStatus = { anthropic: 'absent', openai: 'absent', openrouter: 'absent' }
    let resolveModels!: (value: unknown) => void
    api.settings.get.mockImplementation((name) =>
      name === 'chat.models'
        ? new Promise((resolve) => {
            resolveModels = resolve
          })
        : Promise.resolve(null),
    )
    render(
      <SpineProvider>
        <ChatTab />
      </SpineProvider>,
    )
    await screen.findByText('Model & keys')
    const model = screen.getByLabelText('Model', { selector: 'select' }) as HTMLSelectElement

    fireEvent.change(model, { target: { value: 'claude-sonnet-5' } })
    resolveModels({ ...defaultModels(), anthropic: 'claude-haiku-4-5' })

    await waitFor(() =>
      expect(api.settings.set).toHaveBeenCalledWith(
        'chat.models',
        expect.objectContaining({ anthropic: 'claude-sonnet-5' }),
      ),
    )
    expect(model.value).toBe('claude-sonnet-5')
  })

  it('remembers a draft key for one provider while entering another', async () => {
    keyStatus = { anthropic: 'absent', openai: 'absent', openrouter: 'absent' }
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

  it('streams status then text into the reply bubble', async () => {
    let settle: (r: import('@shared/chat').ChatResponse) => void = () => {}
    chat.mockReturnValue(new Promise((resolve) => { settle = resolve }))
    await mount()
    await sendMessage('when is the masquerade')

    // Between-tool status shows before any text.
    await act(async () => deltaCb?.({ status: 'Searching the schedule…' }))
    expect(screen.getByText('Searching the schedule…')).toBeTruthy()

    // Text streams in and replaces the status.
    await act(async () => deltaCb?.({ text: 'The Masquerade ' }))
    await act(async () => deltaCb?.({ text: 'is Saturday.' }))
    expect(screen.getByText('The Masquerade is Saturday.')).toBeTruthy()
    expect(screen.queryByText('Searching the schedule…')).toBeNull()

    // The final turn is canonical.
    await act(async () => {
      settle({ ok: true, turn: { message: { role: 'assistant', content: 'The Masquerade is Saturday, Jul 25.' }, eventUids: [], toolTrace: [] } })
    })
    expect(screen.getByText('The Masquerade is Saturday, Jul 25.')).toBeTruthy()
  })

  it('makes a bolded event title in the reply open its card', async () => {
    chat.mockResolvedValue({
      ok: true,
      turn: {
        message: { role: 'assistant', content: 'Found it: **Drawing Monsters for a Living** runs Saturday.' },
        eventUids: ['horror-sat'],
        toolTrace: ['search_events'],
      },
    })
    render(
      <SpineProvider>
        <ChatTab />
        <SelectionProbe />
      </SpineProvider>,
    )
    await waitFor(() => expect(syncDataset).toHaveBeenCalled())
    await sendMessage('find the monsters panel')

    // The bolded title is a link, not inert text, and clicking it selects the event.
    const link = await screen.findByRole('link', { name: 'Drawing Monsters for a Living' })
    fireEvent.click(link)
    expect(screen.getByTestId('sel').textContent).toBe('horror-sat')
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

  it('shows a Stop button while a turn is in flight and cancels it', async () => {
    let settle: (r: import('@shared/chat').ChatResponse) => void = () => {}
    chat.mockReturnValue(new Promise((resolve) => { settle = resolve }))
    await mount()
    await sendMessage('is there a marvel panel in hall H?')

    const stop = await screen.findByRole('button', { name: 'Stop' })
    fireEvent.click(stop)
    expect(api.llm.cancelChat).toHaveBeenCalled()

    // Settle the pending call as aborted so nothing dangles; no error banner.
    await act(async () => {
      settle({ ok: false, error: { kind: 'aborted', message: 'Stopped.' } })
    })
    expect(screen.queryByText('Stopped.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
  })

  it('keeps an interrupted partial reply visible without applying its mutation effects', async () => {
    chat.mockResolvedValue({
      ok: true,
      turn: {
        interrupted: true,
        message: { role: 'assistant', content: 'Partial answer' },
        patch: { filter: HORROR_FILTER },
        proposedAction: { kind: 'star', events: [] },
        eventUids: [],
        toolTrace: [],
      },
    })
    await mount()
    await sendMessage('start a long answer')

    await waitFor(() => expect(screen.getByText('Partial answer')).toBeTruthy())
    expect(screen.getByText('Interrupted')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resend' })).toBeTruthy()
    expect(screen.getByTestId('chips').textContent).toBe('')
    expect(screen.queryByRole('button', { name: /Star/ })).toBeNull()
  })

  it('names an empty reply instead of rendering a blank bubble', async () => {
    chat.mockResolvedValue({
      ok: true,
      turn: { message: { role: 'assistant', content: '   ' }, eventUids: [], toolTrace: ['apply_filters'] },
    })
    await mount()
    await sendMessage('hi')
    await waitFor(() => expect(screen.getByText(/finished without a reply/)).toBeTruthy())
  })

  it('drops the streaming placeholder and surfaces the error when the chat call rejects', async () => {
    chat.mockRejectedValue(new Error('boom'))
    await mount()
    await sendMessage('hi')
    // The catch branch sets the error banner and removes the empty placeholder.
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy())
    expect(screen.queryByText('Thinking…')).toBeNull()
  })

  it('ignores a stray delta that arrives after the turn is finalized', async () => {
    let settle: (r: import('@shared/chat').ChatResponse) => void = () => {}
    chat.mockReturnValue(new Promise((resolve) => { settle = resolve }))
    await mount()
    await sendMessage('when is the panel')

    // Grab the live delta callback before the resolving turn unsubscribes it.
    const stray = deltaCb!
    await act(async () => deltaCb?.({ text: 'streamed ' }))
    await act(async () => {
      settle({ ok: true, turn: { message: { role: 'assistant', content: 'Final answer.' }, eventUids: [], toolTrace: [] } })
    })
    expect(screen.getByText('Final answer.')).toBeTruthy()

    // A delta landing after finalize must not mutate the finalized bubble.
    await act(async () => stray({ text: ' LATE' }))
    expect(screen.getByText('Final answer.')).toBeTruthy()
    expect(screen.queryByText(/LATE/)).toBeNull()
  })

  it('surfaces a rejected key and opens the key panel', async () => {
    chat.mockResolvedValue({ ok: false, error: { kind: 'auth', message: 'The API key was rejected. Check it and try again.' } })
    await mount()
    await sendMessage('hi')
    await waitFor(() => expect(screen.getByText(/API key was rejected/)).toBeTruthy())
    // Setup reopens so the user can fix the key.
    expect(screen.getByText('Model & keys')).toBeTruthy()
  })

  it('persists every event of a multi-event star confirm in a single stars:set call', async () => {
    chat.mockResolvedValue({
      ok: true,
      turn: {
        message: { role: 'assistant', content: 'Star these?' },
        eventUids: [],
        proposedAction: {
          kind: 'star',
          events: [
            { uid: 'horror-sat', title: 'Drawing Monsters for a Living', start: `${SAT}T10:00:00-07:00`, room: 'Room 5AB', track: '1: PROGRAMS' },
            { uid: 'comics-sat', title: 'Inking Techniques Workshop', start: `${SAT}T10:00:00-07:00`, room: 'Room 5AB', track: '1: PROGRAMS' },
          ],
        },
        toolTrace: ['propose_action'],
      },
    })
    await mount()
    await sendMessage('star both')

    const confirm = await screen.findByRole('button', { name: /Star 2/ })
    const setSpy = api.stars.set
    setSpy.mockClear()
    fireEvent.click(confirm)

    // Both survive — the old per-event toggle folded each into a stale list and
    // stars:set replaces, so only the last would have persisted.
    await waitFor(() => expect(persisted.map((s) => s.uid).sort()).toEqual(['comics-sat', 'horror-sat']))
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Starred.')).toBeTruthy()
  })

  it('keeps the streamed partial and shows the banner when a provider error ends the turn', async () => {
    let settle: (r: import('@shared/chat').ChatResponse) => void = () => {}
    chat.mockReturnValue(new Promise((resolve) => { settle = resolve }))
    await mount()
    await sendMessage('long answer')

    await act(async () => deltaCb?.({ text: 'Partial answer so far' }))
    await act(async () => {
      settle({ ok: false, error: { kind: 'provider', message: 'The request timed out. Try again, or pick a faster model.' } })
    })

    // The partial stays on screen, with the error banner above it — not spliced.
    expect(screen.getByText('Partial answer so far')).toBeTruthy()
    expect(screen.getByText(/timed out/)).toBeTruthy()
  })

  it('marks an interrupted partial and resends without replaying it as history', async () => {
    chat
      .mockResolvedValueOnce({
        ok: true,
        turn: {
          message: { role: 'assistant', content: 'Partial answer' },
          interrupted: true,
          eventUids: [],
          toolTrace: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        turn: { message: { role: 'assistant', content: 'Complete answer' }, eventUids: [], toolTrace: [] },
      })
    await mount()
    await sendMessage('try this')

    expect(await screen.findByText('Interrupted')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }))
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(2))
    const retry = chat.mock.calls[1]![0]
    expect(retry.messages).toEqual([{ role: 'user', content: 'try this' }])
    expect(await screen.findByText('Complete answer')).toBeTruthy()
  })

  it('does not prompt replacement when a stored key is temporarily unreadable', async () => {
    keyStatus = { anthropic: 'unreadable', openai: 'absent', openrouter: 'absent' }
    await mount()
    expect(screen.queryByText('Model & keys')).toBeNull()
    expect((screen.getByPlaceholderText('API key temporarily unavailable') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('disables chat when the selected provider is unreadable even if another key is present', async () => {
    keyStatus = { anthropic: 'present', openai: 'unreadable', openrouter: 'absent' }
    await mount()

    fireEvent.click(screen.getByRole('button', { name: 'Model and API keys' }))
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const composer = await screen.findByPlaceholderText('API key temporarily unavailable') as HTMLTextAreaElement
    expect(composer.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('commits a lens patch through the spine', async () => {
    chat.mockResolvedValue({
      ok: true,
      turn: { message: { role: 'assistant', content: 'Rearranged by people.' }, patch: { lens: 'people' }, eventUids: [], toolTrace: ['set_view'] },
    })
    render(
      <SpineProvider>
        <ChatTab />
        <StateProbe />
      </SpineProvider>,
    )
    await waitFor(() => expect(syncDataset).toHaveBeenCalled())
    await sendMessage('rearrange by people')
    await waitFor(() => expect(screen.getByTestId('lens').textContent).toBe('people'))
  })

  it('commits a view patch through the spine', async () => {
    chat.mockResolvedValue({
      ok: true,
      turn: { message: { role: 'assistant', content: 'Switched to the graph.' }, patch: { view: 'graph' }, eventUids: [], toolTrace: ['set_view'] },
    })
    render(
      <SpineProvider>
        <ChatTab />
        <StateProbe />
      </SpineProvider>,
    )
    await waitFor(() => expect(syncDataset).toHaveBeenCalled())
    await sendMessage('show the graph')
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('graph'))
  })

  it('links a repeated title to its earliest sitting, and a unique title to its event', async () => {
    // Same title, three sittings — dup-2 runs first; dup-3 has no start at all,
    // and the '~' sentinel must sort it after every real date, never "earliest".
    const DUP1 = event('dup-1', { title: 'Spotlight Panel', start: `${SAT}T14:00:00-07:00` })
    const DUP2 = event('dup-2', { title: 'Spotlight Panel', start: `${SAT}T09:00:00-07:00` })
    const DUP3 = event('dup-3', { title: 'Spotlight Panel', start: null })
    const UNIQUE = event('unique-1', { title: 'Q&A: Where Do We Go? (Part 1)' })
    api.schedule.refresh = vi
      .fn()
      .mockResolvedValue({ events: [DUP1, DUP2, DUP3, UNIQUE], changes: {}, fetchedAt: '2026-07-20T18:00:00.000Z', stale: false })
    chat.mockResolvedValue({
      ok: true,
      turn: {
        message: { role: 'assistant', content: 'See **Spotlight Panel** and **Q&A: Where Do We Go? (Part 1)**.' },
        eventUids: ['dup-1', 'dup-2', 'dup-3', 'unique-1'],
        toolTrace: ['search_events'],
      },
    })
    render(
      <SpineProvider>
        <ChatTab />
        <SelectionProbe />
      </SpineProvider>,
    )
    await waitFor(() => expect(syncDataset).toHaveBeenCalled())
    await sendMessage('spotlight')

    // The unique title resolves to a clickable link — markdown-special characters
    // (?, parens) and all — and clicking it selects the event.
    const unique = await screen.findByRole('link', { name: 'Q&A: Where Do We Go? (Part 1)' })
    fireEvent.click(unique)
    expect(screen.getByTestId('sel').textContent).toBe('unique-1')
    // The repeated title is a link too — to the earliest sitting, whose card
    // lists the other one under "Also runs".
    const repeated = screen.getByRole('link', { name: 'Spotlight Panel' })
    fireEvent.click(repeated)
    expect(screen.getByTestId('sel').textContent).toBe('dup-2')
  })

  it('keeps an export card actionable when the save dialog is cancelled', async () => {
    api.export.ics = vi
      .fn()
      .mockResolvedValue({ status: 'cancelled', path: null, exported: 0, excluded: [] })
    chat.mockResolvedValue({
      ok: true,
      turn: {
        message: { role: 'assistant', content: 'Export?' },
        eventUids: [],
        proposedAction: { kind: 'export', events: [{ uid: 'horror-sat', title: 'Drawing Monsters for a Living', start: `${SAT}T10:00:00-07:00`, room: 'Room 5AB', track: '1: PROGRAMS' }] },
        toolTrace: ['propose_action'],
      },
    })
    await mount()
    await sendMessage('export it')

    const confirm = await screen.findByRole('button', { name: /Export 1/ })
    fireEvent.click(confirm)
    // A dismissed dialog wrote nothing — the card must not claim it exported.
    await waitFor(() => expect(screen.queryByText('Exported.')).toBeNull())
    expect(screen.getByRole('button', { name: /Export 1/ })).toBeTruthy()
  })

  it('marks an empty export done with a distinct note', async () => {
    api.export.ics = vi
      .fn()
      .mockResolvedValue({ status: 'empty', path: null, exported: 0, excluded: [] })
    chat.mockResolvedValue({
      ok: true,
      turn: {
        message: { role: 'assistant', content: 'Export?' },
        eventUids: [],
        proposedAction: { kind: 'export', events: [{ uid: 'horror-sat', title: 'Drawing Monsters for a Living', start: `${SAT}T10:00:00-07:00`, room: 'Room 5AB', track: '1: PROGRAMS' }] },
        toolTrace: ['propose_action'],
      },
    })
    await mount()
    await sendMessage('export it')

    const confirm = await screen.findByRole('button', { name: /Export 1/ })
    fireEvent.click(confirm)
    await waitFor(() => expect(screen.getByText('Nothing to export.')).toBeTruthy())
  })
})
