import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { sqsClient } from '@/lib/aws'
import {
  recipientInviteEmail,
  submissionReplyEmail,
  teamInviteEmail,
  type RenderedEmail,
} from '@/lib/email-templates'

const SQS_NOTIFY_URL = process.env.SQS_NOTIFY_URL

/**
 * Puts a rendered email on the same `notify` queue fn-06/fn-13/fn-18 already
 * feed -- fn-17-notify-sender is the queue's one consumer, and this reuses it
 * rather than adding another notification mechanism to the platform. Never
 * throws: callers treat a false result as non-fatal or clean up after it. What
 * the email says lives in src/lib/email-templates.ts, not here.
 */
async function enqueueEmail(
  type: string, correlationId: string, toEmail: string, email: RenderedEmail,
): Promise<boolean> {
  if (!SQS_NOTIFY_URL) {
    console.error(`[notify-queue] SQS_NOTIFY_URL not configured -- ${type} not queued`, { correlationId })
    return false
  }
  try {
    await sqsClient().send(new SendMessageCommand({
      QueueUrl: SQS_NOTIFY_URL,
      MessageBody: JSON.stringify({
        correlation_id:    correlationId,
        notification_type: type,
        to_email:          toEmail,
        subject:           email.subject,
        body_text:         email.text,
        html_body:         email.html,
      }),
    }))
    return true
  } catch (err) {
    // The error is logged, never the message: a team invite carries a password.
    console.error(`[notify-queue] Failed to enqueue ${type}`, { correlationId, error: err })
    return false
  }
}

interface RecipientInviteInput {
  correlationId: string
  toEmail:       string
  recipientName: string
  orgName:       string | null
  logoUrl:       string
  groupLabel:    string
  fillUrl:       string
}

export function enqueueRecipientInviteEmail(input: RecipientInviteInput): Promise<boolean> {
  return enqueueEmail('recipient_invite', input.correlationId, input.toEmail, recipientInviteEmail({
    orgLabel:      input.orgName ?? 'TheoFlow',
    logoUrl:       input.logoUrl,
    recipientName: input.recipientName,
    groupLabel:    input.groupLabel,
    fillUrl:       input.fillUrl,
  }))
}

interface SubmissionReplyInput {
  correlationId: string
  toEmail:       string
  recipientName: string
  groupLabel:    string
  submissionUrl: string
}

/** Tells the agent who sent a personal form link that the recipient replied. */
export function enqueueSubmissionReplyEmail(input: SubmissionReplyInput): Promise<boolean> {
  return enqueueEmail('submission_reply', input.correlationId, input.toEmail, submissionReplyEmail(input))
}

interface TeamInviteInput {
  correlationId:     string
  toEmail:           string
  inviteeName:       string
  orgName:           string
  invitedBy:         string
  temporaryPassword: string
  signInUrl:         string
  validDays:         number
}

/** Invites someone to join an organisation as an agent, with their temporary password. */
export function enqueueTeamInviteEmail(input: TeamInviteInput): Promise<boolean> {
  return enqueueEmail('team_invite', input.correlationId, input.toEmail, teamInviteEmail({
    inviteeName:       input.inviteeName,
    orgName:           input.orgName,
    invitedBy:         input.invitedBy,
    email:             input.toEmail,
    temporaryPassword: input.temporaryPassword,
    signInUrl:         input.signInUrl,
    validDays:         input.validDays,
  }))
}
