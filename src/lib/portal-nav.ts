import {
  LayoutDashboard, FileText, Send, Inbox, UploadCloud, MessageSquareWarning, PenLine, FolderLock, Users, History, ShieldCheck,
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
export function navGroupsFor(products: string[], role: string = 'agent', isOperator: boolean = false): NavGroup[] {
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
    // Platform operators only. Deliberately last and apart from the customer workspace.
    {
      label: 'Platform',
      items: isOperator ? [{ href: '/operator', label: 'Operator console', icon: ShieldCheck }] : [],
    },
  ]

  return groups.filter(g => g.items.length > 0)
}

export function isNavItemActive(item: NavItem, path: string | null): boolean {
  if (!path) return false
  if (item.href === '/dashboard') return path === '/dashboard'
  return [item.href, ...(item.alsoActive ?? [])].some(p => path === p || path.startsWith(`${p}/`))
}
