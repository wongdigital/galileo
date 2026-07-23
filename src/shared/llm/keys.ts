import type { KeyStatus, ProviderId } from '../chat'

/** Async because Keychain-backed hosts are asynchronous. Implementations never
 * expose a key to the renderer; only the shared loop calls `get` at call time. */
export interface KeyStore {
  status(): Promise<KeyStatus>
  get(provider: ProviderId): Promise<string | null>
  set(provider: ProviderId, key: string): Promise<KeyStatus>
  clear(provider: ProviderId): Promise<KeyStatus>
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Platform-neutral base64 for encrypted byte payloads. Deliberately avoids
 * Node Buffer so this module type-checks and executes in a WebView. */
export function bytesToBase64(bytes: Uint8Array): string {
  let encoded = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    encoded += ALPHABET[a >> 2]
    encoded += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]
    encoded += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]
    encoded += c === undefined ? '=' : ALPHABET[c & 63]
  }
  return encoded
}

export function base64ToBytes(encoded: string): Uint8Array {
  const clean = encoded.replace(/\s/g, '')
  if (clean.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(clean)) throw new Error('Invalid base64 payload.')
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((clean.length / 4) * 3 - padding)
  let offset = 0
  for (let i = 0; i < clean.length; i += 4) {
    const values = [clean[i], clean[i + 1], clean[i + 2], clean[i + 3]].map((char) =>
      char === '=' ? 0 : ALPHABET.indexOf(char ?? ''),
    )
    if (values.some((value) => value < 0)) throw new Error('Invalid base64 payload.')
    const bits = (values[0]! << 18) | (values[1]! << 12) | (values[2]! << 6) | values[3]!
    if (offset < bytes.length) bytes[offset++] = bits >> 16
    if (offset < bytes.length) bytes[offset++] = (bits >> 8) & 255
    if (offset < bytes.length) bytes[offset++] = bits & 255
  }
  return bytes
}
