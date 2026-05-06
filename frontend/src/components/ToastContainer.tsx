/**
 * frontend/src/components/ToastContainer.tsx
 * Renders all active toasts — place once in App.tsx
 *
 * Usage in App.tsx:
 *   import ToastContainer from './components/ToastContainer'
 *   // inside return:
 *   <ToastContainer />
 */
import { useToasts, removeToast, type Toast } from '../hooks/useErrorToast'

const ICONS: Record<Toast['type'], string> = {
  error:   '✕',
  success: '✓',
  warning: '⚠',
  info:    'ℹ',
}

const COLORS: Record<Toast['type'], { bg: string; border: string; icon: string }> = {
  error:   { bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.25)',  icon: '#EF4444' },
  success: { bg: 'rgba(45,212,191,0.1)', border: 'rgba(45,212,191,0.25)', icon: '#2DD4BF' },
  warning: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)', icon: '#F59E0B' },
  info:    { bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.25)', icon: '#818CF8' },
}

function ToastItem({ toast }: { toast: Toast }) {
  const c = COLORS[toast.type]
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 16px',
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      maxWidth: 380,
      animation: 'slideIn .2s ease',
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Icon */}
      <div style={{
        width: 20, height: 20, borderRadius: '50%',
        background: c.border, color: c.icon,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1,
      }}>
        {ICONS[toast.type]}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#F0F0FF', lineHeight: 1.4 }}>
          {toast.title}
        </p>
        {toast.message && (
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
            {toast.message}
          </p>
        )}
      </div>

      {/* Dismiss */}
      <button
        onClick={() => removeToast(toast.id)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.3)', fontSize: 16, padding: '0 2px',
          lineHeight: 1, flexShrink: 0, fontFamily: 'inherit',
        }}
      >
        ×
      </button>
    </div>
  )
}

export default function ToastContainer() {
  const toasts = useToasts()
  if (toasts.length === 0) return null

  return (
    <>
      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={t} />
          </div>
        ))}
      </div>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px) }
          to   { opacity: 1; transform: translateX(0) }
        }
      `}</style>
    </>
  )
}
