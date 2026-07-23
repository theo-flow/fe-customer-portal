import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { hashToken } from '@/lib/sign'
import FillForm from '../../FillForm'
import type { Field } from '@/components/FieldInput'
import type { RecipientLink } from '@/lib/recipients'

interface Branding {
  source:       string
  logo_s3_key?:  string
  company_name?: string | null
  slogan?:       string | null
  brand_color?:  string | null
}

function Unavailable({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-xs">
        <div className="w-14 h-14 rounded-2xl bg-gray-200 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24"
               stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
                     a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z"/>
          </svg>
        </div>
        <h1 className="text-[18px] font-semibold text-black mb-2">{title}</h1>
        <p className="text-[13px] text-gray-500">{message}</p>
      </div>
    </div>
  )
}

export default async function RecipientFillPage({
  params,
}: {
  params: { orgId: string; group: string; recipientId: string; token: string }
}) {
  const { orgId, group, recipientId, token } = params
  const db = ddbDocClient()

  const [schemaResult, recipientResult] = await Promise.all([
    db.send(new GetCommand({ TableName: TABLE, Key: { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}` } })),
    db.send(new GetCommand({ TableName: TABLE, Key: { PK: `ORG#${orgId}`, SK: `RECIPIENT#${group}#${recipientId}` } })),
  ])

  const schema    = schemaResult.Item
  const recipient = recipientResult.Item as RecipientLink | undefined

  if (!recipient) {
    return <Unavailable title="Link not found" message="This form link doesn't exist or has been removed." />
  }
  if (recipient.token_hash !== hashToken(token)) {
    return <Unavailable title="Link not found" message="This form link doesn't exist or has been removed." />
  }
  if (new Date(recipient.token_expires_at) < new Date()) {
    return <Unavailable title="Link expired" message="This form link has expired. Please ask for a new one." />
  }
  if (recipient.status === 'SUBMITTED') {
    return <Unavailable title="Already submitted" message="This form has already been filled in and submitted." />
  }
  if (!schema || schema.status !== 'READY') {
    return <Unavailable title="Form not available" message="This form is not currently accepting submissions." />
  }

  const groupLabel = schema.group_label as string
  const fields      = (schema.fields as Field[]) ?? []
  const branding    = schema.branding as Branding | undefined
  const hasLogo     = branding?.source === 'extracted' && branding.logo_s3_key
  const brandColor  = branding?.brand_color ?? null
  const logoUrl     = hasLogo
    ? `/api/public/branding/${orgId}/${group}/${schema.published_version}`
    : null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-black/[0.06] px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={branding?.company_name ?? groupLabel}
                 className="h-8 max-w-[120px] object-contain rounded"/>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24"
                   stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
                         a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z"/>
              </svg>
            </div>
          )}
          <div>
            <p className="text-[13px] font-semibold text-black leading-none">
              {branding?.company_name || groupLabel}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {branding?.slogan || 'Powered by TheoFlow'}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-black/[0.08] shadow-sm px-6 py-7"
             style={brandColor ? { borderTopWidth: '3px', borderTopColor: brandColor } : undefined}>
          <h1 className="text-[20px] font-semibold text-black mb-1">{groupLabel}</h1>
          <p className="text-[13px] text-gray-400 mb-7">
            Hi {recipient.name} — please fill in all required fields and submit the form.
          </p>

          {fields.length === 0 ? (
            <p className="text-[13px] text-gray-400">No fields found in this form.</p>
          ) : (
            <FillForm
              orgId={orgId}
              group={group}
              groupLabel={groupLabel}
              fields={fields}
              brandColor={brandColor}
              recipientId={recipientId}
              recipientToken={token}
            />
          )}
        </div>

        <p className="text-center text-[11px] text-gray-300 mt-6">
          Secured by TheoFlow · Data processed in South Africa
        </p>
      </div>
    </div>
  )
}
