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
  loading:            boolean
}

const OrgContext = createContext<OrgData>({
  name: '', email: '', orgId: '', orgName: '',
  initials: '··', subscribedProducts: [], formGroups: [],
  loading: true,
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<OrgData>({
    name: '', email: '', orgId: '', orgName: '',
    initials: '··', subscribedProducts: [], formGroups: [],
    loading: true,
  })

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setData({ ...d, loading: false })
        else   setData(prev => ({ ...prev, loading: false }))
      })
      .catch(() => setData(prev => ({ ...prev, loading: false })))
  }, [])

  return <OrgContext.Provider value={data}>{children}</OrgContext.Provider>
}

export function useOrg() { return useContext(OrgContext) }
