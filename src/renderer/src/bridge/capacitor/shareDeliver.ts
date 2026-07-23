import type { IcsExportDeps } from '@shared/ics'

export interface ShareFilesystemPlugin {
  writeFile(options: {
    path: string
    data: string
    directory: 'CACHE'
    encoding: 'utf8'
    recursive?: boolean
  }): Promise<unknown>
  getUri(options: { path: string; directory: 'CACHE' }): Promise<{ uri: string }>
  deleteFile(options: { path: string; directory: 'CACHE' }): Promise<void>
}

export interface SharePlugin {
  share(options: { title?: string; files?: string[] }): Promise<{ activityType?: string }>
}

const SHARE_ROOT = 'galileo-share'

/** Cache file -> native share sheet -> unconditional cleanup. */
export function createShareDeliver(
  filesystem: ShareFilesystemPlugin,
  share: SharePlugin,
): IcsExportDeps['deliver'] {
  return async (defaultName, contents) => {
    if (!/^[a-z0-9][a-z0-9._-]*\.ics$/i.test(defaultName)) {
      throw new Error(`Invalid calendar filename: ${defaultName}`)
    }
    const path = `${SHARE_ROOT}/${defaultName}`
    await filesystem.writeFile({
      path,
      data: contents,
      directory: 'CACHE',
      encoding: 'utf8',
      recursive: true,
    })

    try {
      const { uri } = await filesystem.getUri({ path, directory: 'CACHE' })
      await share.share({
        title: 'Export Comic-Con calendar',
        files: [uri],
      })
      return uri
    } catch (error) {
      if (isCancelled(error)) return null
      throw error
    } finally {
      try {
        await filesystem.deleteFile({ path, directory: 'CACHE' })
      } catch (error) {
        console.warn('[export] failed to remove shared calendar temp:', error)
      }
    }
  }
}

function isCancelled(error: unknown): boolean {
  const code =
    error && typeof error === 'object' ? String((error as { code?: unknown }).code ?? '') : ''
  const message = error instanceof Error ? error.message : String(error)
  return /cancel/i.test(code) || /cancel/i.test(message)
}
