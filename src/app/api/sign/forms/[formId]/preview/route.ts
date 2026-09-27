import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { s3Client, SIGN_BUCKET } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { isSafeId, loadCurrentForm } from '@/lib/sign-forms-server'

const SAMPLE_URL_SECONDS = 900

// A saved Sign form for its preview page: the current version's layout and a
// short-lived link to its saved PDF. Read only, for any form the organisation
// has, whether or not it has been sent before.
export async function GET(_req: NextRequest, { params }: { params: { formId: string } }) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { formId } = params
  if (!isSafeId(formId)) return NextResponse.json({ error: 'Invalid form' }, { status: 400 })

  try {
    const current = await loadCurrentForm(orgId, formId)
    if (!current) return NextResponse.json({ error: 'Form not found' }, { status: 404 })
    const { version } = current
    const sampleUrl = await getSignedUrl(
      s3Client(),
      new GetObjectCommand({ Bucket: SIGN_BUCKET, Key: version.sample_key as string }),
      { expiresIn: SAMPLE_URL_SECONDS },
    )
    return NextResponse.json({
      formId,
      version: version.version,
      sampleUrl,
      layout: {
        name: version.name, page_count: version.page_count, page_width: version.page_width, page_height: version.page_height,
        roles: version.roles, fields: version.fields ?? [], anchors: [], role_defaults: [],
        standard_document: version.standard_document === true,
      },
    })
  } catch (err) {
    console.error('[sign/forms/:id/preview] Load failed', { orgId, formId, error: err })
    return NextResponse.json({ error: 'Failed to load the form' }, { status: 500 })
  }
}
