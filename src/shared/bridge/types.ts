import type {
  ChatDelta,
  ChatRequest,
  ChatResponse,
  KeyStatus,
  ModelChoice,
  ProviderId,
} from '../chat'
import type { FilterCandidate } from '../filter/types'
import type { IcsBuildOptions, IcsExclusion } from '../ics'
import type { DatasetProjection } from '../schedule'
import type { StarRecord } from '../stars'

/** What the renderer sends for an export. Main resolves the UIDs against its
 * canonical dataset; event bodies never cross the bridge. */
export interface IcsExportRequest {
  uids: string[]
  options?: Omit<IcsBuildOptions, 'stamp'>
}

export type IcsExportResult =
  | { status: 'saved'; path: string; exported: number; excluded: IcsExclusion[]; sanitized: string[] }
  | { status: 'cancelled'; path: null; exported: 0; excluded: [] }
  | { status: 'empty'; path: null; exported: 0; excluded: IcsExclusion[] }
  | { status: 'failed'; path: null; exported: 0; excluded: []; message: string }

/**
 * The renderer's complete I/O surface. Platform implementations may use IPC,
 * browser APIs, or native plugins, but the renderer only knows this contract.
 */
export interface PlatformBridge {
  app: {
    version(): Promise<string>
  }
  schedule: {
    refresh(options?: { acceptAnyway?: boolean }): Promise<DatasetProjection>
  }
  changes: {
    acknowledge(uids: string[]): Promise<DatasetProjection['changes']>
  }
  stars: {
    get(): Promise<StarRecord[]>
    set(stars: StarRecord[]): Promise<StarRecord[]>
  }
  export: {
    ics(payload: IcsExportRequest): Promise<IcsExportResult>
  }
  llm: {
    keyStatus(): Promise<KeyStatus>
    setKey(
      provider: ProviderId,
      key: string,
    ): Promise<{ ok: true; status: KeyStatus } | { ok: false; message: string }>
    clearKey(provider: ProviderId): Promise<KeyStatus>
    models(provider: ProviderId): Promise<ModelChoice[]>
    syncDataset(candidates: readonly FilterCandidate[]): Promise<{ received: number }>
    chat(request: ChatRequest): Promise<ChatResponse>
    cancelChat(): Promise<{ cancelled: boolean }>
    onChatDelta(cb: (delta: ChatDelta) => void): () => void
  }
  /** Small platform-owned JSON values. Durable backing lands with each
   * platform adapter; callers must treat an absent value as unset. */
  settings: {
    get(name: string): Promise<unknown | null>
    set(name: string, value: unknown): Promise<void>
  }
}
