import { useState, useEffect, useCallback } from 'react'

interface Toast {
  id: number
  message: string
  status?: number
  type: 'error' | 'warning' | 'info'
}

let toastId = 0

export default function ErrorToast() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const add = useCallback((message: string, status?: number, type: Toast['type'] = 'error') => {
    const id = ++toastId
    setToasts((prev) => [...prev.slice(-3), { id, message, status, type }]) // max 4 toasts
    setTimeout(() => remove(id), 6000)
  }, [remove])

  useEffect(() => {
    const onError = (e: CustomEvent) => {
      const { message, status } = e.detail || {}
      // Don't show toast for 401 (handled by auth-expired)
      if (status === 401) return
      add(message || 'Something went wrong.', status)
    }
    const onRateLimit = (e: CustomEvent) => {
      add(e.detail || 'Too many requests. Please slow down.', 429, 'warning')
    }
    const onAuthExpired = (e: CustomEvent) => {
      add(e.detail || 'Session expired. Please log in again.', 401, 'warning')
    }

    document.addEventListener('api-error',       onError       as EventListener)
    document.addEventListener('api-rate-limited', onRateLimit   as EventListener)
    document.addEventListener('api-auth-expired', onAuthExpired as EventListener)
    return () => {
      document.removeEventListener('api-error',       onError       as EventListener)
      document.removeEventListener('api-rate-limited', onRateLimit   as EventListener)
      document.removeEventListener('api-auth-expired', onAuthExpired as EventListener)
    }
  }, [add])

  if (!toasts.length) return null

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 10,
      alignItems: 'center', pointerEvents: 'none',
    }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: '12px 16px 12px 14px',
            borderRadius: 14, maxWidth: 420, width: '100%',
            pointerEvents: 'all',
            animation: 'sfToastIn 0.25s cubic-bezier(0.34,1.56,0.64,1)',
            background: t.type === 'error'
              ? 'linear-gradient(135deg,#1f0a0a,#2a0f0f)'
              : t.type === 'warning'
              ? 'linear-gradient(135deg,#1a1200,#2a1e00)'
              : 'linear-gradient(135deg,#0a1020,#0f1a2a)',
            border: `1px solid ${
              t.type === 'error' ? 'rgba(248,113,113,0.25)'
              : t.type === 'warning' ? 'rgba(251,191,36,0.25)'
              : 'rgba(96,165,250,0.25)'
            }`,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          {/* Icon */}
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: t.type === 'error' ? 'rgba(248,113,113,0.15)'
              : t.type === 'warning' ? 'rgba(251,191,36,0.15)'
              : 'rgba(96,165,250,0.15)',
            fontSize: 13,
          }}>
            {t.type === 'error' ? '⚠' : t.type === 'warning' ? '⏳' : 'ℹ'}
          </div>

          {/* Message */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: 13, fontWeight: 600, margin: '0 0 2px',
              color: t.type === 'error' ? '#fca5a5'
                : t.type === 'warning' ? '#fcd34d'
                : '#93c5fd',
            }}>
              {t.type === 'error' ? 'Something went wrong'
                : t.type === 'warning' ? 'Heads up'
                : 'Info'}
              {t.status ? ` (${t.status})` : ''}
            </p>
            <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.65)', margin: 0, lineHeight: 1.5 }}>
              {t.message}
            </p>
          </div>

          {/* Close */}
          <button
            onClick={() => remove(t.id)}
            style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)',
              fontSize: 16, cursor: 'pointer', padding: '0 2px', flexShrink: 0,
              lineHeight: 1,
            }}
            aria-label="Dismiss"
          >×</button>
        </div>
      ))}
      <style>{`
        @keyframes sfToastIn {
          from { opacity: 0; transform: translateY(10px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}
