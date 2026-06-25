import { TopNav } from '@/components/TopNav'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <TopNav />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-24 md:pb-10">
        {children}
      </main>
    </div>
  )
}
