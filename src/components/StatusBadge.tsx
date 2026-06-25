type Status = 'processing' | 'complete' | 'failed' | 'pending' | 'received'

const config: Record<Status, { label: string; classes: string; dot: string }> = {
  received:   { label: 'Received',   classes: 'bg-blue-50  text-blue-700  border-blue-200',  dot: 'bg-blue-500' },
  processing: { label: 'Processing', classes: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  complete:   { label: 'Complete',   classes: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500' },
  failed:     { label: 'Failed',     classes: 'bg-red-50   text-red-700   border-red-200',   dot: 'bg-red-500' },
  pending:    { label: 'Pending',    classes: 'bg-gray-50  text-gray-600  border-gray-200',  dot: 'bg-gray-400' },
}

export function StatusBadge({ status }: { status: Status }) {
  const c = config[status] ?? config.pending
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${c.classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${status === 'processing' ? 'animate-pulse' : ''}`} />
      {c.label}
    </span>
  )
}
