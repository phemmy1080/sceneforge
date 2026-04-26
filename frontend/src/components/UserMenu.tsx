import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../authStore'
import { updateMe } from '../lib/api'
import { useStore } from '../store'

interface UserMenuProps {
  onLogout: () => void
}

export default function UserMenu({ onLogout }: UserMenuProps) {
  const user       = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)
  const logout     = useAuthStore((s) => s.logout)
  const setStep    = useStore((s) => s.setStep)

  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName]   = useState(user?.full_name ?? '')
  const [editEmail, setEditEmail] = useState(user?.email ?? '')
  const [saving, setSaving]   = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setEditing(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleLogout() { logout(); onLogout() }

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await updateMe(editName, editEmail)
      updateUser(updated)
      setEditing(false)
    } catch { } finally { setSaving(false) }
  }

  if (!user) return null

  const planColors: Record<string, string> = {
    starter: '#A78BFA',
    pro:     '#F59E0B',
    studio:  '#2DD4BF',
    free:    '#9090AA',
  }
  const planColor = planColors[user.plan] ?? '#9090AA'
  const planLabel = user.plan.charAt(0).toUpperCase() + user.plan.slice(1)

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
          background: 'linear-gradient(135deg, #7C5CFF, #2DD4BF)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0,
        }}>
          {user.avatar_initials}
        </div>
        <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
          <p style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(255,255,255,0.85)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.full_name}
          </p>
          <p style={{ fontSize: 10.5, color: planColor, margin: 0 }}>{planLabel} plan</p>
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
              <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #7C5CFF, #2DD4BF)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0,
                  }}>
                    {user.avatar_initials}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#EEEEFF', margin: 0 }}>{user.full_name}</p>
                    <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)', margin: 0, wordBreak: 'break-all' }}>{user.email}</p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <Stat label="Videos created" value={String(user.videos_created)} />
                  <Stat label="Plan" value={planLabel} valueColor={planColor} />
                </div>
              </div>
              <div style={{ padding: '6px' }}>
                <DropdownItem icon="✎" label="Edit profile" onClick={() => { setEditName(user.full_name); setEditEmail(user.email); setEditing(true) }} />
                <DropdownItem icon="◈" label="Upgrade to Pro" onClick={() => { setOpen(false); setStep('plans') }} accent />
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
                <input value={editName} onChange={(e) => setEditName(e.target.value)} style={editInput} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={editLabel}>Email</label>
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} style={editInput} />
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
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
      <span style={{ fontSize: 13, opacity: 0.7 }}>{icon}</span>
      {label}
    </button>
  )
}

import type React from 'react'
const editLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.4)', marginBottom: 5 }
const editInput: React.CSSProperties = { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#EEEEFF', fontSize: 12.5, padding: '8px 10px', outline: 'none', fontFamily: "'DM Sans', sans-serif", boxSizing: 'border-box' }
