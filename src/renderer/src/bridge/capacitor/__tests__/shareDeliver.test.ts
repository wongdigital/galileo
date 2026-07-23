import { describe, expect, it, vi } from 'vitest'

import { createShareDeliver, type ShareFilesystemPlugin, type SharePlugin } from '../shareDeliver'

function setup(): {
  filesystem: ShareFilesystemPlugin
  share: SharePlugin
} {
  return {
    filesystem: {
      writeFile: vi.fn(async () => ({ uri: 'file:///cache/comic-con.ics' })),
      getUri: vi.fn(async () => ({ uri: 'file:///cache/comic-con.ics' })),
      deleteFile: vi.fn(async () => {}),
    },
    share: {
      share: vi.fn(async () => ({ activityType: 'com.apple.EventKitUI' })),
    },
  }
}

describe('createShareDeliver', () => {
  it('shares a Cache file URI and removes the temporary file after success', async () => {
    const { filesystem, share } = setup()

    await expect(
      createShareDeliver(filesystem, share)('comic-con.ics', 'BEGIN:VCALENDAR'),
    ).resolves.toBe('file:///cache/comic-con.ics')

    expect(filesystem.writeFile).toHaveBeenCalledWith({
      path: 'galileo-share/comic-con.ics',
      data: 'BEGIN:VCALENDAR',
      directory: 'CACHE',
      encoding: 'utf8',
      recursive: true,
    })
    expect(share.share).toHaveBeenCalledWith({
      title: 'Export Comic-Con calendar',
      files: ['file:///cache/comic-con.ics'],
    })
    expect(filesystem.deleteFile).toHaveBeenCalledWith({
      path: 'galileo-share/comic-con.ics',
      directory: 'CACHE',
    })
  })

  it('maps a cancelled share to null and still cleans up', async () => {
    const { filesystem, share } = setup()
    vi.mocked(share.share).mockRejectedValueOnce(
      Object.assign(new Error('User cancelled share sheet'), { code: 'USER_CANCELLED' }),
    )

    await expect(createShareDeliver(filesystem, share)('comic-con.ics', 'ics')).resolves.toBeNull()
    expect(filesystem.deleteFile).toHaveBeenCalledOnce()
  })

  it('cleans up and rethrows a genuine share failure', async () => {
    const { filesystem, share } = setup()
    vi.mocked(share.share).mockRejectedValueOnce(new Error('presentation failed'))

    await expect(createShareDeliver(filesystem, share)('comic-con.ics', 'ics')).rejects.toThrow(
      'presentation failed',
    )
    expect(filesystem.deleteFile).toHaveBeenCalledOnce()
  })

  it('rejects path-like names before writing', async () => {
    const { filesystem, share } = setup()

    await expect(createShareDeliver(filesystem, share)('../secret.ics', 'ics')).rejects.toThrow(
      'Invalid calendar filename',
    )
    expect(filesystem.writeFile).not.toHaveBeenCalled()
  })
})
