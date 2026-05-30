import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../authStore'
import { updateMe, getMe } from '../lib/api'
import { useStore } from '../store'
import type React from 'react'

interface UserMenuProps {
  onLogout: () => void
}

export default function UserMenu({ onLogout }: UserMenuProps) {
  const user       = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s: any) => s.updateUser)
  const setAuth    = useAuthStore((s: any) => s.setAuth)
  const logout     = useAuthStore((s) => s.logout)
  const setStep    = useStore((s) => s.setStep)

  const [open, setOpen]         = useState(false)
  const [editing, setEditing]   = useState(false)
  const [editName, setEditName]   = useState(user?.full_name ?? '')
  const [editEmail, setEditEmail] = useState(user?.email ?? '')
  const [saving, setSaving]     = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // ── Derive context ──────────────────────────────────────────────────────────
  const wsRole   = user?.workspace_role  // 'owner' | 'admin' | 'editor' | 'client' | null
  const wsId     = user?.workspace_id
  const inAgency = !!(wsId && wsRole)
  // Any non-client workspace member can switch to personal studio.
  // Editors/admins may have 0 personal tokens/projects but still have a personal account.
  const canSwitch = inAgency && wsRole !== 'client'
  const isOwner   = wsRole === 'owner'
  // Current mode: editors/admins/clients are always in agency mode
  const currentMode = useStore((s) => s.currentStep)
  const isAgencyMode = currentMode.startsWith('agency')

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setEditing(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Refresh user after render completes
  useEffect(() => {
    const handler = async () => {
      try { const u = await getMe(); updateUser(u) } catch {}
    }
    document.addEventListener('sceneforge:render-complete', handler)
    return () => document.removeEventListener('sceneforge:render-complete', handler)
  }, [updateUser])

  function handleLogout() { logout(); onLogout() }

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await updateMe(editName, editEmail)
      updateUser(updated)
      setEditing(false)
    } catch {} finally { setSaving(false) }
  }

  function switchToAgency() {
    setOpen(false)
    setStep('agency' as any)
  }

  function switchToPersonal() {
    setOpen(false)
    const store = useStore.getState()
    // Clear ALL agency context — nothing should bleed into personal mode
    store.setAgencyProjectId('')
    store.setConfig({
      niche: '', style: '', platform: 'TikTok', tone: '', audience: '',
      context: '', ideaHints: '', ideaTags: [],
      objective: '', duration_hint: 60, scene_count_hint: 8, client_brief: '',
    } as any)
    if ((store as any).setAgencyWorkflowStep) {
      (store as any).setAgencyWorkflowStep('setup')
    }
    // Navigate to personal projects first so the sidebar immediately switches context,
    // then load from backend — sidebar will populate once data arrives.
    setStep('projects' as any)
    store.loadProjectsFromBackend()
  }

  if (!user) return null

  const planColors: Record<string, string> = {
    starter: '#A78BFA', pro: '#F59E0B', studio: '#2DD4BF',
    agency:  '#C9A84C', free: '#9090AA',
  }
  const planColor = planColors[user.plan] ?? '#9090AA'
  const planLabel = user.plan.charAt(0).toUpperCase() + user.plan.slice(1)

  // Context label shown in menu button
  const contextLabel = inAgency && !isAgencyMode && canSwitch
    ? 'Personal mode'
    : inAgency
    ? 'Agency mode'
    : planLabel + ' plan'

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(!open); setEditing(false) }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 10px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
          border: open ? '1px solid rgba(124,92,255,0.3)' : '1px solid transparent',
          background: open ? 'rgba(124,92,255,0.1)' : 'transparent',
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: inAgency
            ? 'linear-gradient(135deg, #C9A84C, #F59E0B)'
            : 'linear-gradient(135deg, #7C5CFF, #2DD4BF)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0,
        }}>
          {user.avatar_initials}
        </div>
        <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
          <p style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(255,255,255,0.85)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.full_name}
          </p>
          <p style={{ fontSize: 10.5, color: planColor, margin: 0 }}>{contextLabel}</p>
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          style={{ color: 'rgba(255,255,255,0.3)', transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', flexShrink: 0 }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6,
          background: '#16161F', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, overflow: 'hidden', zIndex: 200,
        }}>
          {!editing ? (
            <>
              {/* Profile header */}
              <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%',
                    background: inAgency
                      ? 'linear-gradient(135deg, #C9A84C, #F59E0B)'
                      : 'linear-gradient(135deg, #7C5CFF, #2DD4BF)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0,
                  }}>
                    {user.avatar_initials}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#EEEEFF', margin: 0 }}>{user.full_name}</p>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: 0, wordBreak: 'break-all' }}>{user.email}</p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <Stat label="Videos created" value={String(user.videos_created ?? 0)} />
                  {!isAgencyMode && inAgency
                    ? <Stat label="Personal tokens" value={(user.tokens_remaining ?? 0).toLocaleString()} />
                    : <Stat label="Plan" value={planLabel} valueColor={planColor} />
                  }
                </div>
              </div>

              {/* ── Context switcher (owners only) ── */}
              {canSwitch && (
                <div style={{ padding: '8px 8px 4px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 6px', marginBottom: 4 }}>
                    Switch context
                  </p>
                  {/* Agency mode */}
                  <button
                    onClick={switchToAgency}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: isAgencyMode ? 'rgba(201,168,76,0.12)' : 'none',
                      marginBottom: 2, fontFamily: "'DM Sans', sans-serif",
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!isAgencyMode) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                    onMouseLeave={e => { if (!isAgencyMode) e.currentTarget.style.background = 'none' }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      background: 'rgba(201,168,76,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13,
                    }}>🏢</div>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: isAgencyMode ? '#C9A84C' : 'rgba(255,255,255,0.7)', margin: 0 }}>Agency workspace</p>
                      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)', margin: 0, textTransform: 'capitalize' }}>{wsRole} · team projects</p>
                    </div>
                    {isAgencyMode && (
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#C9A84C', flexShrink: 0 }} />
                    )}
                  </button>

                  {/* Personal mode */}
                  <button
                    onClick={switchToPersonal}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: !isAgencyMode ? 'rgba(124,92,255,0.1)' : 'none',
                      fontFamily: "'DM Sans', sans-serif",
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (isAgencyMode) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                    onMouseLeave={e => { if (isAgencyMode) e.currentTarget.style.background = 'none' }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      background: 'rgba(124,92,255,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13,
                    }}>🎬</div>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: !isAgencyMode ? '#A78BFA' : 'rgba(255,255,255,0.7)', margin: 0 }}>Personal studio</p>
                      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)', margin: 0 }}>Your solo projects</p>
                    </div>
                    {!isAgencyMode && (
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#A78BFA', flexShrink: 0 }} />
                    )}
                  </button>
                </div>
              )}

              {/* ── Workspace badge — clients only (cannot switch) ── */}
              {inAgency && wsRole === 'client' && (
                <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)',
                    borderRadius: 8, padding: '8px 10px',
                  }}>
                    <span style={{ fontSize: 14 }}>🏢</span>
                    <div>
                      <p style={{ fontSize: 11.5, fontWeight: 600, color: '#C9A84C', margin: 0 }}>Agency workspace</p>
                      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', margin: 0, textTransform: 'capitalize' }}>{wsRole} · workspace member</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ padding: '6px' }}>
                <DropdownItem icon="✎" label="Edit profile"
                  onClick={() => { setEditName(user.full_name); setEditEmail(user.email); setEditing(true) }} />
                {(!isAgencyMode || !inAgency) && (
                  <DropdownItem icon="◈" label="Upgrade plan"
                    onClick={() => { setOpen(false); setStep('plans') }} accent />
                )}
                <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
                <DropdownItem icon="⎋" label="Log out" onClick={handleLogout} danger />
              </div>
            </>
          ) : (
            <div style={{ padding: 14 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Edit profile
              </p>
              <div style={{ marginBottom: 10 }}>
                <label style={editLabel}>Full name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} style={editInput} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={editLabel}>Email</label>
                <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} style={editInput} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleSave} disabled={saving}
                  style={{ flex: 1, padding: '8px', background: '#7C5CFF', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditing(false)}
                  style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: 'rgba(255,255,255,0.5)', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 7, padding: '7px 9px' }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: valueColor ?? '#EEEEFF', margin: 0 }}>{value}</p>
      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', margin: 0 }}>{label}</p>
    </div>
  )
}

function DropdownItem({ icon, label, onClick, danger, accent }: { icon: string; label: string; onClick: () => void; danger?: boolean; accent?: boolean }) {
  return (
    <button onClick={onClick}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, background: 'none', border: 'none', cursor: 'pointer', color: danger ? '#FF8888' : accent ? '#A78BFA' : 'rgba(255,255,255,0.65)', fontSize: 12.5, fontFamily: "'DM Sans', sans-serif", fontWeight: 500, textAlign: 'left' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
      <span style={{ fontSize: 13, opacity: 0.7 }}>{icon}</span>
      {label}
    </button>
  )
}

const editLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.4)', marginBottom: 5 }
const editInput: React.CSSProperties = { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#EEEEFF', fontSize: 12.5, padding: '8px 10px', outline: 'none', fontFamily: "'DM Sans', sans-serif", boxSizing: 'border-box' }
