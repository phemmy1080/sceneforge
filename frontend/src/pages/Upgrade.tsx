import { useState, useEffect } from 'react'
import { useAuthStore } from '../authStore'
import { getTokenBalance, type TokenBalance } from '../lib/api'
import { api } from '../lib/api'

interface Plan {
  key: string
  label: string
  amount: number
  currency: string
  tokens: number
  per_token_rate: number
}

const PLAN_HIGHLIGHTS: Record<string, { color: string; badge: string; popular?: boolean }> = {
  starter: { color: 'rgba(124,92,255,0.15)', badge: '#A78BFA' },
  pro:     { color: 'rgba(45,212,191,0.12)', badge: '#2DD4BF', popular: true },
  studio:  { color: 'rgba(245,158,11,0.10)', badge: '#F59E0B' },
}

interface Props {
  onBack?: () => void
  exhausted?: boolean  // true = hard block, false = voluntary upgrade
}

export default function Upgrade({ onBack, exhausted = false }: Props) {
  const user = useAuthStore((s) => s.user)
  const [plans, setPlans]         = useState<Plan[]>([])
  const [balance, setBalance]     = useState<TokenBalance | null>(null)
  const [loading, setLoading]     = useState<string | null>(null)
  const [error, setError]         = useState('')

  useEffect(() => {
    api.get('/api/payments/plans').then((r) => setPlans(r.data.plans)).catch(() => {})
    getTokenBalance().then(setBalance).catch(() => {})
  }, [])

  async function handlePurchase(plan: Plan) {
    setLoading(plan.key)
    setError('')
    try {
      const { data } = await api.post('/api/payments/initiate', { plan_key: plan.key })
      // Redirect to Flutterwave hosted payment page
      window.location.href = data.payment_url
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to initiate payment. Please try again.')
      setLoading(null)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">

      {/* Header — exhausted vs voluntary */}
      {exhausted ? (
        <div className="bg-red-500/10 border border-red-500/25 rounded-2xl p-6 mb-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF8888" strokeWidth="1.8">
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 7v5M12 16h.01"/>
            </svg>
          </div>
          <h1 className="text-[22px] font-bold tracking-tight mb-2">Your tokens are exhausted</h1>
          <p className="text-[14px] text-white/50 leading-relaxed max-w-md mx-auto">
            You've used all your tokens. Top up to keep creating videos — each render costs 100 tokens.
          </p>
          {balance && (
            <div className="mt-4 inline-flex items-center gap-2 bg-white/5 px-4 py-2 rounded-full">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-[13px] text-white/60">
                Balance: <span className="text-white/90 font-semibold">{balance.tokens_remaining} tokens</span> remaining
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center mb-8">
          <h1 className="text-[26px] font-bold tracking-tight mb-2">Top up tokens</h1>
          <p className="text-[14px] text-white/50">Choose a plan — tokens never expire</p>
          {balance && (
            <div className="mt-3 inline-flex items-center gap-2 bg-white/5 px-4 py-2 rounded-full">
              <div className="w-2 h-2 rounded-full bg-teal-400" />
              <span className="text-[13px] text-white/60">
                Current balance: <span className="text-white/90 font-semibold">{balance.tokens_remaining} tokens</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-4 mb-6 text-[13px] text-red-300 text-center">
          {error}
        </div>
      )}

      {/* Plans */}
      {plans.length === 0 ? (
        <div className="text-center text-white/30 text-[13px] py-12">Loading plans…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 mb-8">
          {plans.map((plan) => {
            const hl = PLAN_HIGHLIGHTS[plan.key] || PLAN_HIGHLIGHTS.starter
            const isLoading = loading === plan.key
            return (
              <div
                key={plan.key}
                className="relative rounded-2xl border transition-all"
                style={{
                  background: hl.color,
                  borderColor: hl.popular ? hl.badge + '55' : 'rgba(255,255,255,0.08)',
                }}
              >
                {hl.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="text-[10.5px] font-bold px-3 py-1 rounded-full text-black"
                          style={{ background: hl.badge }}>
                      MOST POPULAR
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between p-5">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[15px] font-bold text-white">{plan.label}</span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: hl.badge + '22', color: hl.badge }}>
                        {plan.tokens.toLocaleString()} tokens
                      </span>
                    </div>
                    <p className="text-[12.5px] text-white/45">
                      {Math.floor(plan.tokens / 100)} videos · {plan.currency} {plan.per_token_rate.toFixed(2)} per token
                    </p>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                    <div className="text-right">
                      <p className="text-[22px] font-bold text-white leading-none">
                        {plan.currency} {plan.amount.toLocaleString()}
                      </p>
                      <p className="text-[11px] text-white/35 mt-0.5">one-time</p>
                    </div>
                    <button
                      onClick={() => handlePurchase(plan)}
                      disabled={!!loading}
                      className="px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        background: hl.badge,
                        color: '#000',
                        opacity: loading && !isLoading ? 0.5 : 1,
                      }}
                    >
                      {isLoading ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
                          </svg>
                          Redirecting…
                        </span>
                      ) : 'Buy now'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* What you get */}
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-5 mb-6">
        <p className="text-[11px] font-semibold text-white/35 uppercase tracking-widest mb-3">What you get</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            ['100 tokens', 'per video render'],
            ['Re-renders', 'always free'],
            ['Tokens', 'never expire'],
            ['Instant', 'credit on payment'],
          ].map(([val, label]) => (
            <div key={val} className="flex items-center gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0" />
              <span className="text-[13px] text-white/70">
                <span className="font-semibold text-white">{val}</span> {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Payment info */}
      <div className="flex items-center justify-center gap-3 text-[12px] text-white/30 mb-6">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="4" width="12" height="9" rx="1.5"/>
          <path d="M2 7h12"/>
        </svg>
        Secured by Flutterwave · Card, bank transfer, USSD
      </div>

      {/* Back button */}
      {onBack && !exhausted && (
        <div className="text-center">
          <button onClick={onBack} className="text-[13px] text-white/35 hover:text-white/60 transition-colors">
            ← Back
          </button>
        </div>
      )}
    </div>
  )
}
