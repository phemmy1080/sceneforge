import { useState, useEffect, useRef } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './authStore'
import { useStore } from './store'

import Layout from './components/Layout'
import NewProjectModal from './components/NewProjectModal'

import Landing from './pages/Landing'
import Login from './pages/Login'
import VerifyEmail from './pages/VerifyEmail'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Signup from './pages/Signup'
import Projects from './pages/Projects'
import MyVideos from './pages/Myvideos'
import Setup from './pages/Setup'
import Ideas from './pages/Ideas'
import Script from './pages/Script'
import SceneEditor from './pages/SceneEditor'
import VoiceVisuals from './pages/VoiceVisuals'
import Export from './pages/Export'
import UploadScript from './pages/UploadScript'
import Plans from './pages/Plans'
import Account from './pages/Account'
import PaymentCallback from './pages/PaymentCallback'
import ErrorBoundary from './components/ErrorBoundary'
import Blog from './pages/Blog'
import BlogPost from './pages/BlogPost'
import AuthorPage from './pages/AuthorPage'
import FeedbackModal from './components/FeedbackModal'
import ErrorToast from './components/ErrorToast'
import ChatBot from './components/ChatBot'
import AgencyDashboard from "./pages/AgencyDashboard"
import { AgencyProjects, NewProject, ProjectDetail, SuspendedScreen } from "./pages/AgencyProjects"
import { AgencyTeam, AgencyBrandKits } from "./pages/AgencyTeamAndKits"
import ClientReview from "./pages/ClientReview"
import JoinWorkspace from "./pages/JoinWorkspace"

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

type Screen = 'landing' | 'login' | 'signup' | 'verify' | 'forgot' | 'app' | 'join' | 'suspended'

function applyDeepLink(): boolean {
  const params    = new URLSearchParams(window.location.search)
  const jobId     = params.get('job_id')
  const projectId = params.get('project_id')
  const step      = params.get('step')
  if (!jobId || step !== 'export') return false
  const store = useStore.getState()
  if (projectId) store.openProject(projectId)
  store.setJobId(jobId)
  store.setRenderProgress(100, 'Done', 'complete')
  store.setStep('export')
  window.history.replaceState({}, '', '/')
  return true
}

// ── Agency workflow wrapper ──────────────────────────────────────────────────
// Keeps currentStep = 'agency-workflow' so the sidebar never flips to personal.
// Internal sub-step (setup/ideas/etc.) lives in agencyWorkflowStep.
function AgencyWorkflow() {
  const agencyWorkflowStep = useStore((s: any) => s.agencyWorkflowStep) || 'setup'
  const agencyProjectId    = useStore((s: any) => s.agencyProjectId)
  const setStep            = useStore((s) => s.setStep)

  useEffect(() => {
    if (!agencyProjectId) setStep('agency-projects' as any)
  }, [agencyProjectId])

  if (agencyWorkflowStep === 'setup')  return <Setup />
  if (agencyWorkflowStep === 'ideas')  return <Ideas />
  if (agencyWorkflowStep === 'script') return <Script />
  if (agencyWorkflowStep === 'scenes') return <SceneEditor />
  if (agencyWorkflowStep === 'voice')  return <VoiceVisuals />
  if (agencyWorkflowStep === 'export') return <Export />
  if (agencyWorkflowStep === 'upload') return <UploadScript />
  return <Setup />
}

function AppPages({ onLogout }: { onLogout: () => void }) {
  const currentStep   = useStore((s) => s.currentStep)
  const setStep       = useStore((s) => s.setStep)
  const [modalOpen, setModalOpen] = useState(false)

  const [showFeedback, setShowFeedback]       = useState(false)
  const [feedbackTrigger, setFeedbackTrigger] = useState<'video_complete'|'time_on_screen'|'manual'>('video_complete')
  const feedbackShownRef                      = useRef(false)
  const [feedbackDismissed, setFeedbackDismissed] = useState(false)

  function closeFeedback() {
    setShowFeedback(false)
    if (feedbackTrigger !== 'manual') {
      setFeedbackDismissed(true)
      setTimeout(() => setFeedbackDismissed(false), 30000)
    }
  }

  const triggerFeedbackRef = useRef<(t: 'video_complete'|'time_on_screen'|'manual') => void>()

  function triggerFeedback(t: 'video_complete'|'time_on_screen'|'manual') {
    if (t !== 'manual') {
      if (feedbackShownRef.current) return
      try {
        const today = new Date().toISOString().slice(0, 10)
        const key   = 'sceneforge:renders_today'
        const raw   = localStorage.getItem(key)
        const data  = raw ? JSON.parse(raw) : { date: today, count: 0, shown: 0 }
        if (data.date !== today) { data.date = today; data.count = 0; data.shown = 0 }
        data.count += 1
        if (data.count % 2 !== 0) { localStorage.setItem(key, JSON.stringify(data)); return }
        data.shown += 1
        localStorage.setItem(key, JSON.stringify(data))
      } catch {}
      feedbackShownRef.current = true
    }
    setFeedbackTrigger(t)
    setShowFeedback(true)
  }

  triggerFeedbackRef.current = triggerFeedback

  useEffect(() => {
    const handler = () => triggerFeedbackRef.current?.('video_complete')
    document.addEventListener('sceneforge:video-complete', handler)
    return () => document.removeEventListener('sceneforge:video-complete', handler)
  }, [])

  const isWorkflowStep = ['setup','ideas','script','scenes','voice','export'].includes(currentStep)
  useEffect(() => {
    if (!isWorkflowStep) return
    const t = setTimeout(() => triggerFeedbackRef.current?.('time_on_screen'), 3 * 60 * 1000)
    return () => clearTimeout(t)
  }, [isWorkflowStep])

  useEffect(() => {
    const handler = () => setModalOpen(true)
    document.addEventListener('open-new-project-modal', handler)
    return () => document.removeEventListener('open-new-project-modal', handler)
  }, [])

  useEffect(() => {
    const handler = () => triggerFeedbackRef.current?.('manual')
    document.addEventListener('open-feedback-modal', handler)
    return () => document.removeEventListener('open-feedback-modal', handler)
  }, [])

  return (
    <>
      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <Layout onLogout={onLogout} onNewProject={() => setModalOpen(true)}>
        {currentStep === 'projects'        && <Projects />}
        {currentStep === 'my-videos'       && <MyVideos />}
        {currentStep === 'setup'           && <Setup />}
        {currentStep === 'ideas'           && <Ideas />}
        {currentStep === 'script'          && <Script />}
        {currentStep === 'scenes'          && <SceneEditor />}
        {currentStep === 'voice'           && <VoiceVisuals />}
        {currentStep === 'export'          && <Export />}
        {currentStep === 'upload'          && <UploadScript />}
        {/* Agency workflow — same components, keeps agency sidebar context */}
        {currentStep === 'agency-workflow' && <AgencyWorkflow />}
        {currentStep === 'profile'          && <Account />}
        {currentStep === 'upgrade'         && <Plans onBack={() => setStep('setup')} />}
        {currentStep === 'plans'           && <Plans onBack={() => setStep('setup')} />}
        {currentStep === 'agency'          && <AgencyDashboard />}
        {currentStep === 'agency-projects' && <AgencyProjects />}
        {currentStep === 'agency-new'      && <NewProject />}
        {currentStep === 'agency-detail'   && <ProjectDetail />}
        {currentStep === 'agency-team'     && <AgencyTeam />}
        {currentStep === 'agency-kits'     && <AgencyBrandKits />}
      </Layout>

      {showFeedback && (
        <FeedbackModal trigger={feedbackTrigger} onClose={closeFeedback} />
      )}

      {feedbackDismissed && !showFeedback && (
        <div
          onClick={() => { setFeedbackDismissed(false); triggerFeedback('manual') }}
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 9998,
            background: 'linear-gradient(135deg,#7C5CFF,#5B3FE0)',
            color: '#fff', borderRadius: 100,
            padding: '10px 18px 10px 14px',
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(124,92,255,0.35)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H2a1 1 0 00-1 1v8a1 1 0 001 1h3l3 3 3-3h3a1 1 0 001-1V3a1 1 0 00-1-1z"/>
            <path d="M5 7h6M5 5h4"/>
          </svg>
          Share your feedback
          <button
            onClick={(e) => { e.stopPropagation(); setFeedbackDismissed(false) }}
            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', color: '#fff', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}
            aria-label="Dismiss"
          >x</button>
        </div>
      )}
      <ErrorToast />
      <ChatBot />
    </>
  )
}

function Root() {
  const [pathname, setPathname] = useState(window.location.pathname)

  useEffect(() => {
    const handler = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', handler)
    const origPush = window.history.pushState.bind(window.history)
    window.history.pushState = (...args) => {
      origPush(...args)
      setPathname(window.location.pathname)
    }
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const currentUser     = useAuthStore((s: any) => s.user)
  const setAuth         = useAuthStore((s: any) => s.setAuth)
  const authToken       = useAuthStore((s: any) => s.token)
  const logout          = useAuthStore((s) => s.logout)

  // Always refresh /me on load — picks up suspension, role changes, workspace changes
  // without this, a suspended user keeps stale workspace_suspended=false from localStorage
  useEffect(() => {
    if (!isAuthenticated || !authToken) return
    import('./lib/api').then(({ getMe }) => {
      getMe()
        .then(me => setAuth(me, authToken))
        .catch(() => {
          // If /me fails with 401, the token is invalid — log out
        })
    })
  }, [isAuthenticated])

  // Watch for suspension — fires when /me returns with workspace_suspended=true
  useEffect(() => {
    if (!isAuthenticated || !currentUser?.workspace_suspended) return
    const step = useStore.getState().currentStep
    const isInAgencyMode = step.startsWith('agency') || step === 'agency-workflow'
    const hasPersonalPlan = currentUser?.plan && currentUser.plan !== 'free'
      ? true
      : !currentUser?.workspace_role || currentUser?.workspace_role === 'owner'

    if (isInAgencyMode) {
      // They're actively in agency mode — remove them from it
      useStore.getState().setAgencyProjectId('')
      if (currentUser?.plan && currentUser.plan !== 'none') {
        // Has a personal plan — go to personal workspace silently
        useStore.getState().setStep('projects' as any)
      } else {
        // No personal workspace — show the suspended screen
        setScreen('suspended' as Screen)
      }
    }
    // If they're already in personal mode, let them stay — don't disrupt
  }, [currentUser?.workspace_suspended, isAuthenticated])

  // Handle ?agency_project=ID deep link from approval notification emails
  useEffect(() => {
    if (!isAuthenticated) return
    const params = new URLSearchParams(window.location.search)
    const projId = params.get('agency_project')
    if (projId) {
      window.history.replaceState({}, '', '/')
      useStore.getState().setAgencyProjectId(projId)
      useStore.getState().setStep('agency-detail' as any)
    }
  }, [isAuthenticated])

  const [screen, setScreen] = useState<Screen>(() => {
    // /join link — handle before anything else
    if (window.location.pathname === '/join') {
      const p = new URLSearchParams(window.location.search)
      if (p.get('token')) return 'join'
    }
    const hasDeepLink = window.location.search.includes('step=export') &&
                        window.location.search.includes('job_id=')
    if (hasDeepLink && isAuthenticated) { applyDeepLink(); return 'app' }
    if (hasDeepLink && !isAuthenticated) {
      sessionStorage.setItem('pending_deep_link', window.location.search)
      window.history.replaceState({}, '', '/')
      return 'login'
    }
    return isAuthenticated ? 'app' : 'landing'
  })

  const [pendingEmail, setPendingEmail] = useState('')

  function handleLogout() { logout(); setScreen('landing') }

  function handleLoginSuccess() {
    const pending = sessionStorage.getItem('pending_deep_link')
    if (pending) {
      sessionStorage.removeItem('pending_deep_link')
      const params    = new URLSearchParams(pending)
      const jobId     = params.get('job_id')
      const projectId = params.get('project_id')
      const store     = useStore.getState()
      if (projectId) store.openProject(projectId)
      if (jobId) {
        store.setJobId(jobId)
        store.setRenderProgress(100, 'Done', 'complete')
        store.setStep('export')
      }
    }
    setScreen('app')
  }

  // ── Public routes (no auth state needed) ─────────────────────────────────
  if (pathname === '/blog')                  return <Blog />
  if (pathname.startsWith('/blog/author/'))  return <AuthorPage authorSlug={pathname.replace('/blog/author/', '').replace(/\/+$/, '')} />
  if (pathname.startsWith('/blog/'))         return <BlogPost slug={pathname.replace('/blog/', '').replace(/\/+$/, '')} />
  if (pathname === '/payment/callback')      return <PaymentCallback />
  if (pathname === '/reset-password')        return <ResetPassword onSuccess={() => { window.history.replaceState({}, '', '/'); window.location.href = '/' }} />
  if (pathname.startsWith('/review/'))       return <ClientReview token={pathname.replace('/review/', '').replace(/\/+$/, '')} />

  // ── Join workspace link ───────────────────────────────────────────────────
  if (screen === 'join' || pathname === '/join') {
    const joinToken = new URLSearchParams(window.location.search).get('token') || ''
    return (
      <JoinWorkspace
        token={joinToken}
        onJoined={() => {
          window.history.replaceState({}, '', '/')
          setPathname('/')
          useStore.getState().setStep('agency' as any)
          setScreen('app')
        }}
      />
    )
  }

  // ── Suspended screen ─────────────────────────────────────────────────────
  if (screen === 'suspended') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <SuspendedScreen
        currentUser={currentUser}
        onGoPersonal={() => {
          useStore.getState().setAgencyProjectId('')
          useStore.getState().setStep('projects' as any)
          setScreen('app')
        }}
        onSignOut={() => { logout(); setScreen('login'); }}
      />
    </div>
  )

  // ── Auth screens ──────────────────────────────────────────────────────────
  if (screen === 'landing') return <Landing onLogin={() => setScreen('login')} onSignup={() => setScreen('signup')} />
  if (screen === 'login')   return <Login
                                     onSuccess={handleLoginSuccess}
                                     onSignup={() => setScreen('signup')}
                                     onLanding={() => setScreen('landing')}
                                     onForgot={() => setScreen('forgot')}
                                     onVerify={(email) => { setPendingEmail(email); setScreen('verify') }}
                                   />
  if (screen === 'verify')  return <VerifyEmail email={pendingEmail} onVerified={() => setScreen('app')} />
  if (screen === 'forgot')  return <ForgotPassword onBack={() => setScreen('login')} />
  if (screen === 'signup')  return <Signup
                                     onSuccess={(email?: string) => {
                                       if (email) { setPendingEmail(email); setScreen('verify') }
                                       else { setScreen('app') }
                                     }}
                                     onLogin={() => setScreen('login')}
                                   />

  return <AppPages onLogout={handleLogout} />
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Root />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
