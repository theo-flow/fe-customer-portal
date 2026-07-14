'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

export interface FormGroup { group: string; groupLabel: string }

export interface OrgData {
  name:               string
  email:              string
  orgId:              string
  orgName:            string
  initials:           string
  subscribedProducts: string[]
  formGroups:         FormGroup[]
  orgLogoUrl:         string | null
  loading:            boolean
  refetch:            () => void
}

const OrgContext = createContext<OrgData>({
  name: '', email: '', orgId: '', orgName: '',
  initials: '··', subscribedProducts: [], formGroups: [],
  orgLogoUrl: null, loading: true, refetch: () => {},
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Omit<OrgData, 'refetch'>>({
    name: '', email: '', orgId: '', orgName: '',
    initials: '··', subscribedProducts: [], formGroups: [],
    orgLogoUrl: null, loading: true,
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
