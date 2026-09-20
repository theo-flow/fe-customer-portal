import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@/lib/aws', () => ({ sqsClient: () => ({ send: mockSend }) }))
vi.mock('@aws-sdk/client-sqs', () => ({
  SendMessageCommand: vi.fn(function (this: unknown, input: unknown) { return { input } }),
}))

async function load(url: string | undefined) {
  vi.resetModules()
  if (url) process.env.SQS_NOTIFY_URL = url
  else delete process.env.SQS_NOTIFY_URL
  return import('../notify-queue')
}

const team = {
  correlationId: 'c-1', toEmail: 'jane@org.com', inviteeName: 'Jane', orgName: 'Onte Ika',
  invitedBy: 'Thabo', temporaryPassword: 'Abcd2345Efgh6789', signInUrl: 'https://x.test/login', validDays: 7,
}

describe('notify-queue', () => {
  beforeEach(() => { vi.clearAllMocks(); mockSend.mockResolvedValue({}) })

  it('queues the team invite rendered from the portal template', async () => {
    const { enqueueTeamInviteEmail } = await load('https://sqs.test/notify')
    expect(await enqueueTeamInviteEmail(team)).toBe(true)

    const body = JSON.parse(mockSend.mock.calls[0][0].input.MessageBody)
    expect(mockSend.mock.calls[0][0].input.QueueUrl).toBe('https://sqs.test/notify')
    expect(body).toMatchObject({
      correlation_id: 'c-1', notification_type: 'team_invite', to_email: 'jane@org.com',
      subject: 'Thabo invited you to join Onte Ika on TheoFlow',
    })
    expect(body.html_body).toContain('Abcd2345Efgh6789')
    expect(body.body_text).toContain('https://x.test/login')
  })

  it('returns false and never throws when the queue is not configured', async () => {
    const { enqueueTeamInviteEmail } = await load(undefined)
    expect(await enqueueTeamInviteEmail(team)).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns false and does not log the password when sending fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSend.mockRejectedValueOnce(new Error('sqs down'))
    const { enqueueTeamInviteEmail } = await load('https://sqs.test/notify')

    expect(await enqueueTeamInviteEmail(team)).toBe(false)
    expect(JSON.stringify(err.mock.calls)).not.toContain('Abcd2345Efgh6789')
    err.mockRestore()
  })

  it('still queues form invites and replies', async () => {
    const { enqueueRecipientInviteEmail, enqueueSubmissionReplyEmail } = await load('https://sqs.test/notify')
    await enqueueRecipientInviteEmail({
      correlationId: 'c-2', toEmail: 's@x.test', recipientName: 'Sam', orgName: null,
      logoUrl: 'https://x.test/l.png', groupLabel: 'Claim', fillUrl: 'https://x.test/f',
    })
    await enqueueSubmissionReplyEmail({
      correlationId: 'c-3', toEmail: 'a@x.test', recipientName: 'Sam', groupLabel: 'Claim', submissionUrl: 'https://x.test/s',
    })
    const types = mockSend.mock.calls.map(c => JSON.parse(c[0].input.MessageBody).notification_type)
    expect(types).toEqual(['recipient_invite', 'submission_reply'])
  })
})
