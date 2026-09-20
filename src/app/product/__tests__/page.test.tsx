import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import ProductPage from '../page'
import { computeSeatCharge } from '@/lib/seat-pricing'

const price = (n: number) => `R${n.toLocaleString('en-US')}`

describe('Products page', () => {
  it('is labelled "Products" in the site navigation, not "Product"', () => {
    render(<ProductPage />)
    expect(screen.getAllByRole('link', { name: 'Products' })[0]).toHaveAttribute('href', '/product')
    expect(screen.queryByRole('link', { name: 'Product' })).not.toBeInTheDocument()
  })

  it('links to the pricing section from the top of the page', () => {
    render(<ProductPage />)
    expect(screen.getByRole('link', { name: 'See pricing' })).toHaveAttribute('href', '#pricing')
    expect(document.getElementById('pricing')).not.toBeNull()
  })

  describe('pricing section', () => {
    const section = () => document.getElementById('pricing') as HTMLElement

    it('offers a free 7 day pilot with every product, then Starter', () => {
      render(<ProductPage />)
      const names = within(section()).getAllByRole('heading', { level: 3 }).map(h => h.textContent)
      expect(names).toEqual(['Pilot', 'Starter'])

      const text = section().textContent ?? ''
      expect(text).toContain('Free')
      expect(text).toContain('for 7 days')
      expect(text).toContain('All six products')
      expect(text).toContain('On day 8 you move to Starter')
      expect(text).toContain('email you on day 5')
    })

    it('shows what each seat costs, by position', () => {
      render(<ProductPage />)
      const table = within(section()).getByRole('table')
      const rows = within(table).getAllByRole('row').map(r => r.textContent)

      expect(rows).toEqual([
        'Seats 1-4R500 each',
        'Seats 5-9R450 each',
        'Seat 10R400 each',
        'Seat 11 and upR350 each',
      ])
      expect(section().textContent).toContain('From R500')
    })

    it('gives worked examples that match what the platform will charge', () => {
      render(<ProductPage />)
      const text = section().textContent ?? ''
      for (const n of [1, 5, 10, 20]) {
        expect(text).toContain(`${n} seat${n > 1 ? 's' : ''} is ${price(computeSeatCharge(n).totalZar)}`)
      }
      expect(text).toContain(`5 seats is ${price(2450)}`)      // 4 x R500 + R450, not 5 x R450
      expect(text).toContain('50 documents a month')
    })

    it('sends visitors to register, with the free plan called out', () => {
      render(<ProductPage />)
      expect(within(section()).getByRole('link', { name: 'Start free' })).toHaveAttribute('href', '/register')
      expect(within(section()).getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/register')
    })

    it('no longer shows the old Growth and Multi-site plans', () => {
      render(<ProductPage />)
      expect(section().textContent).not.toMatch(/Growth|Multi-site/)
    })

    it('uses no em dashes or double dashes in its copy', () => {
      render(<ProductPage />)
      expect(section().textContent).not.toMatch(/—|--/)
    })
  })
})
