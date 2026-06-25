'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

type StageStatus = 'complete' | 'processing' | 'pending' | 'failed'

interface Stage {
  id: string
  label: string
  description: string
  status: StageStatus
  timestamp?: string
}

// Demo data — replace with real API polling in Phase 3
const DEMO_STAGES: Stage[] = [
  { id: 'received',   label: 'Document Received',    description: 'Your file was received securely', status: 'complete',   timestamp: '14:32:01' },
  { id: 'classified', label: 'Form Type Identified', description: 'Classified as Claim Form',        status: 'complete',   timestamp: '14:32:04' },
  { id: 'routed',     label: 'Routed to Extractor',  description: 'Sent to PDF extraction service',  status: 'complete',   timestamp: '14:32:05' },
  { id: 'extracting', label: 'Extracting Fields',    description: 'Reading form fields with AI',     status: 'processing', timestamp: undefined },
  { id: 'validating', label: 'Validating Fields',    description: 'Checking all required fields',    status: 'pending',    timestamp: undefined },
  { id: 'generating', label: 'Generating PDF',       description: 'Creating completed document',     status: 'pending',    timestamp: undefined },
  { id: 'filing',     label: 'Filing Document',      description: 'Updating client register',        status: 'pending',    timestamp: undefined },
  { id: 'notified',   label: 'Notification Sent',    description: 'Email sent to your address',      status: 'pending',    timestamp: undefined },
]

function StageIcon({ status }: { status: StageStatus }) {
  if (status === 'complete') return (
    <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center flex-shrink-0 shadow-sm">
      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </div>
  )
  if (status === 'processing') return (
    <div className="w-8 h-8 rounded-full bg-white border-2 border-accent flex items-center justify-center flex-shrink-0 animate-glow">
      <div className="w-3 h-3 rounded-full bg-accent animate-pulse" />
    </div>
  )
  if (status === 'failed') return (
    <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  )
  return (
    <div className="w-8 h-8 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center flex-shrink-0">
      <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />
    </div>
  )
}

export default function StatusPage({ params }: { params: { id: string } }) {
  const [stages, setStages] = useState<Stage[]>(DEMO_STAGES)
  const [tick, setTick] = useState(0)

  // Simulate pipeline progressing — replace with real polling in Phase 3
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 3000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    setStages(prev => {
      const processingIdx = prev.findIndex(s => s.status === 'processing')
      if (processingIdx === -1) return prev
      const next = [...prev]
      const now = new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      next[processingIdx] = { ...next[processingIdx], status: 'complete', timestamp: now }
      if (processingIdx + 1 < next.length) {
        next[processingIdx + 1] = { ...next[processingIdx + 1], status: 'processing' }
      }
      return next
    })
  }, [tick])

  const complete = stages.filter(s => s.status === 'complete').length
  const total = stages.length
  const pct = Math.round((complete / total) * 100)
  const isDone = stages.every(s => s.status === 'complete')

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl text-forest-deep">
              {isDone ? 'Processing complete' : 'Processing your document'}
            </h1>
            <p className="font-mono text-sm text-slate mt-1">{params.id}</p>
          </div>
          {isDone && (
            <a href="#" className="flex-shrink-0 inline-flex items-center gap-1.5 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-green-600 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download
            </a>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate mb-1.5">
            <span>{complete} of {total} stages complete</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Pipeline Spine */}
      <div className="card">
        <div className="space-y-0">
          {stages.map((stage, i) => (
            <div key={stage.id} className="flex gap-4">
              {/* Left: icon + connector */}
              <div className="flex flex-col items-center">
                <StageIcon status={stage.status} />
                {i < stages.length - 1 && (
                  <div className={`w-0.5 flex-1 my-1 rounded-full transition-colors duration-500 ${
                    stage.status === 'complete' ? 'bg-accent' : 'bg-gray-200'
                  }`} style={{ minHeight: 24 }} />
                )}
              </div>

              {/* Right: content */}
              <div className={`pb-6 flex-1 min-w-0 ${i === stages.length - 1 ? 'pb-0' : ''}`}>
                <div className="flex items-start justify-between gap-2 pt-1">
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold leading-tight ${
                      stage.status === 'complete'   ? 'text-gray-800' :
                      stage.status === 'processing' ? 'text-accent' :
                      stage.status === 'failed'     ? 'text-red-600' :
                      'text-gray-400'
                    }`}>
                      {stage.label}
                    </p>
                    <p className={`text-xs mt-0.5 ${
                      stage.status === 'pending' ? 'text-gray-300' : 'text-slate'
                    }`}>
                      {stage.description}
                    </p>
                  </div>
                  {stage.timestamp && (
                    <span className="font-mono text-xs text-slate flex-shrink-0 pt-0.5">
                      {stage.timestamp}
                    </span>
                  )}
                  {stage.status === 'processing' && !stage.timestamp && (
                    <span className="text-xs text-accent animate-pulse flex-shrink-0 pt-0.5">
                      In progress…
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Document info */}
      <div className="mt-4 p-4 bg-white rounded-xl border border-gray-200">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-slate mb-0.5">Filename</p>
            <p className="font-medium text-gray-800 truncate">claim_form_june.pdf</p>
          </div>
          <div>
            <p className="text-xs text-slate mb-0.5">Submitted</p>
            <p className="font-medium text-gray-800">25 Jun 2026 · 14:32</p>
          </div>
          <div>
            <p className="text-xs text-slate mb-0.5">Form type</p>
            <p className="font-medium text-gray-800">Claim Form</p>
          </div>
          <div>
            <p className="text-xs text-slate mb-0.5">Reference</p>
            <p className="font-mono text-xs text-gray-800">{params.id}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 text-center">
        <Link href="/dashboard" className="text-sm text-slate hover:text-forest-mid transition-colors">
          ← Back to My Documents
        </Link>
      </div>
    </div>
  )
}
