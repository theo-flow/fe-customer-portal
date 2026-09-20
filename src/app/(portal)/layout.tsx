import { PortalShell } from '@/components/PortalShell'
import { OrgProvider } from '@/lib/org-context'
import SessionWatcher from '@/components/SessionWatcher'
import { Toaster } from '@/components/ui/toaster'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <OrgProvider>
      <SessionWatcher />
      <PortalShell>{children}</PortalShell>
      <Toaster />
    </OrgProvider>
  )
}
