import { useStore, type AppStep } from '../store'

interface NavItem {
  id: AppStep
  label: string
  icon: React.ReactNode
}

const CreateIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <circle cx="10" cy="10" r="8.5"/>
    <path d="M10 6.5v7M6.5 10h7"/>
  </svg>
)

const VideosIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <rect x="2" y="5" width="16" height="12" rx="1.5"/>
    <path d="M7.5 9l4 2-4 2V9z" fill="currentColor" stroke="none"/>
  </svg>
)

const ProjectsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <path d="M3 7h14M3 12h14M3 17h14M3 2h14"/>
  </svg>
)

const ExportIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <path d="M10 3v10M6 9l4 4 4-4"/>
    <path d="M3 15v1a1 1 0 001 1h12a1 1 0 001-1v-1"/>
  </svg>
)

const ProfileIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <circle cx="10" cy="7" r="3.5"/>
    <path d="M3 18c0-3.87 3.13-7 7-7s7 3.13 7 7"/>
  </svg>
)

export default function MobileBottomNav() {
  const currentStep = useStore((s) => s.currentStep)
  const setStep     = useStore((s) => s.setStep)

  // Only show on relevant personal steps
  const personalSteps = new Set(['projects','my-videos','setup','ideas','script','scenes','voice','export','profile','upgrade','plans'])
  const agencySteps   = new Set(['agency','agency-projects','agency-new','agency-detail','agency-team','agency-kits','agency-workflow'])
  const isAgencyStep  = agencySteps.has(currentStep)

  if (!personalSteps.has(currentStep) && !agencySteps.has(currentStep)) return null

  // Active state helpers
  const isCreate  = ['setup','ideas','script','scenes','voice'].includes(currentStep)
  const isExport  = currentStep === 'export'
  const isVideos  = currentStep === 'my-videos'
  const isProjects = currentStep === 'projects'
  const isProfile = ['profile','upgrade','plans'].includes(currentStep)

  function nav(step: AppStep) {
    setStep(step)
    // Scroll to top when switching tabs
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const items = isAgencyStep ? [
    { id: 'agency-projects', label: 'Projects', active: isAgencyStep && currentStep.startsWith('agency-project'), icon: <ProjectsIcon /> },
    { id: 'agency-new',      label: 'New',      active: currentStep === 'agency-new',     icon: <CreateIcon /> },
    { id: 'agency-team',     label: 'Team',     active: currentStep === 'agency-team',    icon: <ProfileIcon /> },
    { id: 'agency-kits',     label: 'Brand',    active: currentStep === 'agency-kits',    icon: <VideosIcon /> },
  ] : [
    { id: 'setup',     label: 'Create',   active: isCreate,   icon: <CreateIcon /> },
    { id: 'export',    label: 'Export',   active: isExport,   icon: <ExportIcon /> },
    { id: 'my-videos', label: 'Videos',   active: isVideos,   icon: <VideosIcon /> },
    { id: 'projects',  label: 'Projects', active: isProjects, icon: <ProjectsIcon /> },
    { id: 'profile',  label: 'Account',  active: isProfile,  icon: <ProfileIcon /> },
  ]

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="bg-[#111118]/95 backdrop-blur-xl border-t border-white/[0.07]">
        <div className="flex">
          {items.map(item => (
            <button
              key={item.id}
              onClick={() => nav(item.id as AppStep)}
              className="flex-1 flex flex-col items-center justify-center py-2.5 gap-1 transition-colors"
              aria-label={item.label}
            >
              <span className={`transition-colors ${
                item.active ? 'text-violet-400' : 'text-white/30'
              }`}>
                {item.icon}
              </span>
              <span className={`text-[10px] font-medium transition-colors ${
                item.active ? 'text-violet-300' : 'text-white/30'
              }`}>
                {item.label}
              </span>
              {item.active && (
                <span className="absolute bottom-0 w-8 h-0.5 bg-violet-500 rounded-full" style={{ marginTop: 'auto' }} />
              )}
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}
