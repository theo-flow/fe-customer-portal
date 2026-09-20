import { describe, it, expect } from 'vitest'
import { recipientInviteEmail, submissionReplyEmail, teamInviteEmail, escapeHtml } from '../email-templates'

const team = {
  inviteeName: 'Jane Agent', orgName: 'Onte Ika', invitedBy: 'Thabo Lutseke', email: 'jane@org.com',
  temporaryPassword: 'Abcd2345Efgh6789', signInUrl: 'https://theoflow.bytheodore.co.za/login', validDays: 7,
}

describe('email templates', () => {
  it('team invite names the organisation and inviter, shows the password, and links to sign in', () => {
    const e = teamInviteEmail(team)
    expect(e.subject).toBe('Thabo Lutseke invited you to join Onte Ika on TheoFlow')
    for (const body of [e.html, e.text]) {
      expect(body).toContain('Onte Ika')
      expect(body).toContain('Thabo Lutseke')
      expect(body).toContain('Abcd2345Efgh6789')
      expect(body).toContain('7 days')
    }
    expect(e.html).toContain('href="https://theoflow.bytheodore.co.za/login"')
    expect(e.html).toContain('email-logo.png')
    expect(e.text).toContain('https://theoflow.bytheodore.co.za/login')
  })

  it('recipient invite carries the organisation logo and the fill link', () => {
    const e = recipientInviteEmail({
      orgLabel: 'Onte Ika', logoUrl: 'https://x.test/logo.png', recipientName: 'Sam', groupLabel: 'Claim form', fillUrl: 'https://x.test/fill',
    })
    expect(e.subject).toBe('Onte Ika: please fill in "Claim form"')
    expect(e.html).toContain('src="https://x.test/logo.png"')
    expect(e.html).toContain('href="https://x.test/fill"')
    expect(e.text).toContain('https://x.test/fill')
  })

  it('submission reply links to the submission', () => {
    const e = submissionReplyEmail({ recipientName: 'Sam', groupLabel: 'Claim form', submissionUrl: 'https://x.test/submissions/1' })
    expect(e.subject).toBe('Sam filled in "Claim form"')
    expect(e.html).toContain('href="https://x.test/submissions/1"')
    expect(e.html).toContain('Sam replied')
  })

  it('escapes every caller value so a name cannot inject markup', () => {
    const bad = '<script>alert(1)</script>"&'
    const e = teamInviteEmail({ ...team, inviteeName: bad, orgName: bad, invitedBy: bad })
    expect(e.html).not.toContain('<script>')
    expect(e.html).toContain(escapeHtml(bad))
  })

  it('never uses an em dash or a double dash in any template', () => {
    const all = [
      teamInviteEmail(team),
      recipientInviteEmail({ orgLabel: 'O', logoUrl: 'https://x.test/l.png', recipientName: 'S', groupLabel: 'G', fillUrl: 'https://x.test/f' }),
      submissionReplyEmail({ recipientName: 'S', groupLabel: 'G', submissionUrl: 'https://x.test/s' }),
    ]
    for (const e of all) {
      for (const part of [e.subject, e.text, e.html]) {
        expect(part).not.toContain('—')
        expect(part).not.toContain('--')
      }
    }
  })
})
