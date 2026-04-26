import { useEffect, useState } from 'react'
import { api, getMe } from '../lib/api'
import { useAuthStore } from '../authStore'

export default function PaymentCallback() {
  const [status, setStatus]           = useState<'loading' | 'success' | 'failed' | 'pending' | 'cancelled'>('loading')
  const [message, setMessage]         = useState('')
  const [tokensAdded, setTokensAdded] = useState<number | null>(null)
  const [tokensTotal, setTokensTotal] = useState<number | null>(null)
  const user       = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)

  useEffect(() => {
    const params    = new URLSearchParams(window.location.search)
    const payStatus = params.get('status') || ''
    const txRef     = params.get('tx_ref') || ''
    const txId      = params.get('transaction_id') || ''

    if (!payStatus || payStatus === 'cancelled') {
      setStatus('cancelled')
      setMessage('Payment was cancelled. No charge was made.')
      return
    }

    api.get(`/api/payments/callback?status=${payStatus}&tx_ref=${encodeURIComponent(txRef)}&transaction_id=${encodeURIComponent(txId)}`)
      .then(({ data }) => {
        setStatus(data.status as any)
        setMessage(data.message || '')
        if (data.tokens_added) setTokensAdded(data.tokens_added)
        if (data.tokens_total) setTokensTotal(data.tokens_total)
        if (data.status === 'success') {
          getMe().then(updateUser).catch(() => {})
        }
      })
      .catch(() => {
        setStatus('failed')
        setMessage('Could not verify payment. Please contact support with your transaction ID.')
      })
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#080810', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 400, width: '100%', textAlign: 'center', color: '#F0F0FF' }}>

        {status === 'loading' && (
          <>
            <SpinIcon color="#A78BFA" />
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Verifying payment…</h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14 }}>Please wait while we confirm your transaction</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CircleIcon color="#2DD4BF" path={<path d="M7 12l3.5 3.5L17 8" stroke="#2DD4BF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>} />
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Payment successful!</h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 4 }}>{message}</p>
            {user?.email && (
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginBottom: 20 }}>
                Confirmation sent to <span style={{ color: 'rgba(255,255,255,0.55)' }}>{user.email}</span>
              </p>
            )}
            {tokensAdded && (
              <div style={{ background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.25)', borderRadius: 12, padding: '18px 20px', marginBottom: 20 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#2DD4BF', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Tokens added</p>
                <p style={{ fontSize: 44, fontWeight: 800, color: '#fff', letterSpacing: -2, lineHeight: 1 }}>+{tokensAdded.toLocaleString()}</p>
                {tokensTotal && (
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                    New balance: <strong style={{ color: 'rgba(255,255,255,0.75)' }}>{tokensTotal.toLocaleString()} tokens</strong>
                  </p>
                )}
              </div>
            )}
            <a href="/" style={{ display: 'inline-block', background: '#7C5CFF', color: '#fff', textDecoration: 'none', padding: '12px 32px', borderRadius: 10, fontSize: 14, fontWeight: 700 }}>
              Start creating →
            </a>
          </>
        )}

        {status === 'cancelled' && (
          <>
            <CircleIcon color="#FF8888" path={<><path d="M8 8l8 8" stroke="#FF8888" strokeWidth="2" strokeLinecap="round"/><path d="M16 8l-8 8" stroke="#FF8888" strokeWidth="2" strokeLinecap="round"/></>} />
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Payment cancelled</h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 24 }}>{message}</p>
            <a href="/" style={{ display: 'inline-block', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', textDecoration: 'none', padding: '12px 28px', borderRadius: 10, fontSize: 14, border: '1px solid rgba(255,255,255,0.1)' }}>
              ← Back to SceneForge
            </a>
          </>
        )}

        {(status === 'failed' || status === 'pending') && (
          <>
            <CircleIcon color="#F59E0B" path={<path d="M12 7v5l3 3" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>} />
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              {status === 'pending' ? 'Verifying…' : 'Something went wrong'}
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 24 }}>{message}</p>
            <a href="/" style={{ display: 'inline-block', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', textDecoration: 'none', padding: '12px 28px', borderRadius: 10, fontSize: 14, border: '1px solid rgba(255,255,255,0.1)' }}>
              ← Back to SceneForge
            </a>
          </>
        )}

      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function SpinIcon({ color }: { color: string }) {
  return (
    <div style={{ width: 64, height: 64, borderRadius: '50%', background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
      <svg style={{ animation: 'spin 1s linear infinite' }} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
      </svg>
    </div>
  )
}

function CircleIcon({ color, path }: { color: string; path: React.ReactNode }) {
  return (
    <div style={{ width: 64, height: 64, borderRadius: '50%', background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2"/>
        {path}
      </svg>
    </div>
  )
}

import type React from 'react'
