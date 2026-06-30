import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { ddbDocClient, TABLE } from '@/lib/aws'
import FillForm from './FillForm'

interface Field {
  key:        string
  label:      string
  field_type: string
  required:   boolean
  options:    string[] | null
}

async function getSchema(orgId: string, group: string) {
  const result = await ddbDocClient().send(new GetCommand({
    TableName: TABLE,
    Key:       { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}` },
  }))
  return result.Item ?? null
}

export default async function FillPage({
  params,
}: {
  params: { orgId: string; group: string }
}) {
  const { orgId, group } = params
  const schema = await getSchema(orgId, group)

  if (!schema || schema.status !== 'READY') {
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
          <h1 className="text-[18px] font-semibold text-black mb-2">Form not available</h1>
          <p className="text-[13px] text-gray-500">
            This form is not currently accepting submissions.
          </p>
        </div>
      </div>
    )
  }

  const groupLabel = schema.group_label as string
  const fields     = (schema.fields as Field[]) ?? []

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header bar */}
      <div className="bg-white border-b border-black/[0.06] px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
                       a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z"/>
            </svg>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-black leading-none">{groupLabel}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Powered by TheoFlow</p>
          </div>
        </div>
      </div>

      {/* Form body */}
      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-black/[0.08] shadow-sm px-6 py-7">
          <h1 className="text-[20px] font-semibold text-black mb-1">{groupLabel}</h1>
          <p className="text-[13px] text-gray-400 mb-7">
            Please fill in all required fields and submit the form.
          </p>

          {fields.length === 0 ? (
            <p className="text-[13px] text-gray-400">No fields found in this form.</p>
          ) : (
            <FillForm
              orgId={orgId}
              group={group}
              groupLabel={groupLabel}
              fields={fields}
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
