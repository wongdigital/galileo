/** Electron adapters plus compatibility re-exports for the platform-neutral
 * LLM core. Network execution is injected by each host; only encrypted file
 * storage and IPC remain main-process concerns. */

export { KeyStore, type SafeStorage } from './keyStore'
export { registerLlmIpc, type LlmIpcDeps, type LlmIpcHost } from './ipc'
export {
  createChatSession,
  runChatTurn,
  buildTools,
  listModels,
  type ChatDeps,
  type ChatSession,
  type ChatSessionDeps,
  type ChatTransport,
  type GenerateFn,
  type KeyStore as SharedKeyStore,
  type ToolContext,
  type TurnCapture,
} from '../../shared/llm'
