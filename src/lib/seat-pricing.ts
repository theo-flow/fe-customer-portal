/**
 * Per-seat pricing — TypeScript mirror of
 * daai-insure-platform/shared/constants/seat_pricing.py. Keep both in sync by
 * hand; both test suites carry the same cases.
 *
 * A seat is one person on an org's team; the admin takes seat 1. Every seat is
 * priced by its own POSITION, like a tax bracket, so adding a person can never
 * make the bill go down:
 *
 *   seats 1-4   R500 each
 *   seats 5-9   R450 each
 *   seat  10    R400
 *   seat  11+   R350 each
 *
 * Each seat also includes DOCS_PER_SEAT documents a month; beyond the org's
 * total allowance, documents are billed as overage (plans.ts).
 *
 * All amounts in ZAR. Starting pricing, not a validated price list.
 */

// [last seat position in the band, price of each seat in it]. null = no upper limit.
export const SEAT_BANDS: ReadonlyArray<readonly [number | null, number]> = [
  [4, 500],
  [9, 450],
  [10, 400],
  [null, 350],
]

export const DOCS_PER_SEAT = 50

// The most seats one org can set for itself. Bigger teams talk to us.
export const MAX_SEATS = 500

export interface SeatLine {
  seats:        number
  unitPriceZar: number
  subtotalZar:  number
}

export interface SeatCharge {
  seats:    number
  lines:    SeatLine[]
  totalZar: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** What the seat at `position` (1 = the admin's) costs a month. */
export function priceOfSeat(position: number): number {
  if (position < 1) throw new RangeError('seat position starts at 1')
  for (const [last, price] of SEAT_BANDS) {
    if (last === null || position <= last) return price
  }
  throw new Error('unreachable: the last band has no upper limit')
}

/** Monthly charge for `seats` seats, as one line per price band used. */
export function computeSeatCharge(seats: number): SeatCharge {
  if (seats < 0) throw new RangeError('seats cannot be negative')

  const lines: SeatLine[] = []
  let bandStart = 1
  for (const [last, price] of SEAT_BANDS) {
    const bandEnd = last === null ? seats : Math.min(last, seats)
    const count = bandEnd - bandStart + 1
    if (count > 0) lines.push({ seats: count, unitPriceZar: price, subtotalZar: round2(count * price) })
    if (last === null || last >= seats) break
    bandStart = last + 1
  }

  return { seats, lines, totalZar: round2(lines.reduce((sum, l) => sum + l.subtotalZar, 0)) }
}

/** Documents a month the org's seats include between them. */
export const docsIncludedFor = (seats: number) => Math.max(0, seats) * DOCS_PER_SEAT

/** The price bands as plain labelled rows, for the pricing tables. */
export function seatBandRows(): { label: string; priceZar: number }[] {
  let start = 1
  return SEAT_BANDS.map(([last, price]) => {
    const label = last === null
      ? `Seat ${start} and up`
      : last === start ? `Seat ${start}` : `Seats ${start}-${last}`
    if (last !== null) start = last + 1
    return { label, priceZar: price }
  })
}
