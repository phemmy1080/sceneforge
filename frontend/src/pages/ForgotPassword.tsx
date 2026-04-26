import { useState, type FormEvent } from 'react'
import { forgotPassword } from '../lib/api'

interface Props {
  onBack: () => void
}

export default function ForgotPassword({ onBack }: Props) {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setError(''); setLoading(true)
    try {
      await forgotPassword(email.trim())
      setSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      background: '#080810', fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      {/* Nav */}
      <div style={{
        padding: '16px 28px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button onClick={onBack} style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'none',
          border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 13,
          cursor: 'pointer', fontFamily: 'inherit', padding: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M10 3L5 8l5 5"/>
          </svg>
          Back to login
        </button>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.5px', color: '#F0F0FF' }}>
          Scene<span style={{ color: '#A78BFA' }}>Forge</span>
        </div>
        <div style={{ width: 90 }} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: '100%', maxWidth: 420 }}>

          {!sent ? (
            <>
              {/* Icon */}
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'rgba(124,92,255,0.12)', border: '1px solid rgba(124,92,255,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 24px', fontSize: 24,
              }}>🔑</div>

              <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-1px', margin: '0 0 8px', color: '#F0F0FF', textAlign: 'center' }}>
                Forgot password?
              </h1>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: '0 0 32px', lineHeight: 1.6, textAlign: 'center' }}>
                Enter your email and we'll send you a link to reset your password.
              </p>

              {error && (
                <div style={{
                  background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
                  borderRadius: 10, padding: '10px 16px', fontSize: 13,
                  color: '#f87171', marginBottom: 20,
                }}>{error}</div>
              )}

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{
                    display: 'block', fontSize: 11, fontWeight: 700,
                    color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase',
                    letterSpacing: '.08em', marginBottom: 7,
                  }}>Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoFocus
                    required
                    style={{
                      width: '100%', background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                      color: '#F0F0FF', fontSize: 14, padding: '13px 16px',
                      outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                      transition: 'border-color .15s',
                    }}
                    onFocus={(e) => { e.target.style.borderColor = 'rgba(124,92,255,0.5)' }}
                    onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.1)' }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  style={{
                    width: '100%', background: loading ? 'rgba(124,92,255,0.5)' : '#7C5CFF',
                    color: '#fff', border: 'none', borderRadius: 10, padding: '14px',
                    fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', transition: 'all .15s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  {loading ? 'Sending…' : 'Send reset link'}
                  {!loading && (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M3 8h10M9 4l4 4-4 4"/>
                    </svg>
                  )}
                </button>
              </form>
            </>
          ) : (
            /* Success state */
            <>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: 'rgba(45,212,191,0.12)', border: '1px solid rgba(45,212,191,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 24px', fontSize: 28,
              }}>✉️</div>

              <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-1px', margin: '0 0 8px', color: '#F0F0FF', textAlign: 'center' }}>
                Check your email
              </h1>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: '0 0 6px', lineHeight: 1.6, textAlign: 'center' }}>
                We've sent a password reset link to
              </p>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#A78BFA', margin: '0 0 32px', textAlign: 'center' }}>
                {email}
              </p>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginBottom: 28, lineHeight: 1.6 }}>
                The link expires in 1 hour. Check your spam folder if you don't see it.
              </p>

              <button
                onClick={onBack}
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, padding: '13px', fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Back to login
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
