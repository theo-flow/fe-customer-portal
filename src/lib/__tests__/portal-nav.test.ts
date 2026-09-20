import { describe, it, expect } from 'vitest'
import { navGroupsFor, isNavItemActive, type NavItem } from '../portal-nav'

const hrefs = (products: string[]) => navGroupsFor(products).flatMap(g => g.items.map(i => i.href))

describe('navGroupsFor', () => {
  it('always has Home and Gate-Keep, even with no products', () => {
    expect(hrefs([])).toEqual(['/dashboard', '/gate-keep'])
  })

  it('adds only the items for subscribed products', () => {
    expect(hrefs(['forge', 'harvest'])).toEqual(['/dashboard', '/templates', '/submissions', '/gate-keep'])
  })

  it('gives Decode both Extract and Pending, and Sign its own item', () => {
    expect(hrefs(['decode', 'sign'])).toEqual(['/dashboard', '/upload', '/clarifications', '/sign', '/gate-keep'])
  })

  it('never returns an empty group', () => {
    expect(navGroupsFor([]).every(g => g.items.length > 0)).toBe(true)
  })

  it('a full bundle keeps the workflow order: forms, documents, signing, files', () => {
    const labels = navGroupsFor(['forge', 'channel', 'harvest', 'decode', 'sign']).map(g => g.label)
    expect(labels).toEqual([undefined, 'Forms', 'Documents', 'Signing', 'Files'])
  })
})

describe('isNavItemActive', () => {
  const item = (href: string, alsoActive?: string[]): NavItem => ({ href, label: href, icon: (() => null) as never, alsoActive })

  it('Home is active only on /dashboard', () => {
    expect(isNavItemActive(item('/dashboard'), '/dashboard')).toBe(true)
    expect(isNavItemActive(item('/dashboard'), '/forms')).toBe(false)
  })

  it('matches nested routes but not a sibling that merely shares a prefix', () => {
    expect(isNavItemActive(item('/forms'), '/forms/kyc/history')).toBe(true)
    expect(isNavItemActive(item('/sign'), '/sign/new')).toBe(true)
    expect(isNavItemActive(item('/sign'), '/signature-help')).toBe(false)
  })

  it('honours alsoActive (status pages belong to Extract)', () => {
    expect(isNavItemActive(item('/upload', ['/status']), '/status/doc-1')).toBe(true)
  })

  it('is false when the path is unknown', () => {
    expect(isNavItemActive(item('/forms'), null)).toBe(false)
  })
})
