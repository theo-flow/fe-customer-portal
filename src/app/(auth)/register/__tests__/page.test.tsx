import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

/* ── Hoist mock references ── */
const { mockPush, mockSignUp } = vi.hoisted(() => ({
  mockPush:   vi.fn(),
  mockSignUp: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

vi.mock('@/lib/auth', () => ({
  signUp:        mockSignUp,
  friendlyError: (err: { code?: string; message?: string }) => err.message ?? 'Error',
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('div', rest as React.HTMLAttributes<HTMLDivElement>, children),
  },
}))

import RegisterPage from '../page'

/* ── Step navigation helper ── */

async function goToCredentials(user: ReturnType<typeof userEvent.setup>, orgName = 'Test Org Ltd') {
  await user.type(screen.getByPlaceholderText(/abc brokers/i), orgName)
  await user.click(screen.getByRole('button', { name: /^continue$/i }))
  await waitFor(() => expect(screen.getByText(/create your account/i)).toBeInTheDocument())
}

const setup = () => {
  const user = userEvent.setup()
  render(<RegisterPage />)
  return { user }
}

describe('RegisterPage', () => {
  beforeEach(() => vi.clearAllMocks())

  /* ════════════════════════════════════════════════════════
     STEP 1: Organisation
  ════════════════════════════════════════════════════════ */
  describe('Step 1 — Organisation', () => {
    it('renders the org name input on initial load', () => {
      setup()
      expect(screen.getByPlaceholderText(/abc brokers/i)).toBeInTheDocument()
    })

    it('shows error when org name is empty', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: /continue/i }))
      expect(screen.getByRole('alert')).toHaveTextContent(/organisation name is required/i)
    })

    it('shows error when org name is fewer than 2 characters', async () => {
      const { user } = setup()
      await user.type(screen.getByPlaceholderText(/abc brokers/i), 'X')
      await user.click(screen.getByRole('button', { name: /continue/i }))
      expect(screen.getByRole('alert')).toHaveTextContent(/at least 2 characters/i)
    })

    it('shows error when org name exceeds 100 characters', async () => {
      const { user } = setup()
      await user.type(screen.getByPlaceholderText(/abc brokers/i), 'A'.repeat(101))
      await user.click(screen.getByRole('button', { name: /continue/i }))
      expect(screen.getByRole('alert')).toHaveTextContent(/100 characters/i)
    })

    it('shows error for an invalid phone number', async () => {
      const { user } = setup()
      await user.type(screen.getByPlaceholderText(/abc brokers/i), 'Test Org Ltd')
      await user.type(screen.getByPlaceholderText(/\+27 11 000/i), '12345')
      await user.click(screen.getByRole('button', { name: /continue/i }))
      expect(screen.getByRole('alert')).toHaveTextContent(/valid phone number/i)
    })

    it('accepts a valid +27 phone number and advances to Step 2', async () => {
      const { user } = setup()
      await user.type(screen.getByPlaceholderText(/abc brokers/i), 'Test Org Ltd')
      await user.type(screen.getByPlaceholderText(/\+27 11 000/i), '+27821234567')
      await user.click(screen.getByRole('button', { name: /continue/i }))
      await waitFor(() => expect(screen.getByText(/create your account/i)).toBeInTheDocument())
    })

    it('accepts a valid 0XXXXXXXXX phone number and advances', async () => {
      const { user } = setup()
      await user.type(screen.getByPlaceholderText(/abc brokers/i), 'Test Org Ltd')
      await user.type(screen.getByPlaceholderText(/\+27 11 000/i), '0821234567')
      await user.click(screen.getByRole('button', { name: /continue/i }))
      await waitFor(() => expect(screen.getByText(/create your account/i)).toBeInTheDocument())
    })

    it('advances to Step 2 without a phone number (phone is optional)', async () => {
      const { user } = setup()
      await goToCredentials(user)
      expect(screen.getByText(/create your account/i)).toBeInTheDocument()
    })

    it('shows free-text field when "Other" industry is selected', async () => {
      const { user } = setup()
      await user.selectOptions(screen.getByRole('combobox'), 'Other')
      expect(screen.getByPlaceholderText(/describe your industry/i)).toBeInTheDocument()
    })

    it('hides free-text field when a non-Other industry is selected after Other', async () => {
      const { user } = setup()
      await user.selectOptions(screen.getByRole('combobox'), 'Other')
      await user.selectOptions(screen.getByRole('combobox'), 'Manufacturing')
      expect(screen.queryByPlaceholderText(/describe your industry/i)).not.toBeInTheDocument()
    })

    it('sends otherIndustry description instead of "Other" in API call', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok:   true,
        json: async () => ({ orgId: 'org-other-001' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      mockSignUp.mockResolvedValueOnce(undefined)

      const { user } = setup()
      await user.type(screen.getByPlaceholderText(/abc brokers/i), 'Artisan Bakers Co')
      await user.selectOptions(screen.getByRole('combobox'), 'Other')
      await user.type(screen.getByPlaceholderText(/describe your industry/i), 'Artisanal Bakery')
      await user.click(screen.getByRole('button', { name: /^continue$/i }))
      await waitFor(() => expect(screen.getByText(/create your account/i)).toBeInTheDocument())

      await user.type(screen.getByPlaceholderText(/thabo nkosi/i),      'Test Admin')
      await user.type(screen.getByPlaceholderText(/you@example\.com/i), 'admin@artisan.co.za')
      await user.type(screen.getByPlaceholderText(/min\. 12/i),         'StrongPass12!')
      await user.type(screen.getByPlaceholderText(/repeat password/i),  'StrongPass12!')
      await user.click(screen.getByRole('button', { name: /register organisation/i }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.orgType).toBe('Artisanal Bakery')

      vi.unstubAllGlobals()
    })
  })

  /* ════════════════════════════════════════════════════════
     STEP 2: Credentials
  ════════════════════════════════════════════════════════ */
  describe('Step 2 — Credentials', () => {
    async function fillCredentials(
      user: ReturnType<typeof userEvent.setup>,
      overrides: { name?: string; email?: string; password?: string; confirm?: string } = {}
    ) {
      await user.type(screen.getByPlaceholderText(/thabo nkosi/i),      overrides.name     ?? 'Thabo Nkosi')
      await user.type(screen.getByPlaceholderText(/you@example\.com/i), overrides.email    ?? 'thabo@example.com')
      await user.type(screen.getByPlaceholderText(/min\. 12/i),         overrides.password ?? 'StrongPass12!')
      await user.type(screen.getByPlaceholderText(/repeat password/i),  overrides.confirm  ?? 'StrongPass12!')
    }

    it('shows error when full name is empty', async () => {
      const { user } = setup()
      await goToCredentials(user)

      await user.type(screen.getByPlaceholderText(/you@example\.com/i), 'thabo@example.com')
      await user.type(screen.getByPlaceholderText(/min\. 12/i), 'StrongPass12!')
      await user.type(screen.getByPlaceholderText(/repeat password/i), 'StrongPass12!')
      await user.click(screen.getByRole('button', { name: /register organisation/i }))

      expect(screen.getByRole('alert')).toHaveTextContent(/full name is required/i)
    })

    it('shows error when email format is invalid', async () => {
      const { user } = setup()
      await goToCredentials(user)

      await fillCredentials(user, { email: 'not-an-email' })
      await user.click(screen.getByRole('button', { name: /register organisation/i }))

      expect(screen.getByRole('alert')).toHaveTextContent(/valid email address/i)
    })

    it('shows error when passwords do not match', async () => {
      const { user } = setup()
      await goToCredentials(user)

      await fillCredentials(user, { password: 'StrongPass12!', confirm: 'Different12!' })
      await user.click(screen.getByRole('button', { name: /register organisation/i }))

      expect(screen.getByRole('alert')).toHaveTextContent(/passwords do not match/i)
    })

    it('shows error when password has fewer than 12 characters', async () => {
      const { user } = setup()
      await goToCredentials(user)

      // 8 chars, uppercase + number but no symbol → strength=2 (< 4 required)
      await fillCredentials(user, { password: 'Short1Up', confirm: 'Short1Up' })
      await user.click(screen.getByRole('button', { name: /register organisation/i }))

      expect(screen.getByRole('alert')).toHaveTextContent(/12\+/i)
    })

    it('shows error when password is missing required character classes', async () => {
      const { user } = setup()
      await goToCredentials(user)

      // 13 chars, has length + symbol but no uppercase and no number → strength=2 (< 4 required)
      await fillCredentials(user, { password: 'weakpassword!', confirm: 'weakpassword!' })
      await user.click(screen.getByRole('button', { name: /register organisation/i }))

      expect(screen.getByRole('alert')).toHaveTextContent(/uppercase/i)
    })

    it('calls fetch + signUp on valid credentials and redirects to /verify, with no product data in the request', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok:   true,
        json: async () => ({ orgId: 'org-test-123' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      mockSignUp.mockResolvedValueOnce(undefined)

      const { user } = setup()
      await goToCredentials(user)
      await fillCredentials(user)
      await user.click(screen.getByRole('button', { name: /register organisation/i }))

      await waitFor(() =>
        expect(mockSignUp).toHaveBeenCalledWith(
          'thabo@example.com', 'StrongPass12!', 'Thabo Nkosi', 'org-test-123'
        )
      )
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/verify'))

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.subscribedProducts).toBeUndefined()
      expect(body.templates).toBeUndefined()
      expect(body.formGroups).toBeUndefined()

      vi.unstubAllGlobals()
    })

    it('stores pending email in sessionStorage after successful registration', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok:   true,
        json: async () => ({ orgId: 'org-test-456' }),
      }))
      mockSignUp.mockResolvedValueOnce(undefined)
      const setSpy = vi.spyOn(Storage.prototype, 'setItem')

      const { user } = setup()
      await goToCredentials(user)
      await fillCredentials(user)
      await user.click(screen.getByRole('button', { name: /register organisation/i }))

      await waitFor(() =>
        expect(setSpy).toHaveBeenCalledWith('tf_pending_email', 'thabo@example.com')
      )

      vi.unstubAllGlobals()
    })

    it('shows API error and stays on credentials step when signUp rejects', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok:   true,
        json: async () => ({ orgId: 'org-test-789' }),
      }))
      mockSignUp.mockRejectedValueOnce({
        code:    'UsernameExistsException',
        message: 'An account with this email already exists.',
      })

      const { user } = setup()
      await goToCredentials(user)
      await fillCredentials(user)
      await user.click(screen.getByRole('button', { name: /register organisation/i }))

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i)
      )
      expect(mockPush).not.toHaveBeenCalled()

      vi.unstubAllGlobals()
    })
  })
})
