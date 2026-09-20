import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Every route that starts work must refuse a locked org (one whose pilot was
// cancelled) before it touches any AWS service. This calls each one with the org
// locked and checks nothing ran; the routes' own suites cover their normal paths.
const { mockCookieGet, mockLocked, awsCalls } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(),
  mockLocked:    vi.fn(),
  awsCalls:      vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@/lib/org-access', () => ({ orgLocked: mockLocked }))

// Any use of an AWS client counts as "the route did work".
vi.mock('@/lib/aws', () => {
  const client = () => ({ send: awsCalls })
  return {
    ddbDocClient: client, s3Client: client, sqsClient: client, eventBridgeClient: client, cognitoClient: client,
    TABLE: 't', BUCKET: 'b', OUTPUT_BUCKET: 'o', CONTACT_TABLE: 'c', GATE_KEEP_BUCKET: 'g', GATE_KEEP_TABLE: 'gt', USER_POOL_ID: 'p',
  }
})

import { verifyJwtClaims } from '@/lib/token'
import { POST as uploadsPresign }   from '../uploads/presign/route'
import { POST as uploadsConfirm }   from '../uploads/confirm/route'
import { POST as templatesPresign } from '../templates/presign/route'
import { POST as formsPublish }     from '../forms/[group]/publish/route'
import { POST as recipientsCreate } from '../forms/[group]/recipients/route'
import { POST as signSessions }     from '../sign/sessions/route'
import { POST as signPresign }      from '../sign/upload/presign/route'
import { POST as printGenerate }    from '../print/generate/route'
import { POST as publicSubmit }     from '../public/forms/[orgId]/[group]/submit/route'
import { POST as recipientSubmit }  from '../public/forms/[orgId]/[group]/[recipientId]/[token]/submit/route'

const claims = { sub: 'u1', email: 'a@b.com', exp: 9999999999, 'custom:org_id': 'org-1', 'custom:role': 'admin' }
const req = { json: async () => ({}) } as unknown as NextRequest
const lockedResponse = () => NextResponse.json({ error: 'locked', code: 'org_locked' }, { status: 403 })

const authenticated: [string, () => Promise<Response>][] = [
  ['uploads/presign',           () => uploadsPresign(req)],
  ['uploads/confirm',           () => uploadsConfirm(req)],
  ['templates/presign',         () => templatesPresign(req)],
  ['forms/[group]/publish',     () => formsPublish(req, { params: { group: 'claim' } })],
  ['forms/[group]/recipients',  () => recipientsCreate(req, { params: { group: 'claim' } })],
  ['sign/sessions',             () => signSessions(req)],
  ['sign/upload/presign',       () => signPresign(req)],
  ['print/generate',            () => printGenerate(req)],
]

describe('a locked org cannot start work', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue(claims)
  })

  it.each(authenticated)('%s refuses with the locked response and touches nothing', async (_name, call) => {
    mockLocked.mockResolvedValue(lockedResponse())

    const res = await call()

    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('org_locked')
    expect(awsCalls).not.toHaveBeenCalled()
  })

  it.each(authenticated)('%s checks the caller\'s own org', async (_name, call) => {
    mockLocked.mockResolvedValue(lockedResponse())
    await call()
    expect(mockLocked).toHaveBeenCalledWith('org-1')
  })

  it.each(authenticated)('%s still needs a login before it says anything about locking', async (_name, call) => {
    mockCookieGet.mockReturnValue(undefined)
    expect((await call()).status).toBe(401)
    expect(mockLocked).not.toHaveBeenCalled()
  })

  const publicRoutes: [string, () => Promise<Response>][] = [
    ['public form submit',           () => publicSubmit(req, { params: { orgId: 'org-1', group: 'claim' } })],
    ['personal-link form submit',    () => recipientSubmit(req, { params: { orgId: 'org-1', group: 'claim', recipientId: 'r', token: 't' } })],
  ]

  it.each(publicRoutes)('%s stops accepting submissions and does not say why', async (_name, call) => {
    mockLocked.mockResolvedValue(lockedResponse())

    const res = await call()

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Form not available' })
    expect(awsCalls).not.toHaveBeenCalled()
  })
})
