import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { sqsClient } from '@/lib/aws'

const SQS_NOTIFY_URL = process.env.SQS_NOTIFY_URL

// A plain-text email to whoever started a signing session, sent by
// fn-17-notify-sender through the same notify queue everything else uses.
// Best-effort: it never throws, and a failure here must never undo what just
// happened (a signature recorded, a decline saved). No names, addresses or
// message text are logged (POPIA).
export async function enqueueSignNotice(input: {
  correlationId:    string
  notificationType: string
  toEmail:          string | null | undefined
  subject:          string
  bodyText:         string
}): Promise<boolean> {
  if (!input.toEmail) {
    console.warn('[sign-notify] No requester email on the session, notice not queued', { correlationId: input.correlationId })
    return false
  }
  if (!SQS_NOTIFY_URL) {
    console.error('[sign-notify] SQS_NOTIFY_URL not configured, notice not queued', { correlationId: input.correlationId })
    return false
  }
  try {
    await sqsClient().send(new SendMessageCommand({
      QueueUrl: SQS_NOTIFY_URL,
      MessageBody: JSON.stringify({
        correlation_id:    input.correlationId,
        notification_type: input.notificationType,
        to_email:          input.toEmail,
        subject:           input.subject,
        body_text:         input.bodyText,
      }),
    }))
    return true
  } catch (err) {
    console.error('[sign-notify] Failed to queue notice', { correlationId: input.correlationId, error: err })
    return false
  }
}
