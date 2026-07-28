import { PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { randomUUID } from 'crypto'
import { eventBridgeClient } from '@/lib/aws'

const HUB_EVENT_BUS_NAME = process.env.HUB_EVENT_BUS_NAME ?? 'daai-insure-hub'
const EVENT_SOURCE = 'theoflow.platform'

/**
 * TypeScript counterpart to shared/events/publisher.py -- the portal is
 * itself an Integration Hub event producer (same as fn-06/fn-07/fn-13 will
 * be), publishing directly via EventBridge rather than importing any
 * external-system SDK. This is the one place the portal is allowed to name
 * a business event; it never calls a connector directly (that's fn-19/fn-20's
 * job, kept behind the Hub boundary per CLAUDE.md's connector-layer rule).
 * Best-effort: a failed publish must not break the caller's own success
 * path, mirroring src/lib/notify-queue.ts's non-fatal enqueue pattern.
 */
export async function publishBusinessEvent(
  eventType: string,
  orgId: string,
  detail: Record<string, unknown>
): Promise<string | null> {
  const eventId = randomUUID()

  try {
    const result = await eventBridgeClient().send(new PutEventsCommand({
      Entries: [{
        Source: EVENT_SOURCE,
        DetailType: eventType,
        EventBusName: HUB_EVENT_BUS_NAME,
        Detail: JSON.stringify({ event_id: eventId, org_id: orgId, ...detail }),
      }],
    }))

    if ((result.FailedEntryCount ?? 0) > 0) {
      console.error('[hub-events] PutEvents entry failed', { eventType, orgId, entries: result.Entries })
      return null
    }
    return eventId
  } catch (err) {
    console.error('[hub-events] Failed to publish business event', { eventType, orgId, error: err })
    return null
  }
}
