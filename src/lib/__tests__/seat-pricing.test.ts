import { describe, it, expect } from 'vitest'
import {
  DOCS_PER_SEAT, MAX_SEATS, computeSeatCharge, docsIncludedFor, priceOfSeat, seatBandRows,
} from '../seat-pricing'
import { ALL_PRODUCTS, PAID_PLAN_ID, PLANS, TRIAL_DAYS, TRIAL_REMINDER_DAY, getPlan, planBenefits } from '../plans'

// Same cases as shared/constants/tests/unit/test_seat_pricing.py -- the two
// implementations are kept in sync by hand, so a drift shows up here.
describe('per-seat pricing: each seat costs what its position costs', () => {
  it.each([[1, 500], [4, 500], [5, 450], [9, 450], [10, 400], [11, 350], [50, 350]])(
    'seat %i costs R%i', (position, price) => expect(priceOfSeat(position)).toBe(price),
  )

  it.each([
    [0, 0],
    [1, 500],     // what a pilot converting on day 8 is invoiced
    [4, 2000],
    [5, 2450],    // 4 x 500 + 1 x 450, NOT 5 x 450
    [7, 3350],
    [9, 4250],
    [10, 4650],
    [11, 5000],
    [20, 8150],
  ])('%i seats cost R%i a month', (seats, total) => expect(computeSeatCharge(seats).totalZar).toBe(total))

  it('breaks the bill into one line per price band used', () => {
    const c = computeSeatCharge(12)
    expect(c.lines.map(l => [l.seats, l.unitPriceZar, l.subtotalZar])).toEqual([
      [4, 500, 2000], [5, 450, 2250], [1, 400, 400], [2, 350, 700],
    ])
    expect(c.totalZar).toBe(5350)
    expect(computeSeatCharge(3).lines.map(l => [l.seats, l.unitPriceZar])).toEqual([[3, 500]])
    expect(computeSeatCharge(0).lines).toEqual([])
  })

  it('never makes a bigger team cheaper, and never charges more for a later seat', () => {
    const totals = Array.from({ length: 80 }, (_, n) => computeSeatCharge(n).totalZar)
    totals.slice(1).forEach((t, i) => expect(t).toBeGreaterThan(totals[i]))

    const prices = Array.from({ length: 79 }, (_, i) => priceOfSeat(i + 1))
    prices.slice(1).forEach((p, i) => expect(p).toBeLessThanOrEqual(prices[i]))
  })

  it('rejects impossible input', () => {
    expect(() => computeSeatCharge(-1)).toThrow(RangeError)
    expect(() => priceOfSeat(0)).toThrow(RangeError)
  })

  it('includes 50 documents per seat', () => {
    expect(DOCS_PER_SEAT).toBe(50)
    expect([0, 1, 5, 10].map(docsIncludedFor)).toEqual([0, 50, 250, 500])
  })

  it('describes the bands as plain rows for the pricing tables', () => {
    expect(seatBandRows()).toEqual([
      { label: 'Seats 1-4', priceZar: 500 },
      { label: 'Seats 5-9', priceZar: 450 },
      { label: 'Seat 10', priceZar: 400 },
      { label: 'Seat 11 and up', priceZar: 350 },
    ])
  })

  it('has a sane ceiling for what an org can set for itself', () => {
    expect(MAX_SEATS).toBeGreaterThan(20)
  })
})

describe('plans: a seven day pilot, then Starter', () => {
  it('has exactly two plans, both with every product', () => {
    expect(Object.keys(PLANS).sort()).toEqual(['pilot', 'starter'])
    expect(PLANS.pilot.fullBundle && PLANS.starter.fullBundle).toBe(true)
    expect(ALL_PRODUCTS).toEqual(['forge', 'channel', 'harvest', 'decode', 'sign', 'print'])
  })

  it('matches the Python catalogue', () => {
    expect([TRIAL_DAYS, TRIAL_REMINDER_DAY, PAID_PLAN_ID]).toEqual([7, 5, 'starter'])
    expect(PLANS.pilot).toMatchObject({ seatsIncluded: 1, docsIncluded: 40, docsPerSeat: 0 })
    expect(PLANS.starter).toMatchObject({ docsPerSeat: 50, overageRateZar: 7, docsIncluded: 0 })
    expect(getPlan('starter')?.name).toBe('Starter')
    expect(getPlan('growth')).toBeUndefined()      // the old ladder is gone
    expect(getPlan(undefined)).toBeUndefined()
  })

  it('describes each plan in plain lines, with no em dashes', () => {
    const pilot = planBenefits(PLANS.pilot)
    expect(pilot).toContain('All six products')
    expect(pilot).toContain('7 days, no card or payment needed')
    const starter = planBenefits(PLANS.starter)
    expect(starter).toContain('50 documents per seat each month')
    expect(starter).toContain('Extra documents at R7 each')
    for (const line of [...pilot, ...starter]) expect(line).not.toMatch(/—|--/)
  })
})
