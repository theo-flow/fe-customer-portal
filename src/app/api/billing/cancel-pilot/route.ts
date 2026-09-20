import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { forbiddenUnlessAdmin } from '@/lib/roles'

// Cancels a running pilot, so it is not converted and invoiced on day 8. Admin
// only. The org is locked: its data is kept, sign-in and Billing still work, and
// it can start the paid plan again at any time. A pilot that has already
// converted cannot be cancelled here, because the condition checks the trial is
// still running.
export async function POST() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = forbiddenUnlessAdmin(claims)
  if (denied) return denied

  try {
    await ddbDocClient().send(new UpdateCommand({
      TableName:                 TABLE,
      Key:                       { PK: `ORG#${orgId}`, SK: 'PROFILE' },
      UpdateExpression:          'SET trial_status = :cancelled',
      ConditionExpression:       'trial_status = :active',
      ExpressionAttributeValues: { ':cancelled': 'cancelled', ':active': 'active' },
    }))
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      return NextResponse.json({ error: 'Only a running pilot can be cancelled.' }, { status: 409 })
    }
    console.error('[billing/cancel-pilot] Failed', { orgId, error: err })
    return NextResponse.json({ error: 'Could not cancel. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
