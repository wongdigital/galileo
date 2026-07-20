/**
 * The main-process chat concierge. All I/O (the encrypted key store, the LLM
 * calls) lives on this side of the bridge; `src/shared/chat` stays pure.
 */

export { KeyStore, type SafeStorage } from './keyStore'
export { registerLlmIpc, type LlmIpcDeps, type LlmIpcHost } from './ipc'
export { runChatTurn, type ChatDeps, type GenerateFn } from './loop'
export { buildTools, type ToolContext, type TurnCapture } from './tools'
export { listModels } from './models'
