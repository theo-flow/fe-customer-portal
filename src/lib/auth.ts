import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js'

/* ── Pool singleton — lazy to avoid SSR issues ────────────────── */
let _pool: CognitoUserPool | null = null

function getPool(): CognitoUserPool {
  if (!_pool) {
    _pool = new CognitoUserPool({
      UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
      ClientId:   process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
    })
  }
  return _pool
}

function makeUser(email: string): CognitoUser {
  return new CognitoUser({ Username: email, Pool: getPool() })
}

/* ── Cookie helpers (client-side only) ────────────────────────── */
const COOKIE_NAME = 'tf_token'
const ONE_HOUR    = 60 * 60

export function setAuthCookie(token: string): void {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE_NAME}=${token}; path=/; max-age=${ONE_HOUR}; SameSite=Strict${secure}`
}

export function clearAuthCookie(): void {
  // Must mirror setAuthCookie's attributes exactly (SameSite/Secure) --
  // a mismatched attribute set can make the browser treat this as setting
  // a *different* cookie rather than overwriting/deleting the original one.
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Strict${secure}`
}

export function getAuthCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`))
  return match ? match[1] : null
}

/* ── Auth error mapper ────────────────────────────────────────── */
export function friendlyError(err: { code?: string; message?: string }): string {
  switch (err.code) {
    case 'UserNotFoundException':
    case 'NotAuthorizedException':
      // Intentionally identical — prevents user enumeration
      return 'The email address or password is incorrect.'
    case 'UserNotConfirmedException':
      return 'Please verify your email before signing in.'
    case 'UsernameExistsException':
      return 'An account with this email already exists.'
    case 'InvalidPasswordException':
      return 'Password must be at least 12 characters and include an uppercase letter, a number, and a symbol.'
    case 'CodeMismatchException':
      return 'Incorrect verification code. Please try again.'
    case 'ExpiredCodeException':
      return 'Verification code has expired. Please request a new one.'
    case 'LimitExceededException':
      return 'Too many attempts. Please wait a few minutes and try again.'
    case 'TooManyRequestsException':
      return 'Too many requests. Please slow down and try again.'
    default:
      return err.message ?? 'Something went wrong. Please try again.'
  }
}

/* ── signIn ───────────────────────────────────────────────────── */
export function signIn(email: string, password: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const authDetails = new AuthenticationDetails({ Username: email, Password: password })
    const user = makeUser(email)

    user.authenticateUser(authDetails, {
      onSuccess: (session) => {
        setAuthCookie(session.getIdToken().getJwtToken())
        resolve(session)
      },
      onFailure: reject,
      newPasswordRequired: () =>
        reject({ code: 'NewPasswordRequired', message: 'A new password is required.' }),
    })
  })
}

/* ── signUp ───────────────────────────────────────────────────── */
export function signUp(email: string, password: string, name: string, orgId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const attributes = [
      new CognitoUserAttribute({ Name: 'email',          Value: email  }),
      new CognitoUserAttribute({ Name: 'name',           Value: name   }),
      new CognitoUserAttribute({ Name: 'custom:org_id',  Value: orgId  }),
    ]
    getPool().signUp(email, password, attributes, [], (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

/* ── confirmSignUp ────────────────────────────────────────────── */
export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    makeUser(email).confirmRegistration(code, true, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

/* ── resendCode ───────────────────────────────────────────────── */
export function resendCode(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    makeUser(email).resendConfirmationCode((err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

/* ── signOut ──────────────────────────────────────────────────── */
export function signOut(): void {
  const user = getPool().getCurrentUser()
  if (user) user.signOut()
  clearAuthCookie()
}

/* ── forgotPassword — sends reset code to email ───────────────── */
export function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    makeUser(email).forgotPassword({
      onSuccess: () => resolve(),
      onFailure: reject,
    })
  })
}

/* ── confirmNewPassword — verifies code and sets new password ─── */
export function confirmNewPassword(email: string, code: string, newPassword: string): Promise<void> {
  return new Promise((resolve, reject) => {
    makeUser(email).confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: reject,
    })
  })
}

/* ── getSession — refreshes token if expired ──────────────────── */
export function getSession(): Promise<CognitoUserSession | null> {
  return new Promise((resolve) => {
    const user = getPool().getCurrentUser()
    if (!user) return resolve(null)
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) return resolve(null)
      // Refresh cookie with latest token
      setAuthCookie(session.getIdToken().getJwtToken())
      resolve(session)
    })
  })
}
