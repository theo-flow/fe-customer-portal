import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { isEolYears, type EolYears } from '@/lib/gate-keep-eol'

// The end-of-life period an organisation has agreed with TheoFlow, or null if none has been
// agreed (then its files are never expired). Recorded on the organisation's profile by an
// operator. A read failure throws rather than returning null: quietly treating "could not
// look it up" as "no agreement" would add files that outlive what was agreed.
export async function getOrgRetentionYears(orgId: string): Promise<EolYears | null> {
  const res = await ddbDocClient().send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `ORG#${orgId}`, SK: 'PROFILE' },
    ProjectionExpression: 'retention_years',
  }))
  const years = res.Item?.retention_years
  return isEolYears(years) ? years : null
}
