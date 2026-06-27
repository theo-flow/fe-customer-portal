import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/* ── Hoist mock references so they're accessible inside vi.mock factory ── */
const { mockPush, mockConfirmSignUp, mockResendCode } = vi.hoisted(() => ({
  mockPush:          vi.fn(),
  mockConfirmSignUp: vi.fn(),
  mockResendCode:    vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

vi.mock('@/lib/auth', () => ({
  confirmSignUp: mockConfirmSignUp,
  resendCode:    mockResendCode,
  friendlyError: (err: { code?: string; message?: string }) => err.message ?? 'Error',
}))

import VerifyPage from '../page'

/* ── Helper ── */
const setup = (email = 'user@example.com') => {
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(email)
  const user = userEvent.setup()
  render(<VerifyPage />)
  return {
    user,
    digitInputs: () => screen.getAllByRole('textbox'),
    submitBtn:   () => screen.getByRole('button', { name: /verify account/i }),
    resendBtn:   () => screen.queryByRole('button', { name: /resend code/i }),
  }
}

const typeCode = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
  const inputs = screen.getAllByRole('textbox')
  for (let i = 0; i < code.length; i++) {
    await user.type(inputs[i], code[i])
  }
}

describe('VerifyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders 6 digit input boxes', () => {
    const { digitInputs } = setup()
    expect(digitInputs()).toHaveLength(6)
  })

  it('displays the pending email address', () => {
    setup('broker@test.com')
    expect(screen.getByText('broker@test.com')).toBeInTheDocument()
  })

  it('verify button is disabled until 6 digits are entered', () => {
    const { submitBtn } = setup()
    expect(submitBtn()).toBeDisabled()
  })

  it('auto-submits when 6th digit is typed', async () => {
    mockConfirmSignUp.mockResolvedValueOnce(undefined)
    const { user } = setup()
    await typeCode(user, '123456')
    await waitFor(() => expect(mockConfirmSignUp).toHaveBeenCalledWith('user@example.com', '123456'))
  })

  it('redirects to /login?verified=1 on successful confirmation', async () => {
    mockConfirmSignUp.mockResolvedValueOnce(undefined)
    const { user } = setup()
    await typeCode(user, '123456')
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login?verified=1'))
  })

  it('shows error and clears digits on wrong code', async () => {
    mockConfirmSignUp.mockRejectedValueOnce({
      code: 'CodeMismatchException',
      message: 'Incorrect verification code.',
    })
    const { user } = setup()
    await typeCode(user, '000000')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Incorrect verification code.'))
    screen.getAllByRole('textbox').forEach(input => {
      expect((input as HTMLInputElement).value).toBe('')
    })
  })

  it('calls resendCode and shows countdown on resend click', async () => {
    mockResendCode.mockResolvedValueOnce(undefined)
    const { user, resendBtn } = setup()

    const btn = resendBtn()
    expect(btn).toBeInTheDocument()
    await user.click(btn!)

    await waitFor(() => expect(mockResendCode).toHaveBeenCalledWith('user@example.com'))
    expect(screen.getByText(/resend code in/i)).toBeInTheDocument()
  })
})
