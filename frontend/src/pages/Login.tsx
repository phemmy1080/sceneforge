import { useState, type FormEvent } from 'react'
import { login } from '../lib/api'
import { useAuthStore } from '../authStore'
import type React from 'react'

interface LoginProps {
  onForgot?: () => void
  onVerify?: (email: string) => void
  onSuccess: () => void
  onSignup: () => void
  onLanding: () => void
}

export default function Login({ onSuccess, onSignup, onLanding, onForgot, onVerify }: LoginProps) {
  const setAuth = useAuthStore((s) => s.setAuth)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await login(email, password)
      setAuth(res.user, res.access_token)
      onSuccess()
    } catch (err: any) {
      const status = err.response?.status
      const detail = err.response?.data?.detail ?? 'Login failed. Please check your credentials.'
      if (status === 403 && detail.includes('verify')) {
        // Redirect to verify screen — store email so they can resend OTP
        sessionStorage.setItem('verify_email', email)
        onVerify?.(email)
        return
      }
      setError(detail)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={pageWrap}>
      {/* Back to landing */}
      <button onClick={onLanding} style={backBtn}>
        ← SceneForge
      </button>

      {/* Centered card */}
      <div style={card}>
        <div style={logo}>Scene<span style={{ color: '#A78BFA' }}>Forge</span></div>
        <h1 style={title}>Welcome back</h1>
        <p style={sub}>Log in to your account to continue creating.</p>

        {error && <div style={errorBox}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={fieldLabel}>Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              style={fieldInput}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ ...fieldLabel, marginBottom: 0 }}>Password</label>
              <button type="button" style={forgotBtn} onClick={onForgot}>Forgot password?</button>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ ...fieldInput, paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute', right: 12, top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'rgba(255,255,255,0.3)', fontSize: 12,
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {showPassword ? 'hide' : 'show'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              ...submitBtn,
              opacity: loading ? 0.6 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: 6,
            }}
          >
            {loading ? 'Logging in…' : 'Log in →'}
          </button>
        </form>

        <div style={divider}>
          <span style={dividerLine} />
          <span style={dividerText}>or</span>
          <span style={dividerLine} />
        </div>

        <p style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
          Don't have an account?{' '}
          <button
            onClick={onSignup}
            style={{
              background: 'none', border: 'none', color: '#A78BFA',
              cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans', sans-serif",
              fontWeight: 500,
            }}
          >
            Sign up free
          </button>
        </p>

        {/* Admin link — subtle, at the very bottom */}
        <div style={{ marginTop: 32, textAlign: 'center' }}>
          <a
            href="/admin.html"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 11.5, color: 'rgba(255,255,255,0.2)',
              textDecoration: 'none', fontFamily: "'DM Sans', sans-serif",
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.2)')}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2" width="5" height="5" rx="1"/>
              <rect x="9" y="2" width="5" height="5" rx="1"/>
              <rect x="2" y="9" width="5" height="5" rx="1"/>
              <rect x="9" y="9" width="5" height="5" rx="1"/>
            </svg>
            Admin dashboard
          </a>
        </div>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  background: '#080810',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: "'DM Sans', sans-serif",
  position: 'relative',
}

const backBtn: React.CSSProperties = {
  position: 'absolute',
  top: 24, left: 32,
  background: 'none', border: 'none',
  color: 'rgba(255,255,255,0.35)',
  cursor: 'pointer',
  fontFamily: "'Syne', sans-serif",
  fontSize: 14, fontWeight: 700,
  letterSpacing: '-0.3px',
}

const card: React.CSSProperties = {
  width: '100%',
  maxWidth: 400,
  padding: '0 24px',
}

const logo: React.CSSProperties = {
  fontFamily: "'Syne', sans-serif",
  fontSize: 20, fontWeight: 800,
  letterSpacing: '-0.5px',
  color: '#EEEEFF',
  textAlign: 'center',
  marginBottom: 32,
}

const title: React.CSSProperties = {
  fontFamily: "'Syne', sans-serif",
  fontSize: 28, fontWeight: 700,
  letterSpacing: '-0.5px',
  color: '#EEEEFF',
  marginBottom: 6,
  textAlign: 'center',
}

const sub: React.CSSProperties = {
  fontSize: 13,
  color: 'rgba(255,255,255,0.35)',
  textAlign: 'center',
  marginBottom: 28,
}

const errorBox: React.CSSProperties = {
  background: 'rgba(255,107,107,0.1)',
  border: '1px solid rgba(255,107,107,0.3)',
  borderRadius: 10,
  padding: '10px 14px',
  fontSize: 13, color: '#FF9999',
  marginBottom: 16,
}

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 12, fontWeight: 500,
  color: 'rgba(255,255,255,0.45)',
  marginBottom: 6,
}

const fieldInput: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  color: '#EEEEFF',
  fontSize: 13.5,
  padding: '11px 14px',
  outline: 'none',
  fontFamily: "'DM Sans', sans-serif",
  boxSizing: 'border-box',
}

const forgotBtn: React.CSSProperties = {
  background: 'none', border: 'none',
  color: 'rgba(167,139,250,0.7)',
  cursor: 'pointer', fontSize: 12,
  fontFamily: "'DM Sans', sans-serif",
}

const submitBtn: React.CSSProperties = {
  width: '100%',
  background: '#7C5CFF',
  color: '#fff', border: 'none',
  borderRadius: 10, padding: '13px',
  fontSize: 14, fontWeight: 600,
  fontFamily: "'DM Sans', sans-serif",
  letterSpacing: '-0.2px',
}

const divider: React.CSSProperties = {
  display: 'flex', alignItems: 'center',
  gap: 12, margin: '20px 0',
}

const dividerLine: React.CSSProperties = {
  flex: 1, height: 1,
  background: 'rgba(255,255,255,0.07)',
}

const dividerText: React.CSSProperties = {
  fontSize: 12,
  color: 'rgba(255,255,255,0.25)',
}
