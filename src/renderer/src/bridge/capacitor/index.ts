import { App } from '@capacitor/app'
import { CapacitorHttp } from '@capacitor/core'
import { Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import {
  KeychainAccess,
  SecureStorage,
} from '@aparajita/capacitor-secure-storage'
import type { PlatformBridge } from '@shared/bridge/types'
import type { ChatFetch } from '@shared/llm'
import { resetPalette } from '@renderer/views/graph/paint'
import { createWebBridge } from '../web'
import {
  CapacitorFilesystemStore,
  type FilesystemPlugin,
} from './filesystemStore'
import {
  createCapacitorBufferedFetch,
  fetchCapacitorScheduleSources,
  type CapacitorHttpPlugin,
} from './schedFetch'
import {
  createSecureKeyStore,
  type SecureStoragePlugin,
} from './secureKeys'
import {
  createShareDeliver,
  type ShareFilesystemPlugin,
  type SharePlugin,
} from './shareDeliver'

const DEFAULT_SITE = 'https://comiccon2026.sched.com'

interface NativeAppPlugin {
  getInfo(): Promise<{ version: string }>
  addListener(
    eventName: 'appStateChange',
    callback: (state: { isActive: boolean }) => void,
  ): Promise<{ remove(): Promise<void> }>
}

export interface CapacitorBridgeDeps {
  filesystem: FilesystemPlugin & ShareFilesystemPlugin
  http: CapacitorHttpPlugin
  secureStorage: SecureStoragePlugin
  share: SharePlugin
  app: NativeAppPlugin
  streamFetch?: ChatFetch
  site?: string
  resetCachedPalette?: () => void
}

/** Compose the portable web bridge with native-only I/O adapters. */
export function createCapacitorBridge(dependencies: CapacitorBridgeDeps): PlatformBridge {
  const store = new CapacitorFilesystemStore(dependencies.filesystem)
  const streamFetch = dependencies.streamFetch ?? fetch
  const site = dependencies.site ?? DEFAULT_SITE
  installNativePaletteInvalidation(
    dependencies.app,
    dependencies.resetCachedPalette ?? resetPalette,
  )

  return createWebBridge({
    site,
    store,
    fetchSources: () => fetchCapacitorScheduleSources(site, dependencies.http),
    keys: createSecureKeyStore(dependencies.secureStorage, KeychainAccess.afterFirstUnlock),
    deliver: createShareDeliver(dependencies.filesystem, dependencies.share),
    transport: {
      streamFetch,
      bufferedRequest: createCapacitorBufferedFetch(dependencies.http),
    },
    version: async () => (await dependencies.app.getInfo()).version,
  })
}

let singleton: PlatformBridge | undefined

export function capacitorBridge(): PlatformBridge {
  singleton ??= createCapacitorBridge({
    filesystem: Filesystem as unknown as FilesystemPlugin & ShareFilesystemPlugin,
    http: CapacitorHttp as unknown as CapacitorHttpPlugin,
    secureStorage: SecureStorage as unknown as SecureStoragePlugin,
    share: Share as unknown as SharePlugin,
    app: App as unknown as NativeAppPlugin,
  })
  return singleton
}

function installNativePaletteInvalidation(
  app: NativeAppPlugin,
  reset: () => void,
): void {
  const media =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
  media?.addEventListener('change', reset)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reset()
    })
  }
  void app
    .addListener('appStateChange', ({ isActive }) => {
      if (isActive) reset()
    })
    .catch((error: unknown) => {
      console.warn('[theme] failed to subscribe to native app state:', error)
    })
}
