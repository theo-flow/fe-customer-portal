import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'

// The forms this organisation can send: only ones the operator has finished
// setting up (every role signs somewhere). Everything the send screen needs to
// recognise an upload is on the pointer record, so this is one query. The
// org comes from the verified token, never from the request.
export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const res = await ddbDocClient().send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'SIGNFORM#' },
    }))
    const forms = (res.Items ?? [])
      .filter(i => i.form_status !== 'ARCHIVED' && i.valid === true)
      .map(i => ({
        formId:         i.form_id as string,
        name:           i.name as string,
        currentVersion: i.current_version as number,
        pageCount:      i.page_count as number,
        pageWidth:      i.page_width as number,
        pageHeight:     i.page_height as number,
        roles:          (i.roles as string[]) ?? [],
        anchors:        (i.anchors as { page: number; text: string }[]) ?? [],
        reads:          (i.read_boxes as unknown[]) ?? [],
        roleDefaults:   (i.role_defaults as unknown[]) ?? [],
        standardDocument: i.standard_document === true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ forms })
  } catch (err) {
    console.error('[sign/forms] List failed', { orgId, error: err })
    return NextResponse.json({ error: 'Failed to load forms' }, { status: 500 })
  }
}
