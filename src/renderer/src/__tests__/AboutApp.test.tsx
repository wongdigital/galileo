// @vitest-environment jsdom

/**
 * The About window's body. The window lifecycle (open from the menu, traffic
 * lights close it) is main-process wiring in src/main/aboutWindow.ts and lives
 * outside this suite; here we test the rendered content and its links.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AboutApp } from '../AboutApp'
import { APP_AUTHOR, APP_AUTHOR_URL, APP_NAME, GITHUB_URL } from '@shared/app'

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

describe('AboutApp', () => {
  it('shows the app identity and links to the author site and repo', () => {
    render(<AboutApp />)

    expect(screen.getByRole('heading', { name: APP_NAME })).toBeTruthy()

    const author = screen.getByRole('link', { name: APP_AUTHOR }) as HTMLAnchorElement
    // getAttribute, not .href: jsdom appends a trailing slash to a bare origin.
    expect(author.getAttribute('href')).toBe(APP_AUTHOR_URL)
    expect(author.target).toBe('_blank')
    expect(author.rel).toContain('noreferrer')

    const repo = screen.getByRole('link', { name: 'GitHub' }) as HTMLAnchorElement
    expect(repo.href).toBe(GITHUB_URL)
    expect(repo.target).toBe('_blank')
  })

  it('shows a dash until the version resolves, then the version from main', async () => {
    ;(window as unknown as { api: unknown }).api = {
      app: { version: vi.fn().mockResolvedValue('2.5.0') },
    }
    render(<AboutApp />)

    // Before the promise resolves.
    expect(screen.getByText('—')).toBeTruthy()
    // After.
    await waitFor(() => expect(screen.getByText('2.5.0')).toBeTruthy())
  })

  it('falls back to a dash when no bridge is present', () => {
    render(<AboutApp />)
    expect(screen.getByText('—')).toBeTruthy()
  })
})
