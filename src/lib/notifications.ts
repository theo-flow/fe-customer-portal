import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'
import { ddbDocClient, TABLE } from '@/lib/aws'

// 'IN_PROGRESS' exists for forward-compatibility (e.g. a future async/email
// leg) -- Harvest's submit path is fully synchronous today, so every
// notification this writes lands directly on DONE or ERROR. See
// docs/PROJECT_PLAN.md-adjacent plan notes for why this isn't a fake
// progress state.
export type NotificationStatus = 'IN_PROGRESS' | 'DONE' | 'ERROR'

export interface NotificationItem {
  notificationId: string
  type:           'harvest_submission'
  submissionId:   string
  group:          string
  groupLabel:     string
  message:        string
  status:         NotificationStatus
  read:           boolean
  createdAt:      string
  // Set when the submission came from a personal link: only the agent who
  // sent it (Cognito sub) sees it. Absent = visible to the whole org.
  targetSub?:     string | null
}

/**
 * Best-effort: a notification failing to write must never block or fail the
 * submission it's about, so this never throws. Callers should still `await`
 * it (on Lambda, an un-awaited promise can be frozen before it completes).
 */
export async function notifyHarvestSubmission(orgId: string, params: {
  submissionId:   string
  group:          string
  groupLabel:     string
  targetSub?:     string | null
  recipientName?: string | null
}): Promise<void> {
  const createdAt      = new Date().toISOString()
  const notificationId = randomUUID()
  const item: Omit<NotificationItem, 'status' | 'targetSub'> & { PK: string; SK: string; target_sub?: string } = {
    PK:            `ORG#${orgId}`,
    SK:            `NOTIFICATION#${createdAt}#${notificationId}`,
    notificationId,
    type:          'harvest_submission',
    submissionId:  params.submissionId,
    group:         params.group,
    groupLabel:    params.groupLabel,
    message:       params.recipientName
      ? `${params.recipientName} filled in ${params.groupLabel}`
      : `New submission received for ${params.groupLabel}`,
    read:          false,
    createdAt,
    ...(params.targetSub ? { target_sub: params.targetSub } : {}),
  }

  try {
    await ddbDocClient().send(new PutCommand({
      TableName: TABLE,
      Item: { ...item, status: 'DONE' satisfies NotificationStatus },
    }))
  } catch (err) {
    console.error('Failed to write Harvest submission notification', err)
    try {
      await ddbDocClient().send(new PutCommand({
        TableName: TABLE,
        Item: { ...item, status: 'ERROR' satisfies NotificationStatus },
      }))
    } catch (fallbackErr) {
      console.error('Fallback ERROR-status notification write also failed', fallbackErr)
    }
  }
}
