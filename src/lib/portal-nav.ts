import {
  LayoutDashboard, FileText, Send, Inbox, UploadCloud, MessageSquareWarning, PenLine, FolderLock, Users, History,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  href:  string
  label: string
  icon:  LucideIcon
  // Other path prefixes that belong to this item (e.g. /status/{id} is part of Extract).
  alsoActive?: string[]
}

export interface NavGroup {
  label?: string
  items:  NavItem[]
}

// Which items a signed-in org sees is driven by its subscribed products, same
// gating the old top bar used. Gate-Keep is a baseline capability every org has.
// Groups follow the product's own workflow (forms in, documents in, sign, store)
// so the sidebar reads as the product, not a flat list. Empty groups are dropped.
export function navGroupsFor(products: string[], role: string = 'agent'): NavGroup[] {
  const has = (p: string) => products.includes(p)

  const groups: NavGroup[] = [
    { items: [{ href: '/dashboard', label: 'Home', icon: LayoutDashboard }] },
    {
      label: 'Forms',
      items: [
        ...(has('forge')   ? [{ href: '/templates',   label: 'Templates',   icon: FileText }] : []),
        ...(has('channel') ? [{ href: '/forms',       label: 'Forms',       icon: Send }]     : []),
        ...(has('harvest') ? [{ href: '/submissions', label: 'Submissions', icon: Inbox }]    : []),
      ],
    },
    {
      label: 'Documents',
      items: has('decode') ? [
        { href: '/upload',         label: 'Extract', icon: UploadCloud, alsoActive: ['/status'] },
        { href: '/clarifications', label: 'Pending', icon: MessageSquareWarning },
      ] : [],
    },
    {
      label: 'Signing',
      items: has('sign') ? [{ href: '/sign', label: 'Sign', icon: PenLine }] : [],
    },
    { label: 'Files', items: [{ href: '/gate-keep', label: 'Gate-Keep', icon: FolderLock }] },
    // Managing users is an admin action, so agents never see this item.
    {
      label: 'Organisation',
      items: role === 'admin'
        ? [{ href: '/team', label: 'Team', icon: Users }, { href: '/activity', label: 'Activity', icon: History }]
        : [],
    },
  ]

  return groups.filter(g => g.items.length > 0)
}

export function isNavItemActive(item: NavItem, path: string | null): boolean {
  if (!path) return false
  if (item.href === '/dashboard') return path === '/dashboard'
  return [item.href, ...(item.alsoActive ?? [])].some(p => path === p || path.startsWith(`${p}/`))
}

// Where Back goes when there is no earlier page inside the portal: up to the section the
// page belongs to (a page under /sign goes to /sign), or Home. Home itself has no Back.
export function parentPathOf(path: string | null, groups: NavGroup[]): string | null {
  if (!path || path === '/dashboard') return null
  const section = groups.flatMap(g => g.items).find(i => i.href !== '/dashboard' && isNavItemActive(i, path))
  return section && path !== section.href ? section.href : '/dashboard'
}
