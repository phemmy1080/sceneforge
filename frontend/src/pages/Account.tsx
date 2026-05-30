import { useState } from 'react'
import { useStore } from '../store'
import { useAuthStore } from '../authStore'
import { PageHeader } from '../components/ui'

export default function Account() {
  const setStep   = useStore((s) => s.setStep)
  const user      = useAuthStore((s) => s.user)
  const logout    = useAuthStore((s) => s.logout)
  const [loggingOut, setLoggingOut] = useState(false)

  const plan      = user?.plan || 'free'
  const tokens    = user?.tokens_remaining ?? 0
  const videos    = user?.videos_created ?? 0
  const email     = user?.email || ''
  const name      = user?.full_name || email.split('@')[0] || 'User'
  const initials  = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()

  const PLAN_LABEL: Record<string, string> = {
    free: 'Free', starter: 'Starter', pro: 'Pro', studio: 'Studio', agency: 'Agency'
  }
  const PLAN_COLOR: Record<string, string> = {
    free: 'text-white/40', starter: 'text-violet-400',
    pro: 'text-teal-400', studio: 'text-amber-400', agency: 'text-rose-400'
  }
  const PLAN_VIDEOS: Record<string, number> = {
    free: 0, starter: 5, pro: 12, studio: 35, agency: 500
  }

  const videosInPlan = PLAN_VIDEOS[plan] || 0
  const tokensUsedPct = videosInPlan > 0
    ? Math.max(0, Math.min(100, 100 - (tokens / (videosInPlan * 100)) * 100))
    : 0

  async function handleLogout() {
    setLoggingOut(true)
    await logout()
    setStep('projects' as any)
  }

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mb-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">{title}</p>
      <div className="bg-[#111118] border border-white/[0.07] rounded-xl overflow-hidden">
        {children}
      </div>
    </div>
  )

  const Row = ({ icon, label, value, onClick, accent, danger }: {
    icon: string; label: string; value?: string
    onClick?: () => void; accent?: boolean; danger?: boolean
  }) => (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.05] last:border-0 transition-colors text-left
        ${onClick ? 'hover:bg-white/[0.04] active:bg-white/[0.06]' : 'cursor-default'}
        ${danger ? 'hover:bg-rose-500/5' : ''}`}
    >
      <span className="text-[18px] flex-shrink-0">{icon}</span>
      <span className={`flex-1 text-[13.5px] font-medium ${danger ? 'text-rose-400' : 'text-white/80'}`}>{label}</span>
      {value && (
        <span className={`text-[12.5px] font-medium flex-shrink-0 ${accent ? PLAN_COLOR[plan] : 'text-white/35'}`}>
          {value}
        </span>
      )}
      {onClick && !danger && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
          strokeWidth="1.8" className="text-white/20 flex-shrink-0">
          <path d="M5 3l4 4-4 4"/>
        </svg>
      )}
    </button>
  )

  return (
    <div className="pb-4">
      <PageHeader title="Account" subtitle="Manage your SceneForge account" />

      {/* Avatar + name */}
      <div className="flex items-center gap-4 mb-6 p-4 bg-[#111118] border border-white/[0.07] rounded-xl">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-teal-500 flex items-center justify-center text-white font-black text-lg flex-shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-white/90 truncate">{name}</p>
          <p className="text-[12px] text-white/40 truncate">{email}</p>
          <span className={`text-[11px] font-bold uppercase tracking-wider ${PLAN_COLOR[plan]}`}>
            {PLAN_LABEL[plan]} plan
          </span>
        </div>
      </div>

      {/* Token balance */}
      <div className="mb-5 bg-[#111118] border border-white/[0.07] rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12px] font-semibold text-white/60">Token balance</p>
          <p className="text-[13px] font-bold text-white/85">{tokens.toLocaleString()} tokens</p>
        </div>
        <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-teal-500 rounded-full transition-all"
            style={{ width: `${Math.max(2, 100 - tokensUsedPct)}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-white/30">
          <span>{videos} video{videos !== 1 ? 's' : ''} created</span>
          <span>≈ {Math.floor(tokens / 100)} renders left</span>
        </div>
      </div>

      {/* Plan & billing */}
      <Section title="Plan & billing">
        <Row icon="⭐" label="Current plan" value={PLAN_LABEL[plan]} accent onClick={() => setStep('plans')} />
        <Row icon="🎬" label="Videos created" value={String(videos)} />
        <Row icon="💰" label="Top up tokens" onClick={() => setStep('plans')} />
      </Section>

      {/* Content */}
      <Section title="Studio">
        <Row icon="🎥" label="My Videos" onClick={() => setStep('my-videos')} />
        <Row icon="📁" label="My Projects" onClick={() => setStep('projects')} />
        <Row icon="➕" label="New Video" onClick={() => setStep('setup')} />
      </Section>

      {/* Account */}
      <Section title="Settings">
        <Row icon="👤" label="Edit profile"
          onClick={() => document.dispatchEvent(new CustomEvent('open-profile-modal'))} />
        <Row icon="🔔" label="Notifications"
          onClick={() => document.dispatchEvent(new CustomEvent('open-notifications-modal'))} />
        <Row icon="💬" label="Send feedback"
          onClick={() => document.dispatchEvent(new CustomEvent('open-feedback-modal'))} />
      </Section>

      {/* Logout */}
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
