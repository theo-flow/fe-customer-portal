import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

/* ── Hoist mock references ── */
const { mockSignIn, mockSearchParamsGet } = vi.hoisted(() => ({
  mockSignIn:          vi.fn(),
  mockSearchParamsGet: vi.fn().mockReturnValue(null),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: mockSearchParamsGet }),
}))

vi.mock('@/lib/auth', () => ({
  signIn:        mockSignIn,
  friendlyError: (err: { code?: string; message?: string }) => err.message ?? 'Error',
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('div', rest as React.HTMLAttributes<HTMLDivElement>, children),
  },
}))

import LoginPage from '../page'

/* ── Helpers ── */
const setup = () => {
  const user = userEvent.setup()
  render(<LoginPage />)
  return {
    user,
    emailInput:    () => screen.getByLabelText(/email address/i),
    passwordInput: () => screen.getByLabelText(/password/i),
    submitBtn:     () => screen.getByRole('button', { name: /sign in/i }),
  }
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParamsGet.mockReturnValue(null)
    // Post sign-in uses a hard navigation (window.location.href), not
    // router.push, so the middleware's auth check always sees a fresh
    // top-level request -- jsdom doesn't implement real navigation, so
    // stub location with a writable href to assert against.
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    })
  })

  /* ── Rendering ── */
  it('renders email and password inputs', () => {
    const { emailInput, passwordInput } = setup()
    expect(emailInput()).toBeInTheDocument()
    expect(passwordInput()).toBeInTheDocument()
  })

  it('renders the Sign in button', () => {
    const { submitBtn } = setup()
    expect(submitBtn()).toBeInTheDocument()
  })

  it('renders the forgot password link pointing to /forgot-password', () => {
    setup()
    const link = screen.getByRole('link', { name: /forgot password/i })
    expect(link).toHaveAttribute('href', '/forgot-password')
  })

  /* ── Success banners ── */
  it('shows email-verified success banner when ?verified=1 is in query', () => {
    mockSearchParamsGet.mockImplementation((key: string) => key === 'verified' ? '1' : null)
    setup()
    expect(screen.getByRole('status')).toHaveTextContent(/email verified/i)
  })

  it('shows password-reset success banner when ?reset=1 is in query', () => {
    mockSearchParamsGet.mockImplementation((key: string) => key === 'reset' ? '1' : null)
    setup()
    expect(screen.getByRole('status')).toHaveTextContent(/password reset successfully/i)
  })

  it('does not show a status banner when no query param is set', () => {
    setup()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows session-expired banner for ?reason=expired, then strips it from the URL so a reload or back-nav does not re-show it', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => key === 'reason' ? 'expired' : null)
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '', pathname: '/login', search: '?reason=expired' },
    })
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

    setup()

    expect(screen.getByRole('status')).toHaveTextContent(/session has expired/i)
    await waitFor(() => expect(replaceStateSpy).toHaveBeenCalled())
    const strippedUrl = String(replaceStateSpy.mock.calls[0][2])
    expect(strippedUrl).not.toContain('reason=expired')
  })

  /* ── Client-side presence validation ── */
  it('shows error when email is empty on submit', async () => {
    const { user, passwordInput, submitBtn } = setup()
    await user.type(passwordInput(), 'Password123!')
    await user.click(submitBtn())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/email address is required/i))
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('shows error when password is empty on submit', async () => {
    const { user, emailInput, submitBtn } = setup()
    await user.type(emailInput(), 'user@example.com')
    await user.click(submitBtn())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/password is required/i))
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  /* ── Successful sign-in ── */
  it('calls signIn with email and password on submit', async () => {
    mockSignIn.mockResolvedValueOnce({})
    const { user, emailInput, passwordInput, submitBtn } = setup()

    await user.type(emailInput(), 'broker@example.com')
    await user.type(passwordInput(), 'Password123!')
    await user.click(submitBtn())

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('broker@example.com', 'Password123!'))
  })

  it('redirects to /dashboard when no ?next param is set', async () => {
    mockSignIn.mockResolvedValueOnce({})
    const { user, emailInput, passwordInput, submitBtn } = setup()

    await user.type(emailInput(), 'broker@example.com')
    await user.type(passwordInput(), 'Password123!')
    await user.click(submitBtn())

    await waitFor(() => expect(window.location.href).toBe('/dashboard'))
  })

  /* ── Open redirect prevention ── */
  it('redirects to a safe relative ?next path after successful sign-in', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => key === 'next' ? '/upload' : null)
    mockSignIn.mockResolvedValueOnce({})
    const { user, emailInput, passwordInput, submitBtn } = setup()

    await user.type(emailInput(), 'broker@example.com')
    await user.type(passwordInput(), 'Password123!')
    await user.click(submitBtn())

    await waitFor(() => expect(window.location.href).toBe('/upload'))
  })

  it('falls back to /dashboard instead of a protocol-relative ?next (//evil.com)', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => key === 'next' ? '//evil.com' : null)
    mockSignIn.mockResolvedValueOnce({})
    const { user, emailInput, passwordInput, submitBtn } = setup()

    await user.type(emailInput(), 'broker@example.com')
    await user.type(passwordInput(), 'Password123!')
    await user.click(submitBtn())

    await waitFor(() => expect(window.location.href).toBe('/dashboard'))
  })

  it('falls back to /dashboard instead of an absolute-URL ?next (https://evil.com)', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => key === 'next' ? 'https://evil.com' : null)
    mockSignIn.mockResolvedValueOnce({})
    const { user, emailInput, passwordInput, submitBtn } = setup()

    await user.type(emailInput(), 'broker@example.com')
    await user.type(passwordInput(), 'Password123!')
    await user.click(submitBtn())

    await waitFor(() => expect(window.location.href).toBe('/dashboard'))
  })

  /* ── Errors ── */
  it('shows error message when signIn rejects', async () => {
    mockSignIn.mockRejectedValueOnce({ message: 'The email address or password is incorrect.' })
    const { user, emailInput, passwordInput, submitBtn } = setup()

    await user.type(emailInput(), 'broker@example.com')
    await user.type(passwordInput(), 'wrongpassword')
    await user.click(submitBtn())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/incorrect/i))
  })

  it('does not redirect when signIn throws', async () => {
    mockSignIn.mockRejectedValueOnce({ message: 'Network error' })
    const { user, emailInput, passwordInput, submitBtn } = setup()

    await user.type(emailInput(), 'broker@example.com')
    await user.type(passwordInput(), 'Password123!')
    await user.click(submitBtn())

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(window.location.href).toBe('')
  })

  /* ── Loading state ── */
  it('disables the submit button while loading', async () => {
    mockSignIn.mockReturnValueOnce(new Promise(() => {}))
    const { user, emailInput, passwordInput, submitBtn } = setup()

    await user.type(emailInput(), 'broker@example.com')
    await user.type(passwordInput(), 'Password123!')
    const btn = submitBtn()
    fireEvent.click(btn)

    await waitFor(() => expect(btn).toBeDisabled())
  })
})
