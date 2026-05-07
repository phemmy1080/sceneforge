import { useState, useEffect } from 'react'
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
import Setup from './pages/Setup'
import Ideas from './pages/Ideas'
import Script from './pages/Script'
import SceneEditor from './pages/SceneEditor'
import VoiceVisuals from './pages/VoiceVisuals'
import Export from './pages/Export'
import UploadScript from './pages/UploadScript'
import Upgrade from './pages/Upgrade'
import Plans from './pages/Plans'
import PaymentCallback from './pages/PaymentCallback'
import ErrorBoundary from './components/ErrorBoundary'
import ToastContainer from './components/ToastContainer'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

type Screen = 'landing' | 'login' | 'signup' | 'verify' | 'forgot' | 'app'

// ── Deep link handler — runs once at startup ──────────────────────────────────
// Handles links from render complete emails:
// https://sceneforge.com?job_id=xxx&project_id=proj_xxx&step=export
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

  // Clean URL so refresh doesn't re-apply
  window.history.replaceState({}, '', '/')
  return true
}

function AppPages({ onLogout }: { onLogout: () => void }) {
  const currentStep = useStore((s) => s.currentStep)
  const setStep     = useStore((s) => s.setStep)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    const handler = () => setModalOpen(true)
    document.addEventListener('open-new-project-modal', handler)
    return () => document.removeEventListener('open-new-project-modal', handler)
  }, [])

  return (
    <>
      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <Layout onLogout={onLogout} onNewProject={() => setModalOpen(true)}>
        {currentStep === 'projects' && <Projects />}
        {currentStep === 'setup'    && <Setup />}
        {currentStep === 'ideas'    && <Ideas />}
        {currentStep === 'script'   && <Script />}
        {currentStep === 'scenes'   && <SceneEditor />}
        {currentStep === 'voice'    && <VoiceVisuals />}
        {currentStep === 'export'   && <Export />}
        {currentStep === 'upload'   && <UploadScript />}
        {currentStep === 'upgrade'  && <Plans onBack={() => setStep('setup')} />}
        {currentStep === 'plans'    && <Plans onBack={() => setStep('setup')} />}
      </Layout>
    </>
  )
}

function Root() {
  // Special URL routes — check before any hooks
  if (window.location.pathname === '/payment/callback') {
    return <PaymentCallback />
  }
  if (window.location.pathname === '/reset-password') {
    return <ResetPassword onSuccess={() => {
      window.history.replaceState({}, '', '/')
      window.location.href = '/'
    }} />
  }

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const logout          = useAuthStore((s) => s.logout)
  const [screen, setScreen]             = useState<Screen>(() => {
    // Apply deep link on first render — determines initial screen
    const hasDeepLink = window.location.search.includes('step=export') &&
                        window.location.search.includes('job_id=')
    if (hasDeepLink && isAuthenticated) {
      applyDeepLink()
      return 'app'
    }
    if (hasDeepLink && !isAuthenticated) {
      // Store params so we can restore after login
      sessionStorage.setItem('pending_deep_link', window.location.search)
      window.history.replaceState({}, '', '/')
      return 'login'
    }
    return isAuthenticated ? 'app' : 'landing'
  })
  const [pendingEmail, setPendingEmail] = useState('')

  function handleLogout() { logout(); setScreen('landing') }

  function handleLoginSuccess() {
    // Check if we have a pending deep link from email
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
        <ToastContainer />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
