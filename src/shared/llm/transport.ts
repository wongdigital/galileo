/** Browser and native hosts supply both paths. Shared code never reaches for
 * ambient network I/O, which keeps `src/shared` usable by the web build. */
export type ChatFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface ChatTransport {
  streamFetch: ChatFetch
  bufferedRequest: ChatFetch
}

/** Browser CORS failures are intentionally opaque TypeErrors. Match the
 * stable messages from Chromium/WebKit without treating ordinary provider
 * failures as permission to replay a turn. */
export function isCorsLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'TypeError' && /failed to fetch|load failed|network request failed|cors/i.test(error.message)
}
