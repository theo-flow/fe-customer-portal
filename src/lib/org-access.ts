import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { ALL_PRODUCTS } from '@/lib/plans'

// What an org may do right now:
//   trial   in its free pilot. Every product, one seat.
//   active  on the paid plan (or being moved onto it). Every product.
//   locked  its pilot was cancelled, or its subscription was. Products are blocked;
//           sign-in, Billing and the data it already has stay reachable.
export type AccessState = 'trial' | 'active' | 'locked'

export interface OrgAccess {
  state:           AccessState
  trialStatus:     string | null
  trialEndsAt:     string | null
  daysLeft:        number | null   // whole days left in a running pilot, else null
  seats:           number
  hasSubscription: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

type Item = Record<string, unknown> | undefined

// Pure so the rules can be tested without a database.
//
// A pilot that has passed its end date stays usable until fn-16's daily run
// converts it (at most a day). That run is therefore revenue-critical and must
// alarm on failure, or a pilot would quietly stay free.
export function computeAccess(profile: Item, subscription: Item, now: Date = new Date()): OrgAccess {
  const trialStatus = (profile?.trial_status as string | undefined) ?? null
  const trialEndsAt = (profile?.trial_ends_at as string | undefined) ?? null
  const seatsRaw    = Number(profile?.seats)
  const seats       = Number.isInteger(seatsRaw) && seatsRaw >= 1 ? seatsRaw : 1

  const subStatus       = subscription?.status as string | undefined
  const hasSubscription = Boolean(subscription)

  let state: AccessState
  if (subStatus === 'cancelled')                             state = 'locked'
  else if (subStatus)                                        state = 'active'
  else if (trialStatus === 'cancelled')                      state = 'locked'
  else if (trialStatus === 'converted' || trialStatus === 'converting') state = 'active'
  else                                                       state = 'trial'   // active, or predates trials

  const daysLeft = state === 'trial' && trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / DAY_MS))
    : null

  return { state, trialStatus, trialEndsAt, daysLeft, seats, hasSubscription }
}

export async function orgAccess(orgId: string): Promise<OrgAccess> {
  const db = ddbDocClient()
  const [profile, subscription] = await Promise.all([
    db.send(new GetCommand({
      TableName: TABLE, Key: { PK: `ORG#${orgId}`, SK: 'PROFILE' },
      ProjectionExpression: 'trial_status, trial_ends_at, seats',
    })),
    db.send(new GetCommand({
      TableName: TABLE, Key: { PK: `ORG#${orgId}`, SK: 'SUBSCRIPTION' },
      ProjectionExpression: '#s',
      ExpressionAttributeNames: { '#s': 'status' },
    })),
  ])
  return computeAccess(profile.Item, subscription.Item)
}

/** The products an org may use: all of them, unless it is locked. */
export const productsFor = (access: Pick<OrgAccess, 'state'>): string[] =>
  access.state === 'locked' ? [] : [...ALL_PRODUCTS]

/**
 * For routes that start work. Returns a 403 to send back when the org is locked,
 * else null:  `const locked = await orgLocked(orgId); if (locked) return locked`
 */
export async function orgLocked(orgId: string): Promise<NextResponse | null> {
  const { state } = await orgAccess(orgId)
  if (state !== 'locked') return null
  return NextResponse.json(
    { error: 'Your pilot has ended. Start the paid plan in Billing to keep working.', code: 'org_locked' },
    { status: 403 },
  )
}
