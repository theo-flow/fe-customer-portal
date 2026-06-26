import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoist mock references so they're accessible inside vi.mock factory ── */
const mocks = vi.hoisted(() => ({
  signUp:                   vi.fn(),
  getCurrentUser:           vi.fn(),
  authenticateUser:         vi.fn(),
  confirmRegistration:      vi.fn(),
  resendConfirmationCode:   vi.fn(),
  signOut:                  vi.fn(),
  getSession:               vi.fn(),
  forgotPassword:           vi.fn(),
  confirmPassword:          vi.fn(),
  getIdToken:               vi.fn(() => ({ getJwtToken: () => 'mock-jwt-token' })),
}))

vi.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: vi.fn().mockImplementation(function() {
    return {
      signUp:         mocks.signUp,
      getCurrentUser: mocks.getCurrentUser,
    }
  }),
  CognitoUser: vi.fn().mockImplementation(function() {
    return {
      authenticateUser:       mocks.authenticateUser,
      confirmRegistration:    mocks.confirmRegistration,
      resendConfirmationCode: mocks.resendConfirmationCode,
      signOut:                mocks.signOut,
      getSession:             mocks.getSession,
      forgotPassword:         mocks.forgotPassword,
      confirmPassword:        mocks.confirmPassword,
    }
  }),
  AuthenticationDetails: vi.fn().mockImplementation(function(d) { return d }),
  CognitoUserAttribute:  vi.fn().mockImplementation(function(d) { return d }),
}))

import {
  signIn, signUp, confirmSignUp, resendCode, signOut, getSession,
  forgotPassword, confirmNewPassword,
  setAuthCookie, clearAuthCookie, getAuthCookie,
  friendlyError,
} from '../auth'

/* ── Cookie helpers ──────────────────────────────────────────── */
describe('cookie helpers', () => {
  beforeEach(() => { document.cookie = 'tf_token=; max-age=0' })

  it('setAuthCookie writes tf_token cookie', () => {
    setAuthCookie('abc123')
    expect(document.cookie).toContain('tf_token=abc123')
  })

  it('getAuthCookie reads the stored token', () => {
    setAuthCookie('xyz789')
    expect(getAuthCookie()).toBe('xyz789')
  })

  it('clearAuthCookie removes the token', () => {
    setAuthCookie('to-be-removed')
    clearAuthCookie()
    expect(getAuthCookie()).toBeNull()
  })

  it('getAuthCookie returns null when no cookie is set', () => {
    expect(getAuthCookie()).toBeNull()
  })
})

/* ── friendlyError ───────────────────────────────────────────── */
describe('friendlyError', () => {
  describe('user enumeration prevention', () => {
    it('returns the same message for UserNotFoundException and NotAuthorizedException', () => {
      const msgNotFound   = friendlyError({ code: 'UserNotFoundException' })
      const msgBadPass    = friendlyError({ code: 'NotAuthorizedException' })
      expect(msgNotFound).toBe(msgBadPass)
    })

    it('does not say "no account" or "incorrect password" separately', () => {
      const msg = friendlyError({ code: 'UserNotFoundException' })
      expect(msg.toLowerCase()).not.toContain('no account')
      expect(msg.toLowerCase()).not.toContain('incorrect password')
    })

    it('returns the generic auth message', () => {
      expect(friendlyError({ code: 'UserNotFoundException' })).toMatch(/email.*password|password.*email/i)
    })
  })

  it.each([
    ['UserNotConfirmedException', 'verify your email'],
    ['UsernameExistsException',   'already exists'],
    ['CodeMismatchException',     'Incorrect verification code'],
    ['ExpiredCodeException',      'expired'],
    ['LimitExceededException',    'Too many attempts'],
    ['TooManyRequestsException',  'slow down'],
    ['InvalidPasswordException',  '12 characters'],
  ])('maps %s to a user-friendly string containing "%s"', (code, fragment) => {
    expect(friendlyError({ code })).toContain(fragment)
  })

  it('falls back to the raw message for unknown codes', () => {
    expect(friendlyError({ code: 'UnknownCode', message: 'Raw error' })).toBe('Raw error')
  })

  it('falls back to generic message when no code or message', () => {
    expect(friendlyError({})).toMatch(/something went wrong/i)
  })
})

/* ── signIn ──────────────────────────────────────────────────── */
describe('signIn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.cookie = 'tf_token=; max-age=0'
  })

  it('resolves and sets cookie on success', async () => {
    const mockSession = { getIdToken: mocks.getIdToken, isValid: () => true }
    mocks.authenticateUser.mockImplementation((_: unknown, cb: { onSuccess: (s: typeof mockSession) => void }) => {
      cb.onSuccess(mockSession)
    })
    const session = await signIn('user@example.com', 'Password123!')
    expect(session).toBe(mockSession)
    expect(getAuthCookie()).toBe('mock-jwt-token')
  })

  it('rejects with NotAuthorizedException on wrong password', async () => {
    const err = { code: 'NotAuthorizedException' }
    mocks.authenticateUser.mockImplementation((_: unknown, cb: { onFailure: (e: typeof err) => void }) => {
      cb.onFailure(err)
    })
    await expect(signIn('user@example.com', 'wrong')).rejects.toMatchObject({ code: 'NotAuthorizedException' })
  })

  it('rejects with UserNotFoundException for unknown email', async () => {
    const err = { code: 'UserNotFoundException' }
    mocks.authenticateUser.mockImplementation((_: unknown, cb: { onFailure: (e: typeof err) => void }) => {
      cb.onFailure(err)
    })
    await expect(signIn('nobody@example.com', 'any')).rejects.toMatchObject({ code: 'UserNotFoundException' })
  })

  it('rejects with UserNotConfirmedException for unverified account', async () => {
    const err = { code: 'UserNotConfirmedException' }
    mocks.authenticateUser.mockImplementation((_: unknown, cb: { onFailure: (e: typeof err) => void }) => {
      cb.onFailure(err)
    })
    await expect(signIn('user@example.com', 'Password123!')).rejects.toMatchObject({ code: 'UserNotConfirmedException' })
  })

  it('rejects with NewPasswordRequired code when forced reset is needed', async () => {
    mocks.authenticateUser.mockImplementation((_: unknown, cb: { newPasswordRequired: () => void }) => {
      cb.newPasswordRequired()
    })
    await expect(signIn('user@example.com', 'OldPass1!')).rejects.toMatchObject({ code: 'NewPasswordRequired' })
  })

  it('does not set cookie when authentication fails', async () => {
    const err = { code: 'NotAuthorizedException' }
    mocks.authenticateUser.mockImplementation((_: unknown, cb: { onFailure: (e: typeof err) => void }) => {
      cb.onFailure(err)
    })
    await signIn('user@example.com', 'wrong').catch(() => {})
    expect(getAuthCookie()).toBeNull()
  })
})

/* ── signUp ──────────────────────────────────────────────────── */
describe('signUp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves on successful registration', async () => {
    mocks.signUp.mockImplementation(
      (_u: string, _p: string, _a: unknown[], _v: unknown[], cb: (err: null, result: object) => void) => cb(null, {})
    )
    await expect(signUp('new@example.com', 'Pass12!Upper', 'Test User', 'org-abc123')).resolves.toBeUndefined()
  })

  it('rejects when email already exists (UsernameExistsException)', async () => {
    const err = { code: 'UsernameExistsException' }
    mocks.signUp.mockImplementation(
      (_u: string, _p: string, _a: unknown[], _v: unknown[], cb: (err: typeof err) => void) => cb(err)
    )
    await expect(signUp('existing@example.com', 'Pass12!Upper', 'Test User', 'org-abc123'))
      .rejects.toMatchObject({ code: 'UsernameExistsException' })
  })

  it('rejects when password is too weak (InvalidPasswordException)', async () => {
    const err = { code: 'InvalidPasswordException' }
    mocks.signUp.mockImplementation(
      (_u: string, _p: string, _a: unknown[], _v: unknown[], cb: (err: typeof err) => void) => cb(err)
    )
    await expect(signUp('user@example.com', 'weak', 'Test User', 'org-abc123'))
      .rejects.toMatchObject({ code: 'InvalidPasswordException' })
  })
})

/* ── confirmSignUp ───────────────────────────────────────────── */
describe('confirmSignUp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves on correct code', async () => {
    mocks.confirmRegistration.mockImplementation((_code: string, _force: boolean, cb: (err: null, result: string) => void) => cb(null, 'SUCCESS'))
    await expect(confirmSignUp('user@example.com', '123456')).resolves.toBeUndefined()
  })

  it('rejects on wrong code (CodeMismatchException)', async () => {
    const err = { code: 'CodeMismatchException' }
    mocks.confirmRegistration.mockImplementation((_code: string, _force: boolean, cb: (err: typeof err) => void) => cb(err))
    await expect(confirmSignUp('user@example.com', '000000')).rejects.toMatchObject({ code: 'CodeMismatchException' })
  })

  it('rejects on expired code (ExpiredCodeException)', async () => {
    const err = { code: 'ExpiredCodeException' }
    mocks.confirmRegistration.mockImplementation((_code: string, _force: boolean, cb: (err: typeof err) => void) => cb(err))
    await expect(confirmSignUp('user@example.com', '111111')).rejects.toMatchObject({ code: 'ExpiredCodeException' })
  })
})

/* ── forgotPassword ──────────────────────────────────────────── */
describe('forgotPassword', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves when Cognito sends the reset code', async () => {
    mocks.forgotPassword.mockImplementation((cb: { onSuccess: () => void }) => cb.onSuccess())
    await expect(forgotPassword('user@example.com')).resolves.toBeUndefined()
  })

  it('rejects when the account does not exist (UserNotFoundException)', async () => {
    const err = { code: 'UserNotFoundException' }
    mocks.forgotPassword.mockImplementation((cb: { onFailure: (e: typeof err) => void }) => cb.onFailure(err))
    await expect(forgotPassword('ghost@example.com')).rejects.toMatchObject({ code: 'UserNotFoundException' })
  })

  it('rejects on rate limit (LimitExceededException)', async () => {
    const err = { code: 'LimitExceededException' }
    mocks.forgotPassword.mockImplementation((cb: { onFailure: (e: typeof err) => void }) => cb.onFailure(err))
    await expect(forgotPassword('user@example.com')).rejects.toMatchObject({ code: 'LimitExceededException' })
  })
})

/* ── confirmNewPassword ──────────────────────────────────────── */
describe('confirmNewPassword', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves when code and new password are accepted', async () => {
    mocks.confirmPassword.mockImplementation((_code: string, _pass: string, cb: { onSuccess: () => void }) => cb.onSuccess())
    await expect(confirmNewPassword('user@example.com', '123456', 'NewPass12!')).resolves.toBeUndefined()
  })

  it('rejects on wrong code (CodeMismatchException)', async () => {
    const err = { code: 'CodeMismatchException' }
    mocks.confirmPassword.mockImplementation((_code: string, _pass: string, cb: { onFailure: (e: typeof err) => void }) => cb.onFailure(err))
    await expect(confirmNewPassword('user@example.com', '000000', 'NewPass12!')).rejects.toMatchObject({ code: 'CodeMismatchException' })
  })

  it('rejects on expired token (ExpiredCodeException)', async () => {
    const err = { code: 'ExpiredCodeException' }
    mocks.confirmPassword.mockImplementation((_code: string, _pass: string, cb: { onFailure: (e: typeof err) => void }) => cb.onFailure(err))
    await expect(confirmNewPassword('user@example.com', '111111', 'NewPass12!')).rejects.toMatchObject({ code: 'ExpiredCodeException' })
  })

  it('rejects when new password is too weak (InvalidPasswordException)', async () => {
    const err = { code: 'InvalidPasswordException' }
    mocks.confirmPassword.mockImplementation((_code: string, _pass: string, cb: { onFailure: (e: typeof err) => void }) => cb.onFailure(err))
    await expect(confirmNewPassword('user@example.com', '123456', 'weak')).rejects.toMatchObject({ code: 'InvalidPasswordException' })
  })
})

/* ── resendCode ──────────────────────────────────────────────── */
describe('resendCode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves on success', async () => {
    mocks.resendConfirmationCode.mockImplementation((cb: (err: null, result: object) => void) => cb(null, {}))
    await expect(resendCode('user@example.com')).resolves.toBeUndefined()
  })

  it('rejects on rate limit (LimitExceededException)', async () => {
    const err = { code: 'LimitExceededException' }
    mocks.resendConfirmationCode.mockImplementation((cb: (err: typeof err) => void) => cb(err))
    await expect(resendCode('user@example.com')).rejects.toMatchObject({ code: 'LimitExceededException' })
  })
})

/* ── signOut ─────────────────────────────────────────────────── */
describe('signOut', () => {
  it('clears the auth cookie', () => {
    setAuthCookie('some-token')
    mocks.getCurrentUser.mockReturnValue({ signOut: mocks.signOut })
    signOut()
    expect(getAuthCookie()).toBeNull()
  })

  it('calls Cognito signOut on the current user', () => {
    mocks.getCurrentUser.mockReturnValue({ signOut: mocks.signOut })
    signOut()
    expect(mocks.signOut).toHaveBeenCalled()
  })

  it('does not throw when no user is signed in', () => {
    mocks.getCurrentUser.mockReturnValue(null)
    expect(() => signOut()).not.toThrow()
  })
})

/* ── getSession ──────────────────────────────────────────────── */
describe('getSession', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns session and refreshes cookie when valid', async () => {
    const mockSession = { isValid: () => true, getIdToken: mocks.getIdToken }
    mocks.getCurrentUser.mockReturnValue({ getSession: mocks.getSession })
    mocks.getSession.mockImplementation((cb: (err: null, s: typeof mockSession) => void) => cb(null, mockSession))

    const result = await getSession()
    expect(result).toBe(mockSession)
    expect(getAuthCookie()).toBe('mock-jwt-token')
  })

  it('returns null when no user is signed in', async () => {
    mocks.getCurrentUser.mockReturnValue(null)
    expect(await getSession()).toBeNull()
  })

  it('returns null when session is expired', async () => {
    const expiredSession = { isValid: () => false, getIdToken: mocks.getIdToken }
    mocks.getCurrentUser.mockReturnValue({ getSession: mocks.getSession })
    mocks.getSession.mockImplementation((cb: (err: null, s: typeof expiredSession) => void) => cb(null, expiredSession))
    expect(await getSession()).toBeNull()
  })

  it('returns null when getSession errors', async () => {
    mocks.getCurrentUser.mockReturnValue({ getSession: mocks.getSession })
    mocks.getSession.mockImplementation((cb: (err: Error, s: null) => void) => cb(new Error('network'), null))
    expect(await getSession()).toBeNull()
  })
})
