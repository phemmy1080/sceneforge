import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { useAuthStore } from '../authStore'
import { api } from '../lib/api'
import { PageHeader } from '../components/ui'

export default function Account() {
  const setStep            = useStore((s) => s.setStep)
  const agencyProjectId    = useStore((s) => s.agencyProjectId)
  const user               = useAuthStore((s) => s.user)
  const updateUser         = useAuthStore((s) => s.updateUser)
  const logout             = useAuthStore((s) => s.logout)

  // ── state ────────────────────────────────────────────────────────────────────
  const [loggingOut,   setLoggingOut]   = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileName,  setProfileName]  = useState(user?.full_name || '')
  const [profileEmail, setProfileEmail] = useState(user?.email || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSaved, setProfileSaved] = useState(false)

  // Notification prefs (stored in localStorage — push backend TBD)
  const [notifRenderDone, setNotifRenderDone] = useState(
    () => localStorage.getItem('notif_render_done') !== 'false'
  )
  const [notifLowTokens, setNotifLowTokens] = useState(
    () => localStorage.getItem('notif_low_tokens') !== 'false'
  )
  const [notifUpdates, setNotifUpdates] = useState(
    () => localStorage.getItem('notif_updates') === 'true'
  )
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default')

  useEffect(() => {
    if ('Notification' in window) setPushPermission(Notification.permission)
  }, [])

  // ── derived ──────────────────────────────────────────────────────────────────
  const plan      = user?.plan       || 'free'
  const tokens    = user?.tokens_remaining ?? 0
  const videos    = user?.videos_created   ?? 0
  const email     = user?.email      || ''
  const name      = user?.full_name  || email.split('@')[0] || 'User'
  const initials  = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()

  const wsRole    = user?.workspace_role as string | undefined
  const wsId      = user?.workspace_id  as string | undefined
  const wsName    = (user as any)?.workspace_name as string | undefined
  const inAgency  = !!(wsId && wsRole)
  const canSwitch = inAgency && wsRole !== 'client'
  const isAgencyMode = !!(agencyProjectId) || (inAgency && !['projects','my-videos','setup','ideas','script','scenes','voice','export','upgrade','plans','profile'].includes(useStore.getState().currentStep))

  const PLAN_LABEL: Record<string, string> = {
    free: 'Free', starter: 'Starter', pro: 'Pro', studio: 'Studio', agency: 'Agency'
  }
  const PLAN_COLOR: Record<string, string> = {
    free: 'text-white/40', starter: 'text-violet-400',
    pro: 'text-teal-400', studio: 'text-amber-400', agency: 'text-rose-400'
  }

  // ── actions ──────────────────────────────────────────────────────────────────
  function switchToAgency() {
    setStep('agency' as any)
  }

  function switchToPersonal() {
    const store = useStore.getState()
    store.setAgencyProjectId('')
    store.setConfig({
      niche: '', style: '', platform: 'TikTok', tone: '', audience: '',
      context: '', ideaHints: '', ideaTags: [], objective: '',
      duration_hint: 60, scene_count_hint: 8, client_brief: '',
    } as any)
    if ((store as any).setAgencyWorkflowStep) (store as any).setAgencyWorkflowStep('setup')
    setStep('projects' as any)
    store.loadProjectsFromBackend()
  }

  async function saveProfile() {
    if (!profileName.trim()) { setProfileError('Name is required'); return }
    setSavingProfile(true); setProfileError('')
    try {
      await api.patch('/api/auth/me', { full_name: profileName.trim(), email: profileEmail.trim() })
      const meRes = await api.get('/api/auth/me')
      updateUser(meRes.data)
      setProfileSaved(true)
      setTimeout(() => { setProfileSaved(false); setEditingProfile(false) }, 1500)
    } catch (e: any) {
      setProfileError(e?.response?.data?.detail || 'Could not save. Please try again.')
    } finally {
      setSavingProfile(false)
    }
  }

  async function requestPushPermission() {
    if (!('Notification' in window)) return
    const result = await Notification.requestPermission()
    setPushPermission(result)
  }

  function toggleNotif(key: string, val: boolean, setter: (v: boolean) => void) {
    setter(val)
    localStorage.setItem(key, String(val))
  }

  async function handleLogout() {
    setLoggingOut(true)
    try {
      logout()
      // In PWA/standalone mode a full reload is the cleanest way to reset
      // all state and let App.tsx's auth guard redirect to landing.
      // The service worker will serve the cached shell immediately.
      window.location.href = '/'
    } catch {
      setLoggingOut(false)
    }
  }

  // ── sub-components ───────────────────────────────────────────────────────────
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mb-4">
      {title && <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">{title}</p>}
      <div className="bg-[#111118] border border-white/[0.07] rounded-xl overflow-hidden">
        {children}
      </div>
    </div>
  )

  const Row = ({ icon, label, value, sub, onClick, accent, danger, right }: {
    icon: string; label: string; value?: string; sub?: string
    onClick?: () => void; accent?: boolean; danger?: boolean
    right?: React.ReactNode
  }) => (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 border-b border-white/[0.05] last:border-0 transition-colors text-left
        ${onClick ? 'hover:bg-white/[0.04] active:bg-white/[0.06] cursor-pointer' : 'cursor-default'}
        ${danger ? 'hover:bg-rose-500/5' : ''}`}
    >
      <span className="text-[17px] flex-shrink-0 w-6 text-center">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className={`text-[13.5px] font-medium block ${danger ? 'text-rose-400' : 'text-white/80'}`}>{label}</span>
        {sub && <span className="text-[11px] text-white/30">{sub}</span>}
      </div>
      {right && <div className="flex-shrink-0">{right}</div>}
      {value && <span className={`text-[12.5px] font-medium flex-shrink-0 ${accent ? PLAN_COLOR[plan] : 'text-white/35'}`}>{value}</span>}
      {onClick && !danger && !right && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-white/20 flex-shrink-0">
          <path d="M5 3l4 4-4 4"/>
        </svg>
      )}
    </button>
  )

  const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!value) }}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-violet-500' : 'bg-white/[0.12]'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )

  return (
    <div className="pb-4">
      <PageHeader title="Account" subtitle="Your SceneForge account" />

      {/* Avatar + name card */}
      <div className="flex items-center gap-4 mb-4 p-4 bg-[#111118] border border-white/[0.07] rounded-xl">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-teal-500 flex items-center justify-center text-white font-black text-lg flex-shrink-0 font-display">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-white/90 truncate">{name}</p>
          <p className="text-[12px] text-white/40 truncate">{email}</p>
          <span className={`text-[11px] font-bold uppercase tracking-wider ${PLAN_COLOR[plan]}`}>
            {PLAN_LABEL[plan]} plan
          </span>
        </div>
        <button
          onClick={() => { setEditingProfile(!editingProfile); setProfileName(user?.full_name||''); setProfileEmail(user?.email||''); setProfileError('') }}
          className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/10 text-white/60 text-[12px] rounded-lg transition-colors flex-shrink-0"
        >
          Edit
        </button>
      </div>

      {/* Edit profile inline form */}
      {editingProfile && (
        <div className="mb-4 bg-[#111118] border border-violet-500/25 rounded-xl p-4">
          <p className="text-[12px] font-semibold text-white/60 mb-3">Edit profile</p>
          <div className="space-y-2.5">
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-1">Full name</label>
              <input
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                placeholder="Your name"
                className="w-full bg-[#0d0d14] border border-white/[0.08] rounded-lg px-3 py-2.5 text-[13.5px] text-white/85 placeholder-white/20 focus:outline-none focus:border-violet-500/50"
              />
            </div>
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-1">Email</label>
              <input
                value={profileEmail}
                onChange={e => setProfileEmail(e.target.value)}
                type="email"
                placeholder="you@example.com"
                className="w-full bg-[#0d0d14] border border-white/[0.08] rounded-lg px-3 py-2.5 text-[13.5px] text-white/85 placeholder-white/20 focus:outline-none focus:border-violet-500/50"
              />
            </div>
          </div>
          {profileError && <p className="text-[11.5px] text-rose-400 mt-2">{profileError}</p>}
          {profileSaved && <p className="text-[11.5px] text-teal-400 mt-2">✓ Profile saved</p>}
          <div className="flex gap-2 mt-3">
            <button
              onClick={saveProfile}
              disabled={savingProfile}
              className="flex-1 py-2.5 bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white text-[13px] font-semibold rounded-xl transition-colors"
            >
              {savingProfile ? 'Saving…' : 'Save changes'}
            </button>
            <button
              onClick={() => setEditingProfile(false)}
              className="px-4 py-2.5 bg-white/[0.06] text-white/50 text-[13px] rounded-xl"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Token balance */}
      <div className="mb-4 bg-[#111118] border border-white/[0.07] rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12px] font-semibold text-white/60">Token balance</p>
          <p className="text-[13px] font-bold text-white/85">{tokens.toLocaleString()} tokens</p>
        </div>
        <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-teal-500 rounded-full"
            style={{ width: `${Math.min(100, Math.max(2, (tokens / 500) * 100))}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-white/30">
          <span>{videos} video{videos !== 1 ? 's' : ''} created</span>
          <span>≈ {Math.floor(tokens / 100)} renders left</span>
        </div>
      </div>

      {/* Mode switcher — only for agency members who can switch */}
      {inAgency && canSwitch && (
        <Section title="Workspace">
          <div className="px-4 py-3 border-b border-white/[0.05]">
            <p className="text-[11px] text-white/35 mb-2.5">You're a member of an agency workspace. Switch context:</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={switchToAgency}
                className={`py-2.5 px-3 rounded-xl text-[12.5px] font-semibold border transition-all ${
                  isAgencyMode
                    ? 'bg-amber-500/12 border-amber-500/30 text-amber-300'
                    : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-white/70'
                }`}
              >
                🏢 {wsName || 'Agency'}
                {isAgencyMode && <span className="block text-[10px] font-normal mt-0.5 opacity-70">{wsRole}</span>}
              </button>
              <button
                onClick={switchToPersonal}
                className={`py-2.5 px-3 rounded-xl text-[12.5px] font-semibold border transition-all ${
                  !isAgencyMode
                    ? 'bg-violet-500/12 border-violet-500/30 text-violet-300'
                    : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-white/70'
                }`}
              >
                👤 Personal
                {!isAgencyMode && <span className="block text-[10px] font-normal mt-0.5 opacity-70">personal studio</span>}
              </button>
            </div>
          </div>
        </Section>
      )}

      {/* Plan & quick nav */}
      <Section title="Studio">
        <Row icon="⭐" label="Plan & billing" value={PLAN_LABEL[plan]} accent onClick={() => setStep('plans')} />
        <Row icon="🎥" label="My Videos" onClick={() => setStep('my-videos')} />
        <Row icon="📁" label="My Projects" onClick={() => setStep('projects')} />
        <Row icon="➕" label="Create new video" onClick={() => setStep('setup')} />
      </Section>

      {/* Notifications */}
      <Section title="Notifications">
        {/* Push permission banner */}
        {pushPermission === 'default' && (
          <div className="px-4 py-3 border-b border-white/[0.05] bg-violet-500/[0.05]">
            <p className="text-[12px] text-white/60 mb-2">Enable push notifications to get alerted when your video finishes rendering</p>
            <button
              onClick={requestPushPermission}
              className="px-3 py-1.5 bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[12px] font-semibold rounded-lg"
            >
              Enable notifications
            </button>
          </div>
        )}
        {pushPermission === 'denied' && (
          <div className="px-4 py-3 border-b border-white/[0.05]">
            <p className="text-[11.5px] text-white/35">Notifications blocked. Enable in your browser settings to receive render alerts.</p>
          </div>
        )}
        <Row
          icon="🎬" label="Render complete"
          sub="Notify when your video is ready to download"
          right={<Toggle value={notifRenderDone} onChange={v => toggleNotif('notif_render_done', v, setNotifRenderDone)} />}
        />
        <Row
          icon="⚠️" label="Low token balance"
          sub="Alert when you have fewer than 200 tokens left"
          right={<Toggle value={notifLowTokens} onChange={v => toggleNotif('notif_low_tokens', v, setNotifLowTokens)} />}
        />
        <Row
          icon="🆕" label="SceneForge updates"
          sub="New features and product announcements"
          right={<Toggle value={notifUpdates} onChange={v => toggleNotif('notif_updates', v, setNotifUpdates)} />}
        />
      </Section>

      {/* Support */}
      <Section title="Support">
        <Row icon="💬" label="Send feedback" onClick={() => document.dispatchEvent(new CustomEvent('open-feedback-modal'))} />
        <Row icon="📖" label="Help & docs" onClick={() => window.open('https://docs.sceneforge.com', '_blank')} />
      </Section>

      {/* Sign out */}
      <Section title="">
        <Row
          icon={loggingOut ? '⏳' : '🚪'}
          label={loggingOut ? 'Signing out…' : 'Sign out'}
          onClick={loggingOut ? undefined : handleLogout}
          danger
        />
      </Section>
    </div>
  )
}
