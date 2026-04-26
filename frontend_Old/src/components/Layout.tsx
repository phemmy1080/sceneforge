import React from 'react'
import { useStore, type AppStep } from '../store'
import StepNav from './StepNav'

const STEPS: { id: AppStep; label: string; icon: React.ReactNode }[] = [
  {
    id: 'setup',
    label: 'Setup',
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 5v3l2 2" />
      </svg>
    ),
  },
  {
    id: 'ideas',
    label: 'Ideas',
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 2a4 4 0 0 1 1.5 7.7V12H6.5V9.7A4 4 0 0 1 8 2z" />
        <path d="M6.5 13h3M7 15h2" />
      </svg>
    ),
  },
  {
    id: 'script',
    label: 'Script',
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="2" width="10" height="12" rx="1.5" />
        <path d="M5 6h6M5 9h4" />
      </svg>
    ),
  },
  {
    id: 'scenes',
    label: 'Scene editor',
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="5" rx="1" />
        <rect x="9" y="9" width="5" height="5" rx="1" />
      </svg>
    ),
  },
  {
    id: 'voice',
    label: 'Voice & visuals',
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 2v12M5 4v8M11 4v8M2 7v2M14 7v2" />
      </svg>
    ),
  },
  {
    id: 'export',
    label: 'Export',
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 2v8M5 7l3 3 3-3M3 12h10" />
      </svg>
    ),
  },
]

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const currentStep = useStore((s) => s.currentStep)
  const completedSteps = useStore((s) => s.completedSteps)
  const setStep = useStore((s) => s.setStep)
  const config = useStore((s) => s.config)
  const scenes = useStore((s) => s.scenes)
  const renderStatus = useStore((s) => s.renderStatus)

  return (
    <div className="flex min-h-screen bg-[#0A0A0F] text-[#F0F0FF]">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-[#111118] border-r border-white/[0.07] flex flex-col p-4 sticky top-0 h-screen overflow-y-auto">
        {/* Logo */}
        <div className="font-display text-[19px] font-extrabold tracking-tight pb-5 mb-2 border-b border-white/[0.07]">
          Scene<span className="text-violet-400">Forge</span>
        </div>

        {/* Steps */}
        <nav className="flex flex-col gap-1 mt-2">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest px-2 mb-1">Workflow</p>
          {STEPS.map((step) => {
            const isActive = currentStep === step.id
            const isDone = completedSteps.has(step.id)
            return (
              <button
                key={step.id}
                onClick={() => setStep(step.id)}
                className={`
                  flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium
                  transition-all duration-150 text-left w-full
                  ${isActive
                    ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
                    : isDone
                    ? 'text-teal-400 hover:bg-white/5'
                    : 'text-white/50 hover:bg-white/5 hover:text-white/80'}
                `}
              >
                <span className={isActive ? 'text-violet-400' : isDone ? 'text-teal-400' : ''}>
                  {step.icon}
                </span>
                {step.label}
                {isDone && !isActive && (
                  <svg className="ml-auto w-3 h-3 text-teal-400" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  </svg>
                )}
              </button>
            )
          })}
        </nav>

        <div className="flex-1" />

        {/* Project status card */}
        {config.niche && (
          <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3 mt-4">
            <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-widest mb-1.5">
              Project
            </p>
            <p className="text-[12px] text-white/80 font-medium leading-snug">
              {config.niche} · {config.style}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {scenes.length > 0 && (
                <span className="text-[10px] bg-teal-500/15 text-teal-400 px-2 py-0.5 rounded-full">
                  {scenes.length} scenes
                </span>
              )}
              {renderStatus === 'complete' && (
                <span className="text-[10px] bg-teal-500/15 text-teal-400 px-2 py-0.5 rounded-full">
                  Ready to export
                </span>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          <StepNav />
          {children}
        </div>
      </main>
    </div>
  )
}
