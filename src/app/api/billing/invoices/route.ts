import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, s3Client, TABLE, OUTPUT_BUCKET } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'

const URL_EXPIRY_SECONDS = 300

// Read-only invoice history for the signed-in org. "Mark paid" is
// deliberately not exposed here -- see plan Phase 2 notes: a self-service
// mark-paid action reachable from the org's own session would let a
// customer self-attest payment without anyone confirming the EFT landed.
export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = ddbDocClient()

  const result = await db.send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
    FilterExpression:          'org_id = :orgId',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'INVOICE#', ':orgId': orgId },
    ScanIndexForward:          false, // newest period first
  })).catch(err => {
    console.error('[billing/invoices] Invoice query failed', { orgId, error: err })
    return { Items: [] }
  })

  const items = await Promise.all((result.Items ?? []).map(async (item) => {
    let downloadUrl: string | null = null
    if (item.pdf_s3_key) {
      downloadUrl = await getSignedUrl(
        s3Client(),
        new GetObjectCommand({ Bucket: OUTPUT_BUCKET, Key: item.pdf_s3_key }),
        { expiresIn: URL_EXPIRY_SECONDS },
      ).catch(err => {
        console.error('[billing/invoices] Presign failed', { orgId, key: item.pdf_s3_key, error: err })
        return null
      })
    }

    return {
      period:            item.period            as string,
      planId:            item.plan_id            as string,
      docsIncluded:      item.docs_included       as number,
      docsUsed:          item.docs_used           as number,
      overageDocs:        item.overage_docs        as number,
      baseAmountZar:      Number(item.base_amount_zar),
      overageAmountZar:   Number(item.overage_amount_zar),
      totalAmountZar:     Number(item.total_amount_zar),
      currency:          (item.currency ?? 'ZAR') as string,
      status:            item.status             as string,
      createdAt:         item.created_at          as string,
      paidAt:            item.paid_at ?? null,
      downloadUrl,
    }
  }))

  return NextResponse.json({ items })
}
