import Link from 'next/link'
import { StatusBadge } from '@/components/StatusBadge'

const STATS = [
  { label: 'Total', value: '24', icon: '📄' },
  { label: 'Processing', value: '3',  icon: '⚙️' },
  { label: 'Complete', value: '19', icon: '✅' },
  { label: 'Failed', value: '2',  icon: '❌' },
]

const SUBMISSIONS = [
  { id: 'DAI-2026-00142', type: 'Claim Form',    uploaded: '25 Jun 2026', status: 'processing' as const },
  { id: 'DAI-2026-00141', type: 'Life Policy',   uploaded: '24 Jun 2026', status: 'complete' as const },
  { id: 'DAI-2026-00140', type: 'Claim Form',    uploaded: '23 Jun 2026', status: 'failed' as const },
  { id: 'DAI-2026-00139', type: 'Death Benefit', uploaded: '22 Jun 2026', status: 'complete' as const },
  { id: 'DAI-2026-00138', type: 'Life Policy',   uploaded: '21 Jun 2026', status: 'complete' as const },
  { id: 'DAI-2026-00137', type: 'Disability',    uploaded: '20 Jun 2026', status: 'complete' as const },
]

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl sm:text-3xl text-forest-deep">My Documents</h1>
        <p className="text-slate text-sm mt-1">All your insurance form submissions</p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {STATS.map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-2xl font-display text-forest-deep">{s.value}</p>
            <p className="text-xs text-slate mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Upload CTA */}
      <Link href="/upload"
        className="flex items-center gap-3 bg-forest-deep text-white rounded-xl px-5 py-4 mb-6 hover:bg-forest-mid transition-colors group">
        <div className="w-9 h-9 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/30 transition-colors">
          <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-sm">Upload a new document</p>
          <p className="text-white/60 text-xs">PDF, JPG or PNG · max 10MB</p>
        </div>
        <svg className="w-4 h-4 text-white/40 ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </Link>

      {/* Table — card on mobile, full table on desktop */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* Desktop table */}
        <table className="hidden sm:table w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="text-left px-5 py-3.5 text-xs font-medium text-slate uppercase tracking-wide">Reference</th>
              <th className="text-left px-5 py-3.5 text-xs font-medium text-slate uppercase tracking-wide">Form Type</th>
              <th className="text-left px-5 py-3.5 text-xs font-medium text-slate uppercase tracking-wide">Uploaded</th>
              <th className="text-left px-5 py-3.5 text-xs font-medium text-slate uppercase tracking-wide">Status</th>
              <th className="px-5 py-3.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {SUBMISSIONS.map(sub => (
              <tr key={sub.id} className="hover:bg-gray-50/60 transition-colors">
                <td className="px-5 py-4 font-mono text-xs text-gray-700">{sub.id}</td>
                <td className="px-5 py-4 text-gray-800">{sub.type}</td>
                <td className="px-5 py-4 text-slate">{sub.uploaded}</td>
                <td className="px-5 py-4"><StatusBadge status={sub.status} /></td>
                <td className="px-5 py-4 text-right">
                  <Link href={`/status/${sub.id}`}
                    className="text-xs text-accent hover:text-green-600 font-medium transition-colors">
                    {sub.status === 'complete' ? 'Download →' : 'Track →'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile card list */}
        <div className="sm:hidden divide-y divide-gray-100">
          {SUBMISSIONS.map(sub => (
            <Link key={sub.id} href={`/status/${sub.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-gray-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge status={sub.status} />
                </div>
                <p className="text-sm font-medium text-gray-800 truncate">{sub.type}</p>
                <p className="font-mono text-xs text-slate mt-0.5">{sub.id}</p>
                <p className="text-xs text-gray-400 mt-0.5">{sub.uploaded}</p>
              </div>
              <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
