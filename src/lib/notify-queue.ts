import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { sqsClient } from '@/lib/aws'

const SQS_NOTIFY_URL = process.env.SQS_NOTIFY_URL

interface RecipientInviteInput {
  correlationId: string
  toEmail:       string
  recipientName: string
  orgName:       string | null
  logoUrl:       string
  groupLabel:    string
  fillUrl:       string
}

// Same palette/shell as fn-15-cognito-custom-message's _render_email --
// every branded email on the platform (auth codes, this invite) should
// look like it came from the same product, not two different senders.
const INK      = '#16160F'
const INK_SOFT = '#5B5A50'
const BORDER   = '#E6E4DC'

/**
 * Best-effort enqueue onto the same `notify` queue fn-06/fn-13/fn-18 already
 * feed -- fn-17-notify-sender is the queue's one consumer, and this reuses it
 * rather than adding a fourth notification mechanism to the platform. Never
 * throws: callers must treat a failed enqueue as non-fatal (the caller's own
 * manual copy-link UI is the fallback), mirroring the same pattern already
 * used in src/app/api/sign/sessions/route.ts for locate_and_notify.
 */
export async function enqueueRecipientInviteEmail(input: RecipientInviteInput): Promise<boolean> {
  if (!SQS_NOTIFY_URL) {
    console.error('[notify-queue] SQS_NOTIFY_URL not configured -- recipient_invite not queued', {
      correlationId: input.correlationId,
    })
    return false
  }

  const orgLabel = input.orgName ?? 'TheoFlow'
  const subject  = `${orgLabel}: please fill in "${input.groupLabel}"`
  const bodyText =
    `Hi ${input.recipientName},\n\n` +
    `${orgLabel} has asked you to fill in the form "${input.groupLabel}".\n\n` +
    `${input.fillUrl}\n\n` +
    `This link is unique to you -- please don't forward it.`

  try {
    await sqsClient().send(new SendMessageCommand({
      QueueUrl: SQS_NOTIFY_URL,
      MessageBody: JSON.stringify({
        correlation_id: input.correlationId,
        notification_type: 'recipient_invite',
        to_email: input.toEmail,
        subject,
        body_text: bodyText,
        html_body: _renderInviteEmail({
          orgLabel,
          logoUrl: input.logoUrl,
          recipientName: input.recipientName,
          groupLabel: input.groupLabel,
          fillUrl: input.fillUrl,
        }),
      }),
    }))
    return true
  } catch (err) {
    console.error('[notify-queue] Failed to enqueue recipient_invite', {
      correlationId: input.correlationId, error: err,
    })
    return false
  }
}

function _renderInviteEmail(args: {
  orgLabel: string; logoUrl: string; recipientName: string; groupLabel: string; fillUrl: string
}): string {
  const { orgLabel, logoUrl, recipientName, groupLabel, fillUrl } = args

  return `\
<div style="background:#F3F2ED;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:440px;margin:0 auto;background:#FFFFFF;border:1px solid ${BORDER};border-radius:18px;overflow:hidden;">

    <div style="padding:28px 32px 0;">
      <img src="${logoUrl}" alt="${orgLabel}" width="40" height="40" style="display:block;border-radius:9px;">
    </div>

    <div style="padding:20px 32px 32px;">
      <h1 style="margin:0 0 16px;font-family:Georgia,'Iowan Old Style',serif;font-size:22px;font-weight:500;color:${INK};">
        You've been asked to fill in a form
      </h1>
      <p style="margin:0 0 4px;font-size:14px;color:${INK};">Hi ${recipientName},</p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:${INK_SOFT};">
        ${orgLabel} has asked you to fill in the form "${groupLabel}". Click below to open it --
        it only takes a few minutes.
      </p>

      <a href="${fillUrl}"
         style="display:inline-block;background:${INK};color:#FFFFFF;text-decoration:none;
                font-size:14px;font-weight:600;padding:14px 28px;border-radius:12px;">
        Open &ldquo;${groupLabel}&rdquo;
      </a>
      <p style="margin:12px 0 0;font-size:12px;color:${INK_SOFT};">
        This link is unique to you -- please don't forward it.
      </p>

      <div style="margin-top:28px;padding-top:20px;border-top:1px solid ${BORDER};">
        <p style="margin:0;font-size:12.5px;line-height:1.6;color:${INK_SOFT};">
          TheoFlow turns paperwork into structured, actionable data — built for teams
          who'd rather ship than shuffle PDFs.
        </p>
      </div>
    </div>
  </div>

  <p style="max-width:440px;margin:20px auto 0;text-align:center;font-size:11px;color:#9C9A8C;">
    Secured by TheoFlow · Data processed in South Africa · POPIA compliant
  </p>
</div>`
}
