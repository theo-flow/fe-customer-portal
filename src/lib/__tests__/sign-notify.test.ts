import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSend } = vi.hoisted(() => {
  process.env.SQS_NOTIFY_URL = 'https://sqs.af-south-1.amazonaws.com/1/daai-insure-notify'
  return { mockSend: vi.fn() }
})

vi.mock('@/lib/aws', () => ({ sqsClient: () => ({ send: mockSend }) }))
vi.mock('@aws-sdk/client-sqs', () => ({
  SendMessageCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Sqs', input } }),
}))

import { enqueueSignNotice } from '../sign-notify'

const input = { correlationId: 'sess-1', notificationType: 'SIGN_DECLINED', toEmail: 'owner@example.com', subject: 'Declined: New AOA', bodyText: 'Someone declined.' }

describe('enqueueSignNotice', () => {
  beforeEach(() => { vi.clearAllMocks(); mockSend.mockResolvedValue({}) })

  it('queues the envelope fn-17 sends, with the session as the correlation id', async () => {
    expect(await enqueueSignNotice(input)).toBe(true)
    const sent = mockSend.mock.calls[0][0]
    expect(sent.input.QueueUrl).toBe('https://sqs.af-south-1.amazonaws.com/1/daai-insure-notify')
    expect(JSON.parse(sent.input.MessageBody)).toEqual({
      correlation_id: 'sess-1', notification_type: 'SIGN_DECLINED', to_email: 'owner@example.com',
      subject: 'Declined: New AOA', body_text: 'Someone declined.',
    })
  })

  it('does nothing, without failing, when there is nobody to tell', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const toEmail of [undefined, null, '']) expect(await enqueueSignNotice({ ...input, toEmail })).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('never throws when the queue is down, and never logs the message text or address', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSend.mockRejectedValue(new Error('sqs down'))
    expect(await enqueueSignNotice(input)).toBe(false)
    const logged = JSON.stringify(err.mock.calls)
    expect(logged).not.toContain('owner@example.com')
    expect(logged).not.toContain('Someone declined.')
  })
})
