// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFakeBridge, installFakeBridge, type FakePlatformBridge } from '../../test/fakeBridge'
import { initTheme, useTheme } from '../theme'

vi.mock('@renderer/views/graph/paint', () => ({ resetPalette: vi.fn() }))

let api: FakePlatformBridge

function Probe() {
  const { theme, setTheme } = useTheme()
  return <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme}</button>
}

beforeEach(() => {
  delete document.documentElement.dataset.theme
  localStorage.clear()
  api = installFakeBridge()
})

afterEach(() => {
  cleanup()
  clearFakeBridge()
  vi.restoreAllMocks()
})

describe('durable theme preference', () => {
  it('restores a valid theme through platform settings before mount', async () => {
    api.settings.get.mockResolvedValue('light')

    await initTheme()

    expect(api.settings.get).toHaveBeenCalledWith('theme')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('falls back to dark when the stored value is invalid', async () => {
    api.settings.get.mockResolvedValue('sepia')

    await initTheme()

    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('migrates a legacy localStorage theme into durable settings', async () => {
    localStorage.setItem('galileo.theme', 'light')
    api.settings.get.mockResolvedValue(null)

    await initTheme()

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(api.settings.set).toHaveBeenCalledWith('theme', 'light')
    expect(localStorage.getItem('galileo.theme')).toBeNull()
  })

  it('keeps a legacy theme when its durable migration fails', async () => {
    localStorage.setItem('galileo.theme', 'light')
    api.settings.get.mockResolvedValue(null)
    api.settings.set.mockRejectedValue(new Error('disk unavailable'))

    await initTheme()

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('galileo.theme')).toBe('light')
  })

  it('does not leave startup blocked when the settings adapter never settles', async () => {
    vi.useFakeTimers()
    api.settings.get.mockReturnValue(new Promise(() => {}))
    let settled = false

    void initTheme().then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(500)

    expect(settled).toBe(true)
    expect(document.documentElement.dataset.theme).toBeUndefined()
    vi.useRealTimers()
  })

  it('applies immediately and writes a change through platform settings', async () => {
    api.settings.get.mockResolvedValue('dark')
    await initTheme()
    render(<Probe />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'dark' }))
    })

    expect(screen.getByRole('button', { name: 'light' })).toBeTruthy()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(api.settings.set).toHaveBeenCalledWith('theme', 'light')
  })
})
