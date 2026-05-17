import { useState, useEffect } from 'react'
import { api, getTokenBalance, type TokenBalance } from '../lib/api'

// Visual styling per plan key — these never change even if pricing does
const PLAN_STYLE: Record<string, {
  color: string; bg: string; border: string; btnText: string; popular?: boolean; description: string
}> = {
  starter:    { color: '#A78BFA', bg: 'rgba(124,92,255,0.10)', border: 'rgba(124,92,255,0.25)', btnText: '#26215C', description: 'Perfect for creators just getting started' },
  pro:        { color: '#2DD4BF', bg: 'rgba(45,212,191,0.10)',  border: 'rgba(45,212,191,0.40)',  btnText: '#04342C', popular: true, description: 'For creators publishing weekly content' },
  studio:     { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)',  btnText: '#412402', description: 'For agencies and high-volume creators' },
  agency:     { color: '#C9A84C', bg: 'rgba(201,168,76,0.10)',  border: 'rgba(201,168,76,0.35)',  btnText: '#412402', description: 'Full agency workspace — team collaboration & client review' },
}

// Fallback style for any new plans created in admin
const DEFAULT_STYLE = { color: '#A78BFA', bg: 'rgba(124,92,255,0.10)', border: 'rgba(124,92,255,0.22)', btnText: '#26215C', description: 'Custom plan' }

// Features per plan — enriched from token count dynamically
function getPlanFeatures(key: string, tokens: number, videos: number): string[] {
  const base = [
    `${tokens.toLocaleString()} tokens included`,
    `${videos} full video renders`,
    'Pexels stock footage',
    'AI voiceover (Google TTS)',
    'MP4, CapCut & scene export',
    'Voice extraction (MP3/WAV)',
    'Re-renders always free',
    'Tokens never expire',
  ]
  if (key === 'pro' || key === 'studio') base.push('Priority render queue')
  if (key === 'studio') base.push('No watermarks on exports')
  if (key === 'agency') {
    base.push('No watermarks on exports')
    base.push('Agency workspace (5 seats)')
    base.push('Client review links')
    base.push('Brand kits per client')
    base.push('Shared token pool')
    base.push('Team activity timeline')
  }
  if (!['starter','pro','studio','agency'].includes(key)) {
    // Custom plan from admin
    base.splice(2, 0, 'Up to unlimited scenes')
  }
  return base
}

function getLockedFeatures(key: string): string[] {
  if (key === 'starter') return ['Priority render queue', 'No watermarks']
  if (key === 'pro') return ['No watermarks']
  if (key === 'agency') return []
  return []
}

interface ApiPlan {
  key: string
  label: string
  amount: number
  currency: string
  tokens: number
  videos: number
  per_token_rate: number
}

interface Props { onBack?: () => void }

export default function Plans({ onBack }: Props) {
  const [plans, setPlans]     = useState<ApiPlan[]>([])
  const [balance, setBalance] = useState<TokenBalance | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError]     = useState('')
  const [fetching, setFetching] = useState(true)

  useEffect(() => {
    // Fetch plans from API — always live, reflects admin changes immediately
    api.get('/api/payments/plans')
      .then(({ data }) => setPlans(data.plans || []))
      .catch(() => setError('Failed to load plans. Please refresh.'))
      .finally(() => setFetching(false))

    getTokenBalance().then(setBalance).catch(() => {})
  }, [])

  async function handleBuy(planKey: string) {
    setLoading(planKey)
    setError('')
    try {
      const { data } = await api.post('/api/payments/initiate', { plan_key: planKey })
      window.location.href = data.payment_url
    } catch (e: any) {
      const d = e?.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Payment failed to start. Please try again.')
      setLoading(null)
    }
  }

  if (fetching) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
        <svg style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginBottom: 12 }}
          width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83"/>
        </svg>
        <br />Loading plans…
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  return (
    <div style={{ color: '#F0F0FF', fontFamily: "'DM Sans', system-ui, sans-serif" }}>

      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: -1, margin: '0 0 6px' }}>Choose your plan</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: 0 }}>
          One-time top-up · tokens never expire · re-renders always free
        </p>
        {balance && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '4px 14px', borderRadius: 20, marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: balance.tokens_remaining > 200 ? '#2DD4BF' : '#F59E0B' }} />
            Balance: <strong style={{ color: 'rgba(255,255,255,0.85)', marginLeft: 3 }}>{balance.tokens_remaining.toLocaleString()} tokens</strong>
          </div>
        )}
        {plans.length > 0 && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', padding: '3px 12px', borderRadius: 20, marginTop: 8, marginLeft: 8, fontSize: 11.5, color: 'rgba(255,255,255,0.4)' }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6"/><path d="M5.5 10l1.5-4 2 3 1.5-2"/></svg>
            Prices shown in {(plans[0] as any).currency || 'USD'}
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.25)', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#FF8888', textAlign: 'center', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {plans.length === 0 && !fetching && (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: '40px 0', fontSize: 13 }}>
          No plans available. Check admin pricing settings.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(plans.length, 3)}, 1fr)`, gap: 12, marginBottom: 16, maxWidth: plans.length >= 4 ? '900px' : undefined, margin: plans.length >= 4 ? '0 auto 16px' : undefined }}>
        {plans.map((plan) => {
          const style = PLAN_STYLE[plan.key] ?? DEFAULT_STYLE
          const isLoading = loading === plan.key
          const features = getPlanFeatures(plan.key, plan.tokens, plan.videos ?? Math.floor(plan.tokens / 100))
          const locked = getLockedFeatures(plan.key)

          return (
            <div key={plan.key} style={{ borderRadius: 14, border: `${style.popular ? 1.5 : 1}px solid ${style.border}`, background: style.bg, padding: '18px 16px', display: 'flex', flexDirection: 'column', position: 'relative' }}>

              {style.popular && (
                <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: style.color, color: style.btnText, fontSize: 9.5, fontWeight: 800, padding: '2px 12px', borderRadius: 20, whiteSpace: 'nowrap', letterSpacing: '.05em' }}>
                  MOST POPULAR
                </div>
              )}

              <div style={{ fontSize: 15, fontWeight: 800, color: style.color, marginBottom: 4 }}>{plan.label}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)', marginBottom: 12, lineHeight: 1.5 }}>{style.description}</div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 8, background: style.color + '28', color: style.color }}>
                  {plan.tokens.toLocaleString()} tokens
                </span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>· {plan.videos ?? Math.floor(plan.tokens / 100)} videos</span>
              </div>

              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -1, color: '#fff', lineHeight: 1, marginBottom: 2 }}>
                {(plan as any).symbol || (plan.currency === 'NGN' ? '₦' : '$')}{plan.currency === 'USD' ? plan.amount.toFixed(2) : plan.amount.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginBottom: 14 }}>
                one-time · {plan.currency} {plan.per_token_rate.toFixed(plan.currency === 'USD' ? 4 : 2)}/token
              </div>

              <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', marginBottom: 12 }} />

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', flex: 1 }}>
                {features.map((f) => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.75)', padding: '2.5px 0', lineHeight: 1.45 }}>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                      <circle cx="7" cy="7" r="6" fill={style.color + '33'}/>
                      <path d="M4 7l2 2 4-4" stroke={style.color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    {f}
                  </li>
                ))}
                {locked.map((f) => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.22)', padding: '2.5px 0', lineHeight: 1.45, textDecoration: 'line-through' }}>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1, opacity: 0.3 }}>
                      <circle cx="7" cy="7" r="6" fill="rgba(255,255,255,0.07)"/>
                      <path d="M5 5l4 4M9 5l-4 4" stroke="rgba(255,255,255,0.3)" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleBuy(plan.key)}
                disabled={!!loading}
                style={{ width: '100%', border: 'none', borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', background: style.color, color: style.btnText, opacity: loading && !isLoading ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'inherit', transition: 'opacity .15s' }}>
                {isLoading ? (
                  <>
                    <svg style={{ animation: 'spin 1s linear infinite' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83"/>
                    </svg>
                    Redirecting…
                  </>
                ) : `Get ${plan.label}`}
              </button>
            </div>
          )
        })}
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 11, padding: '13px 16px', marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 9 }}>Included in every plan</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
          {[['100 tokens','per video render'],['Re-renders','always free'],['Tokens','never expire'],['Instant credit','on payment'],['Email receipt','after purchase'],['CapCut export','ready to import']].map(([v, l]) => (
            <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#2DD4BF', flexShrink: 0 }} />
              <span><strong style={{ color: 'rgba(255,255,255,0.88)' }}>{v}</strong> {l}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11.5, color: 'rgba(255,255,255,0.25)', marginBottom: 14 }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="4" width="12" height="9" rx="1.5"/><path d="M2 7h12"/></svg>
        Secured by Flutterwave · Card, bank transfer, USSD
      </div>

      {onBack && (
        <div style={{ textAlign: 'center' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', padding: 4 }}>
            ← Back
          </button>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
