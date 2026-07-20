import { TopNav } from '@/components/TopNav'
import { OrgProvider } from '@/lib/org-context'
import SessionWatcher from '@/components/SessionWatcher'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <OrgProvider>
      <SessionWatcher />
      <div className="min-h-screen bg-white">
        <TopNav />
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-24 md:pb-10">
          {children}
        </main>
      </div>
    </OrgProvider>
  )
}
