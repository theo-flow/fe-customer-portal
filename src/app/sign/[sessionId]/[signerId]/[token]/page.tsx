import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { hashToken, type SignSession } from '@/lib/sign'
import SignCapture from './SignCapture'

async function getSession(sessionId: string): Promise<SignSession | null> {
  const result = await ddbDocClient().send(new GetCommand({
    TableName: TABLE,
    Key:       { PK: `SESSION#${sessionId}`, SK: 'SESSION' },
  }))
  return (result.Item as SignSession) ?? null
}

function InvalidLink({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-xs">
        <div className="w-14 h-14 rounded-2xl bg-gray-200 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24"
               stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
          </svg>
        </div>
        <h1 className="text-[18px] font-semibold text-black mb-2">{title}</h1>
        <p className="text-[13px] text-gray-500">{message}</p>
      </div>
    </div>
  )
}

export default async function SignPage({
  params,
}: {
  params: { sessionId: string; signerId: string; token: string }
}) {
  const { sessionId, signerId, token } = params
  const session = await getSession(sessionId)

  if (!session) {
    return <InvalidLink title="Signing link not found"
                         message="This signing link is no longer valid." />
  }

  const signer = session.signers.find(s => s.signer_id === signerId)
  if (!signer || signer.token_hash !== hashToken(token)) {
    return <InvalidLink title="Signing link not found"
                         message="This signing link is no longer valid." />
  }
  if (signer.token_used || new Date(signer.token_expires_at) < new Date()) {
    return <InvalidLink title="Link expired"
                         message="This signing link has expired or has already been used." />
  }
  if (session.status === 'CANCELLED' || session.status === 'EXPIRED' || session.status === 'FAILED') {
    return <InvalidLink title="Signing session unavailable"
                         message="This document is no longer available for signature." />
  }
  if (signer.status === 'SIGNED') {
    return <InvalidLink title="Already signed"
                         message="You have already signed this document. Thank you." />
  }

  const filename = session.source_document.s3_key.split('/').pop() ?? 'document.pdf'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-black/[0.06] px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                    d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.83a4 4 0 01-1.414.94l-3.114 1.04 1.04-3.114a4 4 0 01.94-1.414z"/>
            </svg>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-black leading-none">TheoFlow Sign</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Powered by TheoFlow</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-black/[0.08] shadow-sm px-6 py-7">
          <h1 className="text-[20px] font-semibold text-black mb-1">Signature requested</h1>
          <p className="text-[13px] text-gray-400 mb-1">
            {signer.name}, you've been asked to sign <span className="font-medium text-black">{filename}</span>.
          </p>
          <p className="text-[13px] text-gray-400 mb-7">
            Draw or type your signature below, then submit.
          </p>

          <SignCapture sessionId={sessionId} signerId={signerId} token={token} />
        </div>

        <p className="text-center text-[11px] text-gray-300 mt-6">
          Secured by TheoFlow · Data processed in South Africa
        </p>
      </div>
    </div>
  )
}
