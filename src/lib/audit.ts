import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { roleOf } from '@/lib/roles'
import type { JwtClaims } from '@/lib/token'
import type { AuditAction } from '@/lib/audit-labels'

export type { AuditAction, AuditEntry } from '@/lib/audit-labels'
export { AUDIT_LABELS } from '@/lib/audit-labels'

const TARGET_MAX = 200

/**
 * Records one action against the org, attributed to the signed-in user (their id,
 * email and role come from the verified token, never from the request).
 *
 * Best effort, like the notification writer: a failure to record must never fail or
 * slow down the action it describes, so this never throws. Callers still `await` it
 * (on Lambda an un-awaited promise can be frozen before it finishes).
 */
export async function writeAudit(
  orgId: string, actor: JwtClaims, action: AuditAction, target?: string | null,
): Promise<void> {
  const at      = new Date().toISOString()
  const auditId = randomUUID()
  try {
    await ddbDocClient().send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK:         `ORG#${orgId}`,
        SK:         `AUDIT#${at}#${auditId}`,
        auditId,
        at,
        actorSub:   actor.sub,
        actorEmail: actor.email,
        actorRole:  roleOf(actor),
        action,
        target:     target ? String(target).slice(0, TARGET_MAX) : null,
      },
    }))
  } catch (err) {
    console.error('[audit] Failed to record action', { orgId, action, error: err })
  }
}
