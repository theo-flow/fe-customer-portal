/**
 * Every email the portal sends is defined here, and only here.
 *
 * Add a template by writing a function that returns { subject, text, html } and
 * building it on renderEmail, so all mail shares one look. Callers (the routes
 * and notify-queue.ts) pass plain values; every value is HTML-escaped here, so
 * a caller must never pre-escape or build markup itself.
 *
 * Copy rule: single hyphens only, never an em dash or a double dash.
 *
 * Auth emails sent by Cognito itself (verification codes, password reset) are
 * rendered by fn-15-cognito-custom-message, which shares this palette.
 */

const INK      = '#16160F'
const INK_SOFT = '#5B5A50'
const BORDER   = '#E6E4DC'
const SURFACE  = '#F3F2ED'

export const DEFAULT_LOGO_URL = 'https://theoflow.bytheodore.co.za/email-logo.png'
export const DEFAULT_APP_URL  = 'https://theoflow.bytheodore.co.za'

export interface RenderedEmail {
  subject: string
  text:    string
  html:    string
}

export function escapeHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface ShellInput {
  logoUrl?:  string
  logoAlt?:  string
  heading:   string
  greeting?: string
  /** Plain-text paragraphs, escaped here. */
  paragraphs: string[]
  button?:   { label: string; url: string }
  /** A value shown large in a box, e.g. a temporary password. */
  code?:     { label: string; value: string }
  note?:     string
}

function renderEmail(i: ShellInput): string {
  const logo = i.logoUrl
    ? `
    <div style="padding:28px 32px 0;">
      <img src="${escapeHtml(i.logoUrl)}" alt="${escapeHtml(i.logoAlt ?? 'TheoFlow')}" width="40" height="40" style="display:block;border-radius:9px;">
    </div>`
    : ''

  const greeting = i.greeting
    ? `<p style="margin:0 0 4px;font-size:14px;color:${INK};">${escapeHtml(i.greeting)}</p>`
    : ''

  const paragraphs = i.paragraphs
    .map(p => `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${INK_SOFT};">${escapeHtml(p)}</p>`)
    .join('\n      ')

  const code = i.code
    ? `<p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${INK_SOFT};">${escapeHtml(i.code.label)}</p>
      <div style="background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;padding:16px 20px;margin-bottom:24px;">
        <span style="font-family:ui-monospace,'SF Mono',Consolas,monospace;font-size:22px;font-weight:600;letter-spacing:0.06em;color:${INK};">${escapeHtml(i.code.value)}</span>
      </div>`
    : ''

  const button = i.button
    ? `<a href="${escapeHtml(i.button.url)}"
         style="display:inline-block;background:${INK};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:14px 28px;border-radius:12px;">
        ${escapeHtml(i.button.label)}
      </a>`
    : ''

  const note = i.note
    ? `<p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:${INK_SOFT};">${escapeHtml(i.note)}</p>`
    : ''

  return `<div style="background:${SURFACE};padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:440px;margin:0 auto;background:#FFFFFF;border:1px solid ${BORDER};border-radius:18px;overflow:hidden;">${logo}
    <div style="padding:20px 32px 32px;">
      <h1 style="margin:0 0 16px;font-family:Georgia,'Iowan Old Style',serif;font-size:22px;font-weight:500;color:${INK};">
        ${escapeHtml(i.heading)}
      </h1>
      ${greeting}
      ${paragraphs}
      ${code}
      ${button}
      ${note}
      <div style="margin-top:28px;padding-top:20px;border-top:1px solid ${BORDER};">
        <p style="margin:0;font-size:12.5px;line-height:1.6;color:${INK_SOFT};">
          TheoFlow turns paperwork into structured, actionable data - built for teams
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

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** A person is asked to fill in a form. Carries the sending organisation's logo. */
export function recipientInviteEmail(args: {
  orgLabel: string; logoUrl: string; recipientName: string; groupLabel: string; fillUrl: string
}): RenderedEmail {
  const { orgLabel, logoUrl, recipientName, groupLabel, fillUrl } = args
  return {
    subject: `${orgLabel}: please fill in "${groupLabel}"`,
    text:
      `Hi ${recipientName},\n\n` +
      `${orgLabel} has asked you to fill in the form "${groupLabel}".\n\n` +
      `${fillUrl}\n\n` +
      `This link is unique to you - please don't forward it.`,
    html: renderEmail({
      logoUrl,
      logoAlt:    orgLabel,
      heading:    "You've been asked to fill in a form",
      greeting:   `Hi ${recipientName},`,
      paragraphs: [`${orgLabel} has asked you to fill in the form "${groupLabel}". Click below to open it - it only takes a few minutes.`],
      button:     { label: `Open "${groupLabel}"`, url: fillUrl },
      note:       "This link is unique to you - please don't forward it.",
    }),
  }
}

/** Tells the agent who sent a personal form link that the recipient replied. */
export function submissionReplyEmail(args: {
  recipientName: string; groupLabel: string; submissionUrl: string
}): RenderedEmail {
  const { recipientName, groupLabel, submissionUrl } = args
  return {
    subject: `${recipientName} filled in "${groupLabel}"`,
    text:
      `${recipientName} has filled in the form "${groupLabel}" you sent.\n\n` +
      `View the submission: ${submissionUrl}`,
    html: renderEmail({
      heading:    `${recipientName} replied`,
      paragraphs: [`${recipientName} has filled in the form "${groupLabel}" you sent.`],
      button:     { label: 'View submission', url: submissionUrl },
    }),
  }
}

/**
 * An admin invites someone to join their organisation as an agent. Sent with
 * the TheoFlow logo because it is a TheoFlow account email, not the
 * organisation's own correspondence.
 */
export function teamInviteEmail(args: {
  inviteeName: string; orgName: string; invitedBy: string; email: string
  temporaryPassword: string; signInUrl: string; validDays: number
}): RenderedEmail {
  const { inviteeName, orgName, invitedBy, email, temporaryPassword, signInUrl, validDays } = args
  return {
    subject: `${invitedBy} invited you to join ${orgName} on TheoFlow`,
    text:
      `Hi ${inviteeName},\n\n` +
      `${invitedBy} has invited you to join ${orgName} on TheoFlow as an agent.\n\n` +
      `Sign in with your email (${email}) and this temporary password:\n${temporaryPassword}\n\n` +
      `You will be asked to choose your own password straight away.\n` +
      `Sign in: ${signInUrl}\n\n` +
      `The temporary password works for ${validDays} days.`,
    html: renderEmail({
      logoUrl:    DEFAULT_LOGO_URL,
      heading:    `Join ${orgName} on TheoFlow`,
      greeting:   `Hi ${inviteeName},`,
      paragraphs: [
        `${invitedBy} has invited you to join ${orgName} on TheoFlow as an agent. Sign in with ${email} and the temporary password below. You will be asked to choose your own password straight away.`,
      ],
      code:       { label: 'Temporary password', value: temporaryPassword },
      button:     { label: 'Sign in to TheoFlow', url: signInUrl },
      note:       `The temporary password works for ${validDays} days. If you were not expecting this invitation, you can ignore this email.`,
    }),
  }
}
