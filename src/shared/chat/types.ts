/**
 * The chat concierge's cross-process contract.
 *
 * Lives in `src/shared/` because three layers have to agree on it exactly: the
 * main-process tool loop that produces these values, the preload bridge that
 * carries them, and the renderer's ChatTab that applies them. It is
 * deliberately zod-free — the renderer imports these types and must not pull a
 * validation library into its bundle. The tool *input* schemas (the shapes the
 * model fills) are zod and live in `src/main/llm/tools.ts`, the only caller
 * that needs runtime validation.
 *
 * R15's promise — "chat produces the same state as the chips" — holds because
 * `apply_filters` produces a `FilterState`, the identical object the sidebar
 * builds, translated by `applyFilterIntent` through the shared engine editors.
 */

import type { FilterChip, FilterState } from '../filter/types'
import type { LensId } from '../graph/types'

/** The providers a key can be stored for. Anthropic is the house client; the
 *  other two ride the same Vercel AI SDK tool loop unchanged. */
export type ProviderId = 'anthropic' | 'openai' | 'openrouter'

export const PROVIDERS: readonly ProviderId[] = ['anthropic', 'openai', 'openrouter']

/** Mirrors the spine's `ViewMode` (renderer-owned). Duplicated as a two-value
 *  literal rather than imported so shared never reaches into the renderer; the
 *  renderer maps this straight onto `setView`. */
export type ViewName = 'graph' | 'schedule'

/** One turn of conversation as the renderer tracks it. Tool calls and their
 *  results never appear here — they live and die inside main's loop; the
 *  renderer only ever sees user and assistant prose. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * What the model wants done to the app's filter/lens/view state. The model
 * fills this (validated by the zod schema in main); `applyFilterIntent` turns
 * it plus the current state into a new `FilterState`. Expressing intent —
 * "add these, remove those" — rather than a whole `FilterState` keeps the model
 * from having to rebuild chips it cannot see.
 */
export interface FilterIntent {
  /** Reset to the empty filter before applying the rest — "start over, then…". */
  clear?: boolean
  add?: FilterChip[]
  /** Sign-agnostic: removes the chip whether or not it was negated. */
  remove?: Array<{ dimension: string; value: string }>
  /** Set the free-text chip; null or '' clears it. `undefined` leaves it. */
  text?: string | null
  starredOnly?: boolean
  changedOnly?: boolean
  lens?: LensId
  view?: ViewName
}

/**
 * The state changes a turn asks the renderer to commit. Each field is applied
 * through the same setter a chip click uses, so there is one code path into the
 * spine no matter who is driving it.
 */
export interface AppStatePatch {
  filter?: FilterState
  lens?: LensId
  view?: ViewName
}

/** A summary row — enough to list an event without its description. */
export interface EventSummary {
  uid: string
  title: string
  start: string | null
  room: string
  track: string | null
}

/** Everything the model reads to answer a content question. The description is
 *  Sched prose; it flows to the user's chosen provider by design (their key,
 *  their data path) and never into git. */
export interface EventDetail extends EventSummary {
  description: string
  people: Array<{ name: string; role: string }>
  franchises: string[]
  starred: boolean
}

/**
 * A mutation the model proposes but never performs. The UI renders it as a
 * confirm card listing the exact events; one tap commits through the spine.
 * The two rules of the whole concierge: no schedule facts from memory, no
 * mutation without this.
 */
export interface ProposedAction {
  kind: 'star' | 'export'
  events: EventSummary[]
  /** Optional one-line rationale the model attaches ("your 3 starred Saturday
   *  panels"), shown above the confirm buttons. */
  note?: string
}

/** The whole result of one user turn, handed back across the bridge. */
export interface ChatTurn {
  message: ChatMessage
  /** Filter/lens/view to commit, if the model drove state this turn. */
  patch?: AppStatePatch
  /** Events to render as cards inline (from get_event / search results). */
  eventUids: string[]
  proposedAction?: ProposedAction
  /** Tool names called, in order — the loop log R14 asks for, surfaced for the
   *  dev console and for asserting groundedness in tests. */
  toolTrace: string[]
}

/** The renderer's side of a chat call: the conversation plus a snapshot of the
 *  state the tools reason about. Stars and unseen-changes are passed per turn
 *  because they move faster than the candidate index main caches. */
export interface ChatRequest {
  provider: ProviderId
  /** Provider-specific model id; main falls back to its default when absent. */
  model?: string
  messages: ChatMessage[]
  filter: FilterState
  lens: LensId
  view: ViewName
  starredUids: string[]
  changedUids: string[]
}

/** Which providers currently have a stored key — drives the tab's enabled
 *  state and the key-entry surface without ever exposing the key itself. */
export type KeyStatus = Record<ProviderId, boolean>

/** A chat call can fail for reasons the tab must show in-place rather than
 *  throw: no key, a rejected key (401), or a provider/network error. */
export interface ChatError {
  kind: 'no-key' | 'auth' | 'provider'
  message: string
}

export type ChatResponse = { ok: true; turn: ChatTurn } | { ok: false; error: ChatError }
