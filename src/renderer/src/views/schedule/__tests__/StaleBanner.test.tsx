// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetProjection } from '@shared/schedule'
import { SpineProvider } from '../../../state/spine'
import { clearFakeBridge, installFakeBridge, type FakePlatformBridge } from '../../../test/fakeBridge'
import { StaleBanner } from '../StaleBanner'

const DAY = 24 * 60 * 60 * 1_000
const fetchedAt = '2026-07-20T12:00:00.000Z'

function projection(partial: Partial<DatasetProjection> = {}): DatasetProjection {
  return { events: [], changes: {}, fetchedAt, stale: true, ...partial }
}

let api: FakePlatformBridge

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(fetchedAt) + DAY)
  api = installFakeBridge({
    schedule: { refresh: vi.fn().mockResolvedValue(projection()) },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  clearFakeBridge()
})

describe('StaleBanner', () => {
  it('recomputes relative staleness when the app resumes', async () => {
    render(
      <SpineProvider>
        <StaleBanner />
      </SpineProvider>,
    )
    await screen.findByText(/Fetched 1d ago/)
    expect(screen.getByRole('status').textContent).toContain('Showing the last saved schedule')

    vi.mocked(Date.now).mockReturnValue(Date.parse(fetchedAt) + 2 * DAY)
    fireEvent(document, new Event('visibilitychange'))

    expect(screen.getByText(/Fetched 2d ago/)).toBeTruthy()
  })

  it('disables accept-anyway while its refresh is in flight and re-enables on failure', async () => {
    const warning = {
      ok: false as const,
      reason: 'low-join-rate' as const,
      detail: 'join rate 12%',
      stats: { eventCount: 100, joinedWithListView: 12, joinRate: 0.12 },
    }
    api.schedule.refresh.mockResolvedValueOnce(projection({ warning }))
    let rejectRefresh!: (reason: unknown) => void
    api.schedule.refresh.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectRefresh = reject
    }))

    render(
      <SpineProvider>
        <StaleBanner />
      </SpineProvider>,
    )
    const accept = await screen.findByRole('button', { name: 'Accept new data anyway' })

    fireEvent.click(accept)
    expect((accept as HTMLButtonElement).disabled).toBe(true)

    await act(async () => rejectRefresh(new Error('offline')))
    await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(false))
  })
})
