'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

export interface FormGroup { group: string; groupLabel: string }

export interface OrgAccessInfo {
  state:       'trial' | 'active' | 'locked'
  daysLeft:    number | null
  trialEndsAt: string | null
}

export interface OrgData {
  name:               string
  email:              string
  orgId:              string
  orgName:            string
  initials:           string
  // 'agent' until /api/me says otherwise, so admin-only UI never flashes.
  role:               'admin' | 'agent'
  // 'active' until /api/me says otherwise, so a slow load never flashes a lock screen.
  access:             OrgAccessInfo
  subscribedProducts: string[]
  formGroups:         FormGroup[]
  loading:            boolean
  refetch:            () => void
}

const OrgContext = createContext<OrgData>({
  name: '', email: '', orgId: '', orgName: '',
  initials: '··', role: 'agent', access: { state: 'active', daysLeft: null, trialEndsAt: null },
  subscribedProducts: [], formGroups: [],
  loading: true, refetch: () => {},
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Omit<OrgData, 'refetch'>>({
    name: '', email: '', orgId: '', orgName: '',
    initials: '··', role: 'agent', access: { state: 'active', daysLeft: null, trialEndsAt: null },
    subscribedProducts: [], formGroups: [],
    loading: true,
  })

  const load = () => {
    fetch('/api/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setData({ ...d, loading: false })
        else   setData(prev => ({ ...prev, loading: false }))
      })
      .catch(() => setData(prev => ({ ...prev, loading: false })))
  }

  useEffect(load, [])

  return <OrgContext.Provider value={{ ...data, refetch: load }}>{children}</OrgContext.Provider>
}

export function useOrg() { return useContext(OrgContext) }
