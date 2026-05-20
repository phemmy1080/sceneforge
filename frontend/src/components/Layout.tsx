import React, { useState, useEffect, useRef } from 'react'
import { useStore, type AppStep } from '../store'
import { useAuthStore } from '../authStore'
import StepNav from './StepNav'
import UserMenu from './UserMenu'

const STEPS: { id: AppStep; label: string }[] = [
  { id: 'setup',  label: 'Setup' },
  { id: 'ideas',  label: 'Ideas' },
  { id: 'script', label: 'Script' },
  { id: 'scenes', label: 'Scene editor' },
  { id: 'voice',  label: 'Voice & visuals' },
  { id: 'export', label: 'Export' },
]

const ICONS: Record<string, React.ReactNode> = {
  setup:  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/></svg>,
  ideas:  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2a4 4 0 0 1 1.5 7.7V12H6.5V9.7A4 4 0 0 1 8 2z"/><path d="M6.5 13h3M7 15h2"/></svg>,
  script: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5 6h6M5 9h4"/></svg>,
  scenes: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>,
  voice:  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v12M5 4v8M11 4v8M2 7v2M14 7v2"/></svg>,
  export: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v8M5 7l3 3 3-3M3 12h10"/></svg>,
}

interface LayoutProps {
  children: React.ReactNode
  onLogout: () => void
  onNewProject: () => void
}

function TokenGateBar({ onUpgrade }: { onUpgrade: () => void }) {
  const [balance, setBalance] = useState<{ tokens_remaining: number; tokens_total: number } | null>(null)

  useEffect(() => {
    const load = () => {
      import('../lib/api').then(({ getTokenBalance }) => {
        getTokenBalance().then(setBalance).catch(() => {})
      })
    }
    load()
    const id = setInterval(load, 300000)
    return () => clearInterval(id)
  }, [])

  if (!balance) return null
  const pct = Math.min(100, Math.round((balance.tokens_remaining / balance.tokens_total) * 100))
  const empty = balance.tokens_remaining === 0
  const low = balance.tokens_remaining < 200 && !empty
  if (!empty && !low) return null

  return (
    <div className={`mx-2 mb-2 rounded-xl p-3 flex-shrink-0 border ${
      empty ? 'bg-red-500/10 border-red-500/25' : 'bg-amber-500/10 border-amber-500/20'
    }`}>
      <p className={`text-[11px] font-bold mb-1 ${empty ? 'text-red-400' : 'text-amber-400'}`}>
        {empty ? 'Tokens exhausted' : 'Tokens running low'}
      </p>
      <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-2">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: empty ? '#FF6B6B' : '#F59E0B' }} />
      </div>
      <p className="text-[10.5px] text-white/40 mb-2">{balance.tokens_remaining} tokens left</p>
      <button
        onClick={onUpgrade}
        className={`w-full text-[11.5px] font-semibold py-1.5 rounded-lg transition-colors ${
          empty ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30' : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
        }`}
      >
        Top up tokens →
      </button>
    </div>
  )
}


function AgencyNav({ currentStep, onStep }: { currentStep: string; onStep: (s: AppStep) => void }) {
  const user            = useAuthStore((s: any) => s.user)
  const step            = useStore((s) => s.currentStep)
  const agencyProjId    = useStore((s: any) => s.agencyProjectId)

  // All computed from fresh values — no stale closure
  const wsRoleNav    = user?.workspace_role
  const inAgency     = !!(user?.workspace_id || user?.plan === 'agency')
  const isNonOwnerNav = !!(wsRoleNav && wsRoleNav !== 'owner')
  const isActiveAgency = inAgency && (
(step.startsWith('agency') || step === 'agency-workflow') || !!agencyProjId || isNonOwnerNav
  )
  if (!isActiveAgency) return null

  const wsRole = user?.workspace_role || (user?.plan === 'agency' ? 'owner' : 'editor')
  const isAdminOrOwner = wsRole === 'owner' || wsRole === 'admin'

  // Base links everyone in agency sees
  const links: { id: string; label: string }[] = [
    { id: 'agency',          label: 'Dashboard' },
    { id: 'agency-projects', label: 'Projects'  },
  ]
  // Team and Brand kits only for admin/owner
  if (isAdminOrOwner) {
    links.push({ id: 'agency-team', label: 'Team' })
    links.push({ id: 'agency-kits', label: 'Brand kits' })
  }

  return (
    <>
      <p className="text-[9.5px] font-bold text-white/25 uppercase tracking-widest px-2 pt-3 pb-1">Agency</p>
      {links.map(link => {
        const isActive = currentStep === link.id
        return (
          <button
            key={link.id}
            onClick={() => onStep(link.id as AppStep)}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[13px] font-medium transition-all mb-0.5 text-left border
              ${isActive
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/20'
                : 'text-white/45 border-transparent hover:bg-white/4 hover:text-white/75'}`}
          >
            {link.label}
          </button>
        )
      })}
    </>
  )
}

function SidebarContent({ onLogout, onNewProject, onClose }: { onLogout: () => void; onNewProject: () => void; onClose?: () => void }) {
  const currentStepRaw   = useStore((s) => s.currentStep)
  const agencyWorkflowStep = useStore((s: any) => s.agencyWorkflowStep) || 'setup'
  const completedSteps   = useStore((s) => s.completedSteps)
  const setStep          = useStore((s) => s.setStep)
  const agencyProjectId  = useStore((s: any) => s.agencyProjectId)
  const user             = useAuthStore((s: any) => s.user)
  // Use sub-step for display when in agency workflow
  const currentStep = currentStepRaw === 'agency-workflow' ? agencyWorkflowStep : currentStepRaw

  // Derive role fields from user (outside any selector — always fresh)
  const wsRole        = user?.workspace_role || (user?.plan === 'agency' ? 'owner' : null)
  const isAgencyOwner = wsRole === 'owner'
  const isAgencyAdmin = wsRole === 'owner' || wsRole === 'admin'
  const inWorkspace   = !!(user?.workspace_id || user?.workspace_role)
  const isNonOwner    = !!(wsRole && wsRole !== 'owner')

  // inAgencyMode — computed from both stores, all fresh values
  // Three conditions, ANY one is enough:
  // 1. agencyProjectId is set                → creating video for an agency project
  // 2. currentStep is an agency screen       → on agency dashboard/projects/team/kits
  // 3. user is a non-owner workspace member  → editors/admins/clients always in agency
  const inAgencyMode  = !!agencyProjectId ||
                        (currentStepRaw.startsWith('agency') || currentStepRaw === 'agency-workflow') ||
                        (inWorkspace && isNonOwner)
  const showPersonal  = !inAgencyMode
  const scenes         = useStore((s) => s.scenes)
  const renderStatus   = useStore((s) => s.renderStatus)
  const projects       = useStore((s) => s.projects)
  const folders        = useStore((s) => s.folders)
  const folderOpen     = useStore((s) => s.folderOpen)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const toggleFolder   = useStore((s) => s.toggleFolder)
  const openProject    = useStore((s) => s.openProject)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const dotColor: Record<string, string> = { active: '#A78BFA', exported: '#2DD4BF', draft: '#F59E0B' }

  function handleOpenProject(id: string) {
    openProject(id)
    setStep('setup')
    onClose?.()
  }

  function handleSetStep(step: AppStep) {
    setStep(step)
    onClose?.()
  }

  return (
    <>
      {/* Top */}
      <div className="p-3.5 border-b border-white/[0.07] flex-shrink-0">
        {/* Agency workflow banner — shown when creating video for an agency project */}
        {inAgencyMode && !currentStep.startsWith('agency') && agencyProjectId && (
          <div className="mb-2.5 bg-amber-400/10 border border-amber-400/20 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-amber-400/80 uppercase tracking-wider">Agency project</p>
              <p className="text-[11px] text-white/60 truncate">Creating video for project</p>
            </div>
            <button
              onClick={() => {
                setStep('agency-detail' as any)
                useStore.getState().setAgencyProjectId(agencyProjectId)
              }}
              className="text-[10px] text-amber-400/70 hover:text-amber-400 transition font-semibold flex-shrink-0"
            >
              ← Back
            </button>
          </div>
        )}
        <div className="flex items-center justify-between mb-2.5">
          <div className="font-display text-[17px] font-extrabold tracking-tight px-1">
            Scene<span className="text-violet-400">Forge</span>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/8 text-white/40 hover:text-white/70 transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 3l10 10M13 3L3 13"/>
              </svg>
            </button>
          )}
        </div>
        {/* Only show personal New project button when not in agency mode */}
        {showPersonal ? (
          activeProject ? (
            <div className="w-full rounded-lg overflow-hidden border border-violet-500/25 bg-violet-500/8">
              <div className="px-3 py-2 flex items-center gap-2 min-w-0">
                <div className="w-2 h-2 rounded-full bg-violet-400 flex-shrink-0 animate-pulse" />
                <span className="text-[12px] font-semibold text-violet-300 truncate flex-1">{activeProject.name}</span>
              </div>
              <button
                onClick={() => { onNewProject(); onClose?.() }}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 border-t border-violet-500/15 text-violet-400/60 text-[11px] font-medium hover:text-violet-300 hover:bg-violet-500/10 transition-all"
              >
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 1v10M1 6h10"/></svg>
                New project
              </button>
            </div>
          ) : (
            <button
              onClick={() => { onNewProject(); onClose?.() }}
              className="w-full flex items-center justify-center gap-2 py-2 bg-violet-500/15 border border-dashed border-violet-500/35 rounded-lg text-violet-300 text-[12px] font-semibold hover:bg-violet-500/22 hover:border-violet-400/50 transition-all"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 1v10M1 6h10"/></svg>
              New project
            </button>
          )
        ) : null}
      </div>

      {/* Scrollable nav */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        {/* Hide personal workflow for non-owner workspace members */}
        {(showPersonal || currentStep === 'agency-workflow') && (
          <>
            <p className="text-[9.5px] font-bold text-white/25 uppercase tracking-widest px-2 pt-2 pb-1">Workflow</p>
            {STEPS.map((step) => {
              const isActive = currentStep === step.id
              const isDone   = completedSteps.has(step.id)
              return (
                <button
                  key={step.id}
                  onClick={() => handleSetStep(step.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[13px] font-medium transition-all mb-0.5 text-left border
                    ${isActive ? 'bg-violet-500/15 text-violet-300 border-violet-500/20'
                      : isDone ? 'text-teal-400 border-transparent hover:bg-white/4'
                      : 'text-white/45 border-transparent hover:bg-white/4 hover:text-white/75'}`}
                >
                  <span className={isActive ? 'text-violet-400' : isDone ? 'text-teal-400' : 'text-white/30'}>
                    {ICONS[step.id]}
                  </span>
                  {step.label}
                  {isDone && !isActive && (
                    <svg className="ml-auto w-3 h-3 text-teal-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 6l3 3 5-5"/></svg>
                  )}
                </button>
              )
            })}
          </>
        )}

        {/* ── Agency (only shown on agency plan) ── */}
        <AgencyNav currentStep={currentStep} onStep={handleSetStep} />

        {/* Personal projects — only in personal mode */}
        {showPersonal && (
          <><div className="flex items-center justify-between px-2 pt-3 pb-1">
          <p className="text-[9.5px] font-bold text-white/25 uppercase tracking-widest">Projects</p>
          {showPersonal && <button onClick={() => { onNewProject(); onClose?.() }} className="text-white/25 hover:text-white/55 text-[14px] leading-none px-1 transition-colors">+</button>}
        </div>

        {Object.keys(folders).map((folder) => {
          const folderProjects = folders[folder]
            .map((id) => projects.find((p) => p.id === id))
            .filter(Boolean) as typeof projects
          if (folderProjects.length === 0) return null
          const isOpen = folderOpen[folder] !== false
          return (
            <div key={folder} className="mb-0.5">
              <button
                onClick={() => toggleFolder(folder)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/4 transition-colors text-left"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
                  className={`text-white/30 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                  <path d="M3 4l3 4 3-4"/>
                </svg>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="1.3" className="flex-shrink-0">
                  <path d="M1 4a1 1 0 0 1 1-1h3l2 2h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z"/>
                </svg>
                <span className="text-[12px] font-semibold text-white/55 flex-1 truncate">{folder}</span>
                <span className="text-[10px] bg-white/7 text-white/30 px-1.5 py-0.5 rounded-full">{folderProjects.length}</span>
              </button>
              {isOpen && (
                <div className="pl-4">
                  {folderProjects.map((proj) => (
                    <button
                      key={proj.id}
                      onClick={() => handleOpenProject(proj.id)}
                      className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-all mb-0.5 ${
                        proj.id === activeProjectId ? 'bg-violet-500/12 text-violet-300' : 'text-white/50 hover:bg-white/4 hover:text-white/75'
                      }`}
                    >
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dotColor[proj.status] || '#F59E0B' }} />
                      <span className="text-[11.5px] flex-1 truncate">{proj.name}</span>
                      <span className="text-[9.5px] text-white/25">
                        {proj.duration > 0 ? proj.duration + 's' : proj.sceneCount > 0 ? proj.sceneCount + 'sc' : proj.step}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        </>
        )}
      </div>

      {/* Active project status */}
      {showPersonal && activeProject && (
        <div className="mx-2 mb-2 bg-violet-500/10 border border-violet-500/20 rounded-xl p-2.5 flex-shrink-0">
          <p className="text-[9.5px] font-semibold text-violet-400 uppercase tracking-widest mb-1">Active</p>
          <p className="text-[11.5px] text-white/75 font-medium leading-snug truncate">{activeProject.name}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {scenes.length > 0 && <span className="text-[9.5px] bg-teal-500/15 text-teal-400 px-1.5 py-0.5 rounded-full">{scenes.length} scenes</span>}
            {renderStatus === 'complete' && <span className="text-[9.5px] bg-teal-500/15 text-teal-400 px-1.5 py-0.5 rounded-full">Ready to export</span>}
          </div>
        </div>
      )}

      <button
        onClick={() => document.dispatchEvent(new CustomEvent('open-feedback-modal'))}
        className="mx-2 mb-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl text-white/40 hover:text-violet-400 hover:bg-violet-500/10 border border-transparent hover:border-violet-500/20 transition-all text-[12px] font-medium flex-shrink-0"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H2a1 1 0 00-1 1v8a1 1 0 001 1h3l3 3 3-3h3a1 1 0 001-1V3a1 1 0 00-1-1z"/>
          <path d="M5 7h6M5 5h4"/>
        </svg>
        Share feedback
      </button>
      <TokenGateBar onUpgrade={() => useStore.getState().setStep('upgrade')} />
      <UserMenu onLogout={onLogout} />
    </>
  )
}

export default function Layout({ children, onLogout, onNewProject }: LayoutProps) {
  const setStep = useStore((s) => s.setStep)
  const currentStep = useStore((s) => s.currentStep)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [upgradePrompt, setUpgradePrompt] = useState<{ reason: string; max?: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: CustomEvent) => setUpgradePrompt(e.detail)
    document.addEventListener('show-upgrade-prompt', handler as EventListener)
    return () => document.removeEventListener('show-upgrade-prompt', handler as EventListener)
  }, [])

  // Close sidebar on resize to desktop
  useEffect(() => {
    const handler = () => { if (window.innerWidth >= 768) setSidebarOpen(false) }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const STEP_LABELS: Record<string, string> = {
    setup: 'Setup', ideas: 'Ideas', script: 'Script',
    scenes: 'Scenes', voice: 'Voice & Visuals', export: 'Export',
    plans: 'Plans', upgrade: 'Upgrade',
    agency: 'Agency', 'agency-projects': 'Projects', 'agency-new': 'New project',
    'agency-detail': 'Project', 'agency-team': 'Team', 'agency-kits': 'Brand kits',
  }

  return (
    <>
      <div className="flex min-h-screen bg-[#0A0A0F] text-[#F0F0FF]">

        {/* ── Desktop Sidebar ── */}
        <aside className="hidden md:flex w-56 shrink-0 bg-[#111118] border-r border-white/[0.07] flex-col sticky top-0 h-screen overflow-hidden">
          <SidebarContent onLogout={onLogout} onNewProject={onNewProject} />
        </aside>

        {/* ── Mobile: overlay + drawer ── */}
        {sidebarOpen && (
          <div
            ref={overlayRef}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside className={`fixed top-0 left-0 h-full w-72 max-w-[85vw] bg-[#111118] border-r border-white/[0.07] flex flex-col z-50 md:hidden transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}>
          <SidebarContent onLogout={onLogout} onNewProject={onNewProject} onClose={() => setSidebarOpen(false)} />
        </aside>

        {/* ── Main content ── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Mobile top bar */}
          <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-[#111118] border-b border-white/[0.07] sticky top-0 z-30">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-white/8 text-white/60 hover:text-white/90 transition-colors flex-shrink-0"
              aria-label="Open menu"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M2 4h14M2 9h14M2 14h14"/>
              </svg>
            </button>
            <div className="font-display text-[15px] font-extrabold tracking-tight">
              Scene<span className="text-violet-400">Forge</span>
            </div>
            <div className="flex-1 text-center">
              <span className="text-[12px] font-medium text-white/40">{STEP_LABELS[currentStep] || ''}</span>
            </div>
            {/* Feedback button */}
            <button
              onClick={() => document.dispatchEvent(new CustomEvent('open-feedback-modal'))}
              className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg hover:bg-white/8 text-white/40 hover:text-violet-400 transition-colors"
              aria-label="Give feedback"
              title="Give feedback"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H2a1 1 0 00-1 1v8a1 1 0 001 1h3l3 3 3-3h3a1 1 0 001-1V3a1 1 0 00-1-1z"/>
                <path d="M5 7h6M5 5h4"/>
              </svg>
            </button>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-8 py-5 md:py-8">
              <StepNav />
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* Upgrade prompt modal */}
      {upgradePrompt && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setUpgradePrompt(null)}
        >
          <div
            style={{ background: '#111118', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, padding: '28px 24px', maxWidth: 420, width: '100%', textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 40, marginBottom: 16 }}>🚀</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', margin: '0 0 10px', color: '#F0F0FF' }}>
              Upgrade to unlock this
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', margin: '0 0 8px', lineHeight: 1.6 }}>
              {upgradePrompt.reason === 'scene_limit' && `Free plan is limited to ${upgradePrompt.max} scenes per video.`}
              {upgradePrompt.reason === 'upload_footage' && 'Upload your own footage and voiceover on paid plans.'}
              {upgradePrompt.reason === 'ai_voices' && 'Natural AI voices are available on paid plans.'}
              {upgradePrompt.reason === 'daily_limit' && 'Free plan allows 3 renders per day.'}
              {upgradePrompt.reason === 'ai_images' && 'AI image generation with DALL-E 3 is available on Pro and Studio plans.'}
            </p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', margin: '0 0 24px' }}>
              Upgrade for unlimited scenes, AI voices, 1080p exports, and more.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setUpgradePrompt(null); setStep('plans') }}
                style={{ flex: 1, background: '#7C5CFF', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                See upgrade plans
              </button>
              <button
                onClick={() => setUpgradePrompt(null)}
                style={{ flex: 1, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
