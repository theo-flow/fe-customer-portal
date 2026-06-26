import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

/* ── Hoist mock references ── */
const { mockPush, mockForgotPassword, mockConfirmNewPassword } = vi.hoisted(() => ({
  mockPush:               vi.fn(),
  mockForgotPassword:     vi.fn(),
  mockConfirmNewPassword: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

vi.mock('@/lib/auth', () => ({
  forgotPassword:     mockForgotPassword,
  confirmNewPassword: mockConfirmNewPassword,
  friendlyError:      (err: { code?: string; message?: string }) => {
    switch (err.code) {
      case 'LimitExceededException': return 'Too many attempts. Please wait a few minutes and try again.'
      case 'CodeMismatchException':  return 'Incorrect verification code. Please try again.'
      case 'ExpiredCodeException':   return 'Verification code has expired. Please request a new one.'
      default:                       return err.message ?? 'Something went wrong. Please try again.'
    }
  },
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('div', rest as React.HTMLAttributes<HTMLDivElement>, children),
  },
}))

import ForgotPasswordPage from '../page'

/* ── Helpers ── */
const setup = () => {
  const user = userEvent.setup()
  render(<ForgotPasswordPage />)
  return { user }
}

const emailInput    = () => screen.getByPlaceholderText(/you@example\.com/i)
const sendBtn       = () => screen.getByRole('button', { name: /send reset code/i })
const codeInput     = () => screen.getByPlaceholderText(/6-digit code/i)
const newPassInput  = () => screen.getByPlaceholderText(/min\. 12 characters/i)
const confirmInput  = () => screen.getByPlaceholderText(/repeat password/i)
const setPassBtn    = () => screen.getByRole('button', { name: /set new password/i })

/** Advance from Phase 1 to Phase 2 by submitting a valid email. */
async function advanceToPhase2(user: ReturnType<typeof userEvent.setup>, email = 'user@example.com') {
  mockForgotPassword.mockResolvedValueOnce(undefined)
  await user.type(emailInput(), email)
  await user.click(sendBtn())
  await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument())
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /* ════════════════════════════════════════════════════════
     PHASE 1 — Email entry
  ════════════════════════════════════════════════════════ */
  describe('Phase 1 — Email entry', () => {
    it('renders the email input and Send button', () => {
      setup()
      expect(emailInput()).toBeInTheDocument()
      expect(sendBtn()).toBeInTheDocument()
    })

    it('shows error when email is empty on submit', async () => {
      const { user } = setup()
      await user.click(sendBtn())
      expect(screen.getByRole('alert')).toHaveTextContent(/email address is required/i)
      expect(mockForgotPassword).not.toHaveBeenCalled()
    })

    it('shows error when email format is invalid', async () => {
      const { user } = setup()
      await user.type(emailInput(), 'not-an-email')
      await user.click(sendBtn())
      expect(screen.getByRole('alert')).toHaveTextContent(/valid email address/i)
      expect(mockForgotPassword).not.toHaveBeenCalled()
    })

    it('advances to Phase 2 when Cognito sends the code', async () => {
      const { user } = setup()
      await advanceToPhase2(user)
      expect(screen.getByText(/check your email/i)).toBeInTheDocument()
    })

    it('silently advances to Phase 2 on UserNotFoundException (anti-enumeration)', async () => {
      mockForgotPassword.mockRejectedValueOnce({ code: 'UserNotFoundException' })
      const { user } = setup()
      await user.type(emailInput(), 'ghost@example.com')
      await user.click(sendBtn())
      // Should still transition to Phase 2 without showing an error
      await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows error and stays on Phase 1 for rate-limit errors', async () => {
      mockForgotPassword.mockRejectedValueOnce({ code: 'LimitExceededException' })
      const { user } = setup()
      await user.type(emailInput(), 'user@example.com')
      await user.click(sendBtn())
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too many attempts/i))
      // Should NOT have transitioned
      expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument()
    })
  })

  /* ════════════════════════════════════════════════════════
     PHASE 2 — Code + new password
  ════════════════════════════════════════════════════════ */
  describe('Phase 2 — Code and new password', () => {
    it('renders code input and new-password fields after Phase 1', async () => {
      const { user } = setup()
      await advanceToPhase2(user)
      expect(codeInput()).toBeInTheDocument()
      expect(newPassInput()).toBeInTheDocument()
      expect(confirmInput()).toBeInTheDocument()
      expect(setPassBtn()).toBeInTheDocument()
    })

    it('shows error when code is not exactly 6 digits', async () => {
      const { user } = setup()
      await advanceToPhase2(user)
      await user.type(codeInput(), '123')
      await user.type(newPassInput(), 'NewPass12!')
      await user.type(confirmInput(), 'NewPass12!')
      await user.click(setPassBtn())
      expect(screen.getByRole('alert')).toHaveTextContent(/6-digit code/i)
      expect(mockConfirmNewPassword).not.toHaveBeenCalled()
    })

    it('shows error when new password is too weak (< 3 strength criteria met)', async () => {
      const { user } = setup()
      await advanceToPhase2(user)
      await user.type(codeInput(), '123456')
      // lowercase only — fails uppercase + number + symbol
      await user.type(newPassInput(), 'weakpasswordonly')
      await user.type(confirmInput(), 'weakpasswordonly')
      await user.click(setPassBtn())
      expect(screen.getByRole('alert')).toHaveTextContent(/12\+/i)
      expect(mockConfirmNewPassword).not.toHaveBeenCalled()
    })

    it('shows error when passwords do not match', async () => {
      const { user } = setup()
      await advanceToPhase2(user)
      await user.type(codeInput(), '123456')
      await user.type(newPassInput(), 'NewPass12!')
      await user.type(confirmInput(), 'Different12!')
      await user.click(setPassBtn())
      expect(screen.getByRole('alert')).toHaveTextContent(/passwords do not match/i)
      expect(mockConfirmNewPassword).not.toHaveBeenCalled()
    })

    it('calls confirmNewPassword with the correct email, code, and password', async () => {
      mockConfirmNewPassword.mockResolvedValueOnce(undefined)
      const { user } = setup()
      await advanceToPhase2(user, 'user@example.com')
      await user.type(codeInput(), '654321')
      await user.type(newPassInput(), 'NewPass12!')
      await user.type(confirmInput(), 'NewPass12!')
      await user.click(setPassBtn())
      await waitFor(() =>
        expect(mockConfirmNewPassword).toHaveBeenCalledWith('user@example.com', '654321', 'NewPass12!')
      )
    })

    it('redirects to /login?reset=1 on successful password reset', async () => {
      mockConfirmNewPassword.mockResolvedValueOnce(undefined)
      const { user } = setup()
      await advanceToPhase2(user)
      await user.type(codeInput(), '654321')
      await user.type(newPassInput(), 'NewPass12!')
      await user.type(confirmInput(), 'NewPass12!')
      await user.click(setPassBtn())
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login?reset=1'))
    })

    it('shows error when the reset code is wrong (CodeMismatchException)', async () => {
      mockConfirmNewPassword.mockRejectedValueOnce({ code: 'CodeMismatchException' })
      const { user } = setup()
      await advanceToPhase2(user)
      await user.type(codeInput(), '000000')
      await user.type(newPassInput(), 'NewPass12!')
      await user.type(confirmInput(), 'NewPass12!')
      await user.click(setPassBtn())
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(/incorrect verification code/i)
      )
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('shows error when the reset code has expired (ExpiredCodeException)', async () => {
      mockConfirmNewPassword.mockRejectedValueOnce({ code: 'ExpiredCodeException' })
      const { user } = setup()
      await advanceToPhase2(user)
      await user.type(codeInput(), '111111')
      await user.type(newPassInput(), 'NewPass12!')
      await user.type(confirmInput(), 'NewPass12!')
      await user.click(setPassBtn())
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(/expired/i)
      )
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('does not redirect to /login when confirmNewPassword throws', async () => {
      mockConfirmNewPassword.mockRejectedValueOnce({ message: 'Network error' })
      const { user } = setup()
      await advanceToPhase2(user)
      await user.type(codeInput(), '654321')
      await user.type(newPassInput(), 'NewPass12!')
      await user.type(confirmInput(), 'NewPass12!')
      await user.click(setPassBtn())
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
      expect(mockPush).not.toHaveBeenCalled()
    })
  })
})
