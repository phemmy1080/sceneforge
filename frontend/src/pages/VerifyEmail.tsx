import { useState, useEffect, useRef, type FormEvent } from 'react'
import { verifyEmail, resendOtp } from '../lib/api'

interface Props {
  email: string
  onVerified: () => void
}

export default function VerifyEmail({ email, onVerified }: Props) {
  const [digits, setDigits]         = useState(['', '', '', '', '', ''])
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [resendCooldown, setResendCooldown] = useState(60)
  const [resendMsg, setResendMsg]   = useState('')
  const inputRefs                   = useRef<(HTMLInputElement | null)[]>([])

  // Countdown timer for resend
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  function handleDigitChange(index: number, value: string) {
    // Accept only digits; handle paste of full code
    if (value.length > 1) {
      const pasted = value.replace(/\D/g, '').slice(0, 6)
      const next = [...digits]
      for (let i = 0; i < pasted.length; i++) {
        if (index + i < 6) next[index + i] = pasted[i]
      }
      setDigits(next)
      const focusIdx = Math.min(index + pasted.length, 5)
      inputRefs.current[focusIdx]?.focus()
      return
    }
    if (value && !/^\d$/.test(value)) return
    const next = [...digits]
    next[index] = value
    setDigits(next)
    if (value && index < 5) inputRefs.current[index + 1]?.focus()
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault()
    const code = digits.join('')
    if (code.length < 6) { setError('Please enter all 6 digits'); return }
    setError(''); setLoading(true)
    try {
      await verifyEmail(code)
      onVerified()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Invalid code. Please try again.')
      setDigits(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return
    setResendMsg(''); setError('')
    try {
      await resendOtp()
      setResendCooldown(60)
      setResendMsg('New code sent!')
      setTimeout(() => setResendMsg(''), 4000)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to resend. Try again.')
    }
  }

  // Auto-submit when all 6 digits filled
  useEffect(() => {
    if (digits.every((d) => d !== '')) handleSubmit()
  }, [digits])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#080810', fontFamily: "'DM Sans', system-ui, sans-serif", padding: '20px',
    }}>
      <div style={{ width: '100%', maxWidth: 440, textAlign: 'center' }}>

        {/* Icon */}
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px', fontSize: 28,
        }}>✉️</div>

        {/* Heading */}
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-1px', margin: '0 0 8px', color: '#F0F0FF' }}>
          Check your email
        </h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: '0 0 6px', lineHeight: 1.6 }}>
          We sent a 6-digit code to
        </p>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#c9a84c', margin: '0 0 32px' }}>
          {email}
        </p>

        {/* Error */}
        {error && (
          <div style={{
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
            borderRadius: 10, padding: '10px 16px', fontSize: 13, color: '#f87171',
            marginBottom: 20,
          }}>{error}</div>
        )}

        {/* Success msg */}
        {resendMsg && (
          <div style={{
            background: 'rgba(45,212,191,0.08)', border: '1px solid rgba(45,212,191,0.2)',
            borderRadius: 10, padding: '10px 16px', fontSize: 13, color: '#2dd4bf',
            marginBottom: 20,
          }}>{resendMsg}</div>
        )}

        {/* OTP Input */}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el }}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={d}
                autoFocus={i === 0}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                style={{
                  width: 52, height: 60, textAlign: 'center',
                  fontSize: 24, fontWeight: 700, fontFamily: 'monospace',
                  background: d ? 'rgba(201,168,76,0.08)' : 'rgba(255,255,255,0.05)',
                  border: `2px solid ${d ? 'rgba(201,168,76,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 12, color: '#F0F0FF', outline: 'none',
                  transition: 'all 0.15s',
                }}
                onFocus={(e) => { e.target.style.borderColor = 'rgba(201,168,76,0.6)' }}
                onBlur={(e) => { e.target.style.borderColor = d ? 'rgba(201,168,76,0.5)' : 'rgba(255,255,255,0.1)' }}
              />
            ))}
          </div>

          <button
            type="submit"
            disabled={loading || digits.some((d) => !d)}
            style={{
              width: '100%', background: loading ? 'rgba(201,168,76,0.5)' : '#c9a84c',
              color: '#080810', border: 'none', borderRadius: 12, padding: '14px',
              fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', transition: 'all 0.15s', marginBottom: 20,
            }}
          >
            {loading ? 'Verifying…' : 'Verify email →'}
          </button>
        </form>

        {/* Resend */}
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', margin: 0 }}>
          Didn't receive it?{' '}
          <button
            onClick={handleResend}
            disabled={resendCooldown > 0}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: resendCooldown > 0 ? 'rgba(255,255,255,0.25)' : '#c9a84c',
              cursor: resendCooldown > 0 ? 'default' : 'pointer',
              fontSize: 13, fontFamily: 'inherit', fontWeight: 600,
            }}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
          </button>
        </p>

        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', marginTop: 32 }}>
          Code expires in 15 minutes
        </p>
      </div>
    </div>
  )
}
