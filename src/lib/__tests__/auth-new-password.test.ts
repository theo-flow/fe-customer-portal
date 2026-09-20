import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateUser:            vi.fn(),
  completeNewPasswordChallenge: vi.fn(),
}))

vi.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: vi.fn().mockImplementation(function () { return {} }),
  CognitoUser: vi.fn().mockImplementation(function () {
    return {
      authenticateUser:             mocks.authenticateUser,
      completeNewPasswordChallenge: mocks.completeNewPasswordChallenge,
    }
  }),
  AuthenticationDetails: vi.fn().mockImplementation(function (d) { return d }),
  CognitoUserAttribute:  vi.fn().mockImplementation(function (d) { return d }),
}))

import { signIn, completeNewPassword } from '../auth'

const session = { getIdToken: () => ({ getJwtToken: () => 'new-jwt' }) }

describe('invited agent first sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.cookie = 'tf_token=; path=/; max-age=0'
  })

  it('signIn reports NewPasswordRequired for a temporary password', async () => {
    mocks.authenticateUser.mockImplementation((_d, cb) => cb.newPasswordRequired({}, []))
    await expect(signIn('a@b.com', 'temp')).rejects.toMatchObject({ code: 'NewPasswordRequired' })
  })

  it('completeNewPassword answers the challenge with the chosen password and sets the login cookie', async () => {
    mocks.authenticateUser.mockImplementation((_d, cb) => cb.newPasswordRequired({}, []))
    mocks.completeNewPasswordChallenge.mockImplementation((_pw, _attrs, cb) => cb.onSuccess(session))

    await completeNewPassword('a@b.com', 'temp', 'Chosen-Passw0rd!')

    expect(mocks.completeNewPasswordChallenge.mock.calls[0][0]).toBe('Chosen-Passw0rd!')
    expect(document.cookie).toContain('tf_token=new-jwt')
  })

  it('rejects when Cognito refuses the new password', async () => {
    mocks.authenticateUser.mockImplementation((_d, cb) => cb.newPasswordRequired({}, []))
    mocks.completeNewPasswordChallenge.mockImplementation((_pw, _attrs, cb) =>
      cb.onFailure({ code: 'InvalidPasswordException' }))

    await expect(completeNewPassword('a@b.com', 'temp', 'weak')).rejects.toMatchObject({ code: 'InvalidPasswordException' })
    expect(document.cookie).not.toContain('tf_token=new-jwt')
  })

  it('rejects when the temporary password is wrong', async () => {
    mocks.authenticateUser.mockImplementation((_d, cb) => cb.onFailure({ code: 'NotAuthorizedException' }))
    await expect(completeNewPassword('a@b.com', 'wrong', 'Chosen-Passw0rd!')).rejects.toMatchObject({ code: 'NotAuthorizedException' })
    expect(mocks.completeNewPasswordChallenge).not.toHaveBeenCalled()
  })
})
