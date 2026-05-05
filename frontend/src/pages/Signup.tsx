import { useState, type FormEvent } from 'react'
import { signup, validateCoupon } from '../lib/api'
import { useAuthStore } from '../authStore'

interface SignupProps {
  onSuccess: (email?: string) => void
  onLogin: () => void
}

export default function Signup({ onSuccess, onLogin }: SignupProps) {
  const setAuth = useAuthStore((s) => s.setAuth)

  const [fullName, setFullName]               = useState('')
  const [email, setEmail]                     = useState('')
  const [password, setPassword]               = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [couponCode, setCouponCode]           = useState('')
  const [couponStatus, setCouponStatus]       = useState<{ valid: boolean; tokens: number; message: string } | null>(null)
  const [couponChecking, setCouponChecking]   = useState(false)
  const [loading, setLoading]                 = useState(false)
  const [error, setError]                     = useState('')
  const [showPassword, setShowPassword]       = useState(false)

  const passwordStrength = (() => {
    if (password.length === 0) return 0
    let score = 0
    if (password.length >= 8) score++
    if (/[A-Z]/.test(password)) score++
    if (/[0-9]/.test(password)) score++
    if (/[^A-Za-z0-9]/.test(password)) score++
    return score
  })()

  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][passwordStrength]
  const strengthColor = ['', '#FF6B6B', '#F59E0B', '#2DD4BF', '#22C55E'][passwordStrength]

  async function handleCouponCheck() {
    const code = couponCode.trim().toUpperCase()
    if (!code) return
    setCouponChecking(true)
    setCouponStatus(null)
    const result = await validateCoupon(code)
    setCouponStatus(result)
    setCouponChecking(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    try {
      const res = await signup(fullName, email, password, couponCode.trim().toUpperCase() || undefined)
      setAuth(res.user, res.access_token)
      onSuccess(email)  // pass email so App can show verify screen
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Signup failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={pageWrap}>
      {/* Left panel */}
      <div style={leftPanel}>
        <div style={brandLogo}>Scene<span style={{ color: '#A78BFA' }}>Forge</span></div>
        <h2 style={leftHeading}>Your AI video<br />studio awaits.</h2>
        <p style={leftSub}>From idea to exported video in minutes — powered by AI, Pexels, and FFmpeg.</p>
        <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            'AI-generated scripts & scene breakdowns',
            'Voice synthesis powered by multiple TTS engines',
            'Auto-matched Pexels stock footage',
            'Export to MP4, scene bundle, or CapCut',
          ].map((item) => (
            <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(45,212,191,0.2)', border: '1px solid rgba(45,212,191,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5l2.5 2.5L8 2.5" stroke="#2DD4BF" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>{item}</span>
            </div>
          ))}
        </div>

        {/* Coupon teaser */}
        <div style={{ marginTop: 40, padding: '14px 16px', background: 'rgba(45,212,191,0.06)', border: '1px solid rgba(45,212,191,0.15)', borderRadius: 10 }}>
          <p style={{ fontSize: 12.5, color: 'rgba(45,212,191,0.8)', margin: 0, lineHeight: 1.5 }}>
            🎁 Have a promo code? Enter it during signup to get bonus tokens on top of your free 1,000.
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div style={rightPanel}>
        <div style={formCard}>
          <h1 style={formTitle}>Create your account</h1>
          <p style={formSub}>Free to start · 1,000 tokens included · No credit card</p>

          {error && <div style={errorBox}>{error}</div>}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={fieldLabel}>Full name</label>
              <input type="text" placeholder="Alex Johnson" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus style={fieldInput} />
            </div>

            <div>
              <label style={fieldLabel}>Email</label>
              <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required style={fieldInput} />
            </div>

            <div>
              <label style={fieldLabel}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{ ...fieldInput, paddingRight: 44 }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>
                  {showPassword ? 'hide' : 'show'}
                </button>
              </div>
              {password.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                    <div style={{ height: '100%', borderRadius: 2, width: `${passwordStrength * 25}%`, background: strengthColor, transition: 'width 0.3s, background 0.3s' }} />
                  </div>
                  <span style={{ fontSize: 11, color: strengthColor, minWidth: 36 }}>{strengthLabel}</span>
                </div>
              )}
            </div>

            <div>
              <label style={fieldLabel}>Confirm password</label>
              <input
                type="password"
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                style={{ ...fieldInput, borderColor: confirmPassword && confirmPassword !== password ? 'rgba(255,107,107,0.5)' : undefined }}
              />
            </div>

            {/* Coupon code field */}
            <div>
              <label style={fieldLabel}>
                Promo / coupon code
                <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400, marginLeft: 6 }}>optional</span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="e.g. LAUNCH50"
                  value={couponCode}
                  onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponStatus(null) }}
                  onBlur={() => couponCode.trim() && handleCouponCheck()}
                  style={{ ...fieldInput, flex: 1, letterSpacing: '0.05em', fontWeight: couponCode ? 600 : 400 }}
                />
                <button
                  type="button"
                  onClick={handleCouponCheck}
                  disabled={!couponCode.trim() || couponChecking}
                  style={{ padding: '11px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: 'rgba(255,255,255,0.6)', fontSize: 12.5, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', opacity: !couponCode.trim() ? 0.4 : 1 }}
                >
                  {couponChecking ? '…' : 'Check'}
                </button>
              </div>

              {/* Coupon status message */}
              {couponStatus && (
                <div style={{
                  marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 12.5,
                  background: couponStatus.valid ? 'rgba(45,212,191,0.08)' : 'rgba(255,107,107,0.08)',
                  border: `1px solid ${couponStatus.valid ? 'rgba(45,212,191,0.25)' : 'rgba(255,107,107,0.2)'}`,
                  color: couponStatus.valid ? '#2DD4BF' : '#FF9999',
                  display: 'flex', alignItems: 'center', gap: 7,
                }}>
                  <span>{couponStatus.valid ? '✓' : '✗'}</span>
                  {couponStatus.message}
                  {couponStatus.valid && (
                    <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 13 }}>
                      +{couponStatus.tokens.toLocaleString()} tokens
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Token summary */}
            {couponStatus?.valid && (
              <div style={{ padding: '10px 14px', background: 'rgba(124,92,255,0.08)', border: '1px solid rgba(124,92,255,0.2)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.55)' }}>Tokens on signup</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#A78BFA' }}>
                  1,000 + {couponStatus.tokens.toLocaleString()} = {(1000 + couponStatus.tokens).toLocaleString()} tokens
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ ...submitBtn, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer', marginTop: 4 }}
            >
              {loading ? 'Creating account…' : 'Create account →'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
            Already have an account?{' '}
            <button onClick={onLogin} style={{ background: 'none', border: 'none', color: '#A78BFA', cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans', sans-serif" }}>
              Log in
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

import type React from 'react'

const pageWrap: React.CSSProperties = { minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr', background: '#080810', fontFamily: "'DM Sans', sans-serif" }
const leftPanel: React.CSSProperties = { background: 'linear-gradient(160deg, #0F0F1A 0%, #0A0A12 100%)', borderRight: '1px solid rgba(255,255,255,0.06)', padding: '60px 52px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }
const brandLogo: React.CSSProperties = { fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 48, color: '#EEEEFF' }
const leftHeading: React.CSSProperties = { fontSize: 40, fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1.1, marginBottom: 16, color: '#EEEEFF' }
const leftSub: React.CSSProperties = { fontSize: 15, color: 'rgba(255,255,255,0.45)', lineHeight: 1.65, maxWidth: 380 }
const rightPanel: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }
const formCard: React.CSSProperties = { width: '100%', maxWidth: 400 }
const formTitle: React.CSSProperties = { fontSize: 26, fontWeight: 700, letterSpacing: '-0.5px', marginBottom: 6, color: '#EEEEFF' }
const formSub: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 28 }
const errorBox: React.CSSProperties = { background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#FF9999', marginBottom: 16 }
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }
const fieldInput: React.CSSProperties = { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#EEEEFF', fontSize: 13.5, padding: '11px 14px', outline: 'none', fontFamily: "'DM Sans', sans-serif", boxSizing: 'border-box' }
const submitBtn: React.CSSProperties = { width: '100%', background: '#7C5CFF', color: '#fff', border: 'none', borderRadius: 10, padding: '13px', fontSize: 14, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", cursor: 'pointer', letterSpacing: '-0.2px' }
