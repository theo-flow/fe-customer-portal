import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { ddbDocClient, TABLE } from '@/lib/aws'
import type { JwtClaims } from '@/lib/token'
import { roleOf, type Role } from '@/lib/roles'
import { orgAccess, type AccessState } from '@/lib/org-access'
import { computeSeatCharge, docsIncludedFor, priceOfSeat } from '@/lib/seat-pricing'

export type MemberStatus = 'active' | 'invited' | 'removed'

// Listing item, ORG#{orgId} / MEMBER#{sub}. The authoritative record fn-21
// reads (USER#{sub} / ORG_MEMBERSHIP) can't be queried by org, so this mirrors
// it for the Team page. fn-21's IAM is limited to USER#* keys, which is why
// the portal, not fn-21, writes this one.
export interface Member {
  sub:       string
  email:     string
  name:      string
  role:      Role
  status:    MemberStatus
  invitedBy: string | null
  createdAt: string
}

export const memberKey     = (orgId: string, sub: string) => ({ PK: `ORG#${orgId}`, SK: `MEMBER#${sub}` })
export const membershipKey = (sub: string) => ({ PK: `USER#${sub}`, SK: 'ORG_MEMBERSHIP' })

function toMember(item: Record<string, unknown>): Member {
  return {
    sub:       item.sub       as string,
    email:     item.email     as string,
    name:      (item.name     as string) ?? '',
    role:      item.role === 'admin' ? 'admin' : 'agent',
    status:    (item.status   as MemberStatus) ?? 'active',
    invitedBy: (item.invitedBy as string) ?? null,
    createdAt: item.createdAt as string,
  }
}

/**
 * Members of an org, including the caller. fn-21 does not write the listing
 * item, so an org's original admin has none until they first open Team; this
 * creates it, otherwise the admin would not count toward the seat cap.
 */
export async function loadTeam(orgId: string, caller: JwtClaims): Promise<Member[]> {
  const db = ddbDocClient()
  const result = await db.send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':prefix': 'MEMBER#' },
  }))
  const members = (result.Items ?? []).map(toMember)

  if (!members.some(m => m.sub === caller.sub)) {
    const self: Member = {
      sub:       caller.sub,
      email:     caller.email,
      name:      caller.name ?? '',
      role:      roleOf(caller),
      status:    'active',
      invitedBy: null,
      createdAt: new Date().toISOString(),
    }
    await db.send(new PutCommand({
      TableName:           TABLE,
      Item:                { ...memberKey(orgId, self.sub), ...self },
      ConditionExpression: 'attribute_not_exists(PK)',
    })).catch(err => {
      if (err?.name !== 'ConditionalCheckFailedException') throw err
    })
    members.push(self)
  }

  return members.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

// Removed members free their seat; invited ones hold it until removed.
export const seatsUsed = (members: Member[]) => members.filter(m => m.status !== 'removed').length

export interface SeatAllowance {
  state:             AccessState
  planName:          string
  totalSeats:        number   // people the org may have right now
  canChangeSeats:    boolean  // on the paid plan; a pilot has one seat and starts the paid plan instead
  monthlyTotalZar:   number   // what its seats cost a month
  nextSeatPriceZar:  number   // what one more seat would add
  docsIncluded:      number
  trialEndsAt:       string | null
  daysLeft:          number | null
}

// How many people an org may have. A pilot has one seat (the admin's); the paid
// plan has however many seats the org set, priced by position.
export async function seatAllowance(orgId: string): Promise<SeatAllowance> {
  const access = await orgAccess(orgId)
  const paid   = access.state === 'active'
  const seats  = paid ? access.seats : 1

  return {
    state:            access.state,
    planName:         paid ? 'Starter' : 'Pilot',
    totalSeats:       seats,
    canChangeSeats:   paid,
    monthlyTotalZar:  paid ? computeSeatCharge(seats).totalZar : 0,
    nextSeatPriceZar: priceOfSeat(seats + 1),
    docsIncluded:     paid ? docsIncludedFor(seats) : 0,
    trialEndsAt:      access.trialEndsAt,
    daysLeft:         access.daysLeft,
  }
}
