import { useState, useEffect } from 'react'
import { api, login, signup } from '../lib/api'
import { useAuthStore } from '../authStore'
import { useStore } from '../store'

interface Props {
  token: string
  onJoined: () => void   // called after successful join → goes to app
}

interface InvitePreview {
  workspace_name: string
  inviter_name: string
  role: string
  email: string
}

type JoinStep = 'loading' | 'invalid' | 'preview' | 'login' | 'signup' | 'joining' | 'done'

export default function JoinWorkspace({ token, onJoined }: Props) {
  const setAuth = useAuthStore((s: any) => s.setAuth)
  const isAuthenticated = useAuthStore((s: any) => s.isAuthenticated)

  const [step, setStep] = useState<JoinStep>('loading')
  const [invite, setInvite] = useState<InvitePreview | null>(null)
  const [error, setError] = useState('')

  // Login form
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPass, setLoginPass]   = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  // Signup form
  const [signupName, setSignupName]   = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPass, setSignupPass]   = useState('')
  const [signupLoading, setSignupLoading] = useState(false)

  useEffect(() => { loadInvite() }, [token])

  // ── Step 1: Load invite preview ──────────────────────────────────────────
  async function loadInvite() {
    try {
      const res = await api.get(`/api/agency/workspace/invite/preview/${token}`)
      setInvite(res.data)
      // Pre-fill email fields with invite email
      setLoginEmail(res.data.email || '')
      setSignupEmail(res.data.email || '')

      // If already logged in, try to accept immediately
      if (isAuthenticated) {
        await acceptInvite()
      } else {
        setStep('preview')
      }
    } catch (e: any) {
      const detail = e.response?.data?.detail || ''
      if (detail.includes('expired') || detail.includes('not found')) {
        setStep('invalid')
        setError('This invite link has expired or already been used.')
      } else {
        setStep('invalid')
        setError(detail || 'Failed to load invite.')
      }
    }
  }

  // ── Step 2: Accept invite (user must be logged in) ───────────────────────
  async function acceptInvite() {
    setStep('joining')
    try {
      await api.post(`/api/agency/workspace/join/${token}`)
      setStep('done')
      // Small delay so user sees the success screen, then navigate
      setTimeout(() => {
        onJoined()
      }, 1200)
    } catch (e: any) {
      const detail = e.response?.data?.detail || 'Failed to join workspace'
      // Already in a workspace — still go to app
      if (detail.includes('already belong')) {
        // Already in a workspace — just go to app
        setTimeout(() => onJoined(), 800)
        return
      }
      setError(detail)
      setStep('preview')
    }
  }

  // ── Login then accept ────────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoginLoading(true)
    setError('')
    try {
      const res = await login(loginEmail, loginPass)
      setAuth(res.user, res.access_token)
      await acceptInvite()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed. Check your credentials.')
      setLoginLoading(false)
    }
  }

  // ── Signup then accept ───────────────────────────────────────────────────
  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (!signupName.trim() || !signupEmail.trim() || !signupPass) {
      setError('All fields are required')
      return
    }
    setSignupLoading(true)
    setError('')
    try {
      const res = await signup(signupName, signupEmail, signupPass)
      if (res.access_token) {
        setAuth(res.user, res.access_token)
        await acceptInvite()
      } else {
        // Email verification required
        setError('Account created — please verify your email, then come back to this link.')
        setSignupLoading(false)
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Signup failed.')
      setSignupLoading(false)
    }
  }

  // ── Renders ──────────────────────────────────────────────────────────────
  const ROLE_LABEL: Record<string, string> = {
    editor: 'Editor — can create and edit videos',
    admin:  'Admin — can manage team',
    client: 'Client — can view and comment',
  }

  if (step === 'loading' || step === 'joining') return (
    <div className="min-h-screen bg-[#07070e] flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-white/40 text-sm">
          {step === 'joining' ? 'Joining workspace…' : 'Loading invite…'}
        </p>
      </div>
    </div>
  )

  if (step === 'done') return (
    <div className="min-h-screen bg-[#07070e] flex items-center justify-center px-4">
      <div className="text-center space-y-4">
        <div className="text-6xl">🎉</div>
        <h1 className="text-2xl font-extrabold text-white">You're in!</h1>
        <p className="text-white/40 text-sm">
          Joining <strong className="text-white/70">{invite?.workspace_name}</strong>…
        </p>
        <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  )

  if (step === 'invalid') return (
    <div className="min-h-screen bg-[#07070e] flex items-center justify-center px-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="text-5xl">🔗</div>
        <h1 className="text-xl font-bold text-white">Invite expired</h1>
        <p className="text-white/40 text-sm leading-relaxed">
          {error || 'This invite link has expired or already been used. Ask the workspace owner to send a new one.'}
        </p>
        <a href="/" className="inline-block mt-2 text-amber-400 hover:underline text-sm">
          Go to SceneForge →
        </a>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#07070e] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-5">

        {/* Brand */}
        <div className="text-center mb-2">
          <div className="text-xl font-extrabold tracking-tight text-white mb-1">
            Scene<span className="text-amber-400">Forge</span>
          </div>
        </div>

        {/* Invite card */}
        {invite && (
          <div className="bg-amber-400/[0.07] border border-amber-400/20 rounded-2xl p-5 text-center space-y-2">
            <div className="text-2xl">🏢</div>
            <div className="text-white font-bold text-lg">{invite.workspace_name}</div>
            <p className="text-white/50 text-sm">
              <strong className="text-white/70">{invite.inviter_name}</strong> invited you to join as
            </p>
            <div className="inline-block bg-amber-400/15 border border-amber-400/25 text-amber-300 text-xs font-bold px-3 py-1.5 rounded-full">
              {ROLE_LABEL[invite.role] || invite.role}
            </div>
          </div>
        )}

        {/* Auth choice — preview step */}
        {step === 'preview' && (
          <div className="space-y-3">
            <button
              onClick={() => setStep('login')}
              className="w-full bg-amber-400 hover:bg-amber-300 active:scale-95 text-black font-bold py-3.5 rounded-xl text-sm transition-all shadow-lg shadow-amber-400/20">
              I already have an account — Log in
            </button>
            <button
              onClick={() => setStep('signup')}
              className="w-full bg-white/[0.06] border border-white/[0.1] hover:border-white/[0.2] text-white font-semibold py-3.5 rounded-xl text-sm transition">
              I'm new — Create account
            </button>
          </div>
        )}

        {/* Login form */}
        {step === 'login' && (
          <form onSubmit={handleLogin} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 space-y-4">
            <div className="text-white font-bold text-sm mb-1">Log in to join</div>
            <Field label="Email">
              <input type="email" required value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                className={INPUT} placeholder="your@email.com" />
            </Field>
            <Field label="Password">
              <input type="password" required value={loginPass}
                onChange={e => setLoginPass(e.target.value)}
                className={INPUT} placeholder="••••••••" />
            </Field>
            {error && <p className="text-rose-400 text-xs">{error}</p>}
            <button type="submit" disabled={loginLoading}
              className="w-full bg-amber-400 hover:bg-amber-300 text-black font-bold py-3 rounded-xl text-sm transition shadow-md shadow-amber-400/20 disabled:opacity-50">
              {loginLoading ? 'Logging in…' : 'Log in & join workspace'}
            </button>
            <button type="button" onClick={() => { setStep('preview'); setError(''); }}
              className="w-full text-white/30 hover:text-white text-xs transition py-1">
              ← Back
            </button>
          </form>
        )}

        {/* Signup form */}
        {step === 'signup' && (
          <form onSubmit={handleSignup} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 space-y-4">
            <div className="text-white font-bold text-sm mb-1">Create an account to join</div>
            <Field label="Your name">
              <input type="text" required value={signupName}
                onChange={e => setSignupName(e.target.value)}
                className={INPUT} placeholder="Jane Smith" />
            </Field>
            <Field label="Email">
              <input type="email" required value={signupEmail}
                onChange={e => setSignupEmail(e.target.value)}
                className={INPUT} placeholder="your@email.com" />
            </Field>
            <Field label="Password">
              <input type="password" required minLength={8} value={signupPass}
                onChange={e => setSignupPass(e.target.value)}
                className={INPUT} placeholder="Min 8 characters" />
            </Field>
            {error && <p className="text-rose-400 text-xs">{error}</p>}
            <button type="submit" disabled={signupLoading}
              className="w-full bg-amber-400 hover:bg-amber-300 text-black font-bold py-3 rounded-xl text-sm transition shadow-md shadow-amber-400/20 disabled:opacity-50">
              {signupLoading ? 'Creating account…' : 'Create account & join workspace'}
            </button>
            <button type="button" onClick={() => { setStep('preview'); setError(''); }}
              className="w-full text-white/30 hover:text-white text-xs transition py-1">
              ← Back
            </button>
          </form>
        )}

        <p className="text-center text-white/20 text-xs">
          By joining you agree to SceneForge's terms of service.
        </p>
      </div>
    </div>
  )
}

const INPUT = "w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-white/35 uppercase tracking-widest mb-1.5">{label}</label>
      {children}
    </div>
  )
}
