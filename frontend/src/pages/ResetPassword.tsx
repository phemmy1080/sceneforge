import { useState, useEffect } from 'react'
import { verifyResetToken, resetPasswordWithToken } from '../lib/api'

interface Props {
  onSuccess: () => void
}

export default function ResetPassword({ onSuccess }: Props) {
  const [status, setStatus]         = useState<'loading' | 'valid' | 'invalid' | 'success'>('loading')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [showPass, setShowPass]     = useState(false)
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [strength, setStrength]     = useState(0)

  // Get token from URL
  const token = new URLSearchParams(window.location.search).get('token') || ''

  useEffect(() => {
    if (!token) { setStatus('invalid'); return }
    verifyResetToken(token)
      .then((res) => { setEmail(res.email); setStatus('valid') })
      .catch(() => setStatus('invalid'))
  }, [token])

  function calcStrength(v: string) {
    let s = 0
    if (v.length >= 8) s++
    if (/[A-Z]/.test(v)) s++
    if (/[0-9]/.test(v)) s++
    if (/[^A-Za-z0-9]/.test(v)) s++
    return s
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await resetPasswordWithToken(token, password, confirm)
      setStatus('success')
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const strengthColors = ['', '#f87171', '#f59e0b', '#2dd4bf', '#4ade80']
  const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong']

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      background: '#080810', fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      {/* Nav */}
      <div style={{
        padding: '16px 28px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.5px', color: '#F0F0FF' }}>
          Scene<span style={{ color: '#A78BFA' }}>Forge</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 16px' }}>
        <div style={{ width: '100%', maxWidth: 420 }}>

          {/* Loading */}
          {status === 'loading' && (
            <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
              Validating reset link…
            </p>
          )}

          {/* Invalid token */}
          {status === 'invalid' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 24px', fontSize: 24,
              }}>❌</div>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 10px', color: '#F0F0FF' }}>
                Link expired
              </h1>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: '0 0 28px', lineHeight: 1.6 }}>
                This reset link has expired or already been used.<br />
                Request a new one from the login page.
              </p>
              <button
                onClick={() => window.location.href = '/'}
                style={{
                  background: '#7C5CFF', color: '#fff', border: 'none',
                  borderRadius: 10, padding: '13px 28px', fontSize: 14,
                  fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Back to login
              </button>
            </div>
          )}

          {/* Reset form */}
          {status === 'valid' && (
            <>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'rgba(124,92,255,0.12)', border: '1px solid rgba(124,92,255,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 24px', fontSize: 24,
              }}>🔒</div>

              <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-1px', margin: '0 0 8px', color: '#F0F0FF', textAlign: 'center' }}>
                Set new password
              </h1>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: '0 0 32px', textAlign: 'center' }}>
                for <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{email}</strong>
              </p>

              {error && (
                <div style={{
                  background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
                  borderRadius: 10, padding: '10px 16px', fontSize: 13,
                  color: '#f87171', marginBottom: 20,
                }}>{error}</div>
              )}

              <form onSubmit={handleSubmit}>
                {/* New password */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{
                    display: 'block', fontSize: 11, fontWeight: 700,
                    color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase',
                    letterSpacing: '.08em', marginBottom: 7,
                  }}>New password</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setStrength(calcStrength(e.target.value)) }}
                      placeholder="Minimum 8 characters"
                      autoFocus
                      style={{
                        width: '100%', background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                        color: '#F0F0FF', fontSize: 14, padding: '13px 52px 13px 16px',
                        outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                        transition: 'border-color .15s',
                      }}
                      onFocus={(e) => { e.target.style.borderColor = 'rgba(124,92,255,0.5)' }}
                      onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.1)' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      style={{
                        position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
                        fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >{showPass ? 'hide' : 'show'}</button>
                  </div>
                  {/* Strength bar */}
                  {password && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                        <div style={{
                          height: '100%', borderRadius: 2,
                          width: `${strength * 25}%`,
                          background: strengthColors[strength],
                          transition: 'all .3s',
                        }} />
                      </div>
                      <span style={{ fontSize: 11, color: strengthColors[strength] }}>
                        {strengthLabels[strength]}
                      </span>
                    </div>
                  )}
                </div>

                {/* Confirm password */}
                <div style={{ marginBottom: 24 }}>
                  <label style={{
                    display: 'block', fontSize: 11, fontWeight: 700,
                    color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase',
                    letterSpacing: '.08em', marginBottom: 7,
                  }}>Confirm password</label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your new password"
                    style={{
                      width: '100%', background: 'rgba(255,255,255,0.05)',
                      border: `1px solid ${confirm && confirm !== password ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: 10, color: '#F0F0FF', fontSize: 14,
                      padding: '13px 16px', outline: 'none', fontFamily: 'inherit',
                      boxSizing: 'border-box', transition: 'border-color .15s',
                    }}
                    onFocus={(e) => { e.target.style.borderColor = 'rgba(124,92,255,0.5)' }}
                    onBlur={(e) => { e.target.style.borderColor = confirm && confirm !== password ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.1)' }}
                  />
                  {confirm && confirm !== password && (
                    <p style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>Passwords don't match</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || !password || !confirm}
                  style={{
                    width: '100%', background: loading ? 'rgba(124,92,255,0.5)' : '#7C5CFF',
                    color: '#fff', border: 'none', borderRadius: 10, padding: '14px',
                    fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', transition: 'all .15s',
                  }}
                >
                  {loading ? 'Saving…' : 'Set new password →'}
                </button>
              </form>
            </>
          )}

          {/* Success */}
          {status === 'success' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: 'rgba(45,212,191,0.12)', border: '1px solid rgba(45,212,191,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 24px', fontSize: 28,
              }}>✅</div>
              <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 10px', color: '#F0F0FF' }}>
                Password updated!
              </h1>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: '0 0 28px', lineHeight: 1.6 }}>
                Your password has been changed successfully.<br />
                You can now log in with your new password.
              </p>
              <button
                onClick={onSuccess}
                style={{
                  background: '#7C5CFF', color: '#fff', border: 'none',
                  borderRadius: 10, padding: '13px 28px', fontSize: 14,
                  fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Go to login →
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
