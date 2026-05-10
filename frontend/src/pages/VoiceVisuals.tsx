import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { useAuthStore } from '../authStore'
import { getTokenBalance, startRender, type TokenBalance } from '../lib/api'
import { Button, Card, CardTitle, Chip, PageHeader } from '../components/ui'
import VoiceDropdown from '../components/VoiceDropdown'
import { getVoiceByName } from '../lib/voice_config'

const STABILITY_OPTIONS = ['high', 'medium', 'low']
const VISUAL_SOURCES = [
  { value: 'mixed',        label: 'Mixed (Pexels + AI)',    plan: 'free' },
  { value: 'pexels_video', label: 'Stock video (Pexels)',   plan: 'free' },
  { value: 'pexels_photo', label: 'Stock photos (Pexels)',  plan: 'free' },
  { value: 'dalle',        label: 'AI images (DALL-E 3)',   plan: 'pro'  },
]
const SUBTITLE_STYLES = ['viral', 'minimal', 'karaoke', 'none']
const MUSIC_OPTIONS   = ['none', 'upbeat', 'cinematic', 'lofi', 'inspiring']

export default function VoiceVisuals() {
  const user              = useAuthStore((s) => s.user)
  const userPlan          = user?.plan || 'free'
  const canUseDalle       = userPlan === 'pro' || userPlan === 'studio'
  const voiceConfig       = useStore((s) => s.voiceConfig)
  const setVoiceConfig    = useStore((s) => s.setVoiceConfig)
  const getRenderRequest  = useStore((s) => s.getRenderRequest)
  const setJobId          = useStore((s) => s.setJobId)
  const setRenderProgress = useStore((s) => s.setRenderProgress)
  const setStep           = useStore((s) => s.setStep)
  const markStepComplete  = useStore((s) => s.markStepComplete)
  const scenes            = useStore((s) => s.scenes)

  const [loading,      setLoading]      = useState(false)
  const [renderError,  setRenderError]  = useState('')
  const [tokenBalance, setTokenBalance] = useState<TokenBalance | null>(null)

  useEffect(() => {
    getTokenBalance().then(setTokenBalance).catch(() => {})
  }, [])

  async function handleRender() {
    setLoading(true)
    setRenderError('')
    try {
      const req = getRenderRequest()
      const { job_id } = await startRender(req)
      setJobId(job_id)
      setRenderProgress(0, 'Queued…', 'queued')
      markStepComplete('voice')
      setStep('export')
    } catch (e: any) {
      const detail = e?.response?.data?.detail
      if (detail?.error === 'insufficient_tokens') {
        setRenderError(
          `Not enough tokens. You have ${detail.tokens_remaining} tokens but need ${detail.cost_per_video} to render a new video.`
        )
        getTokenBalance().then(setTokenBalance).catch(() => {})
      } else if (detail?.error === 'scene_limit_exceeded') {
        setRenderError(detail.message)
        document.dispatchEvent(new CustomEvent('show-upgrade-prompt', {
          detail: { reason: 'scene_limit', max: detail.max_scenes }
        }))
      } else if (detail?.error === 'daily_limit_exceeded') {
        setRenderError(detail.message)
        document.dispatchEvent(new CustomEvent('show-upgrade-prompt', {
          detail: { reason: 'daily_limit', max: detail.daily_limit }
        }))
      } else {
        const friendly = (e as any)?.friendlyMessage || 'Unable to start render. Please try again.'
        setRenderError(friendly)
      }
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // Resolve the Edge TTS voice ID from the stored voice name
  const selectedVoiceId = getVoiceByName(voiceConfig.voice_name)?.id ?? 'en-US-GuyNeural'
  const speedValue      = parseFloat(voiceConfig.voice_speed.toString())
  const canRender       = !tokenBalance || tokenBalance.tokens_remaining >= (tokenBalance.cost_per_video ?? 100)

  return (
    <div>
      <PageHeader
        title="Voice & visuals"
        subtitle="Configure audio and imagery — then render your video"
      />

      {/* ── Voice ── */}
      <Card className="mb-4">
        <CardTitle>Voice</CardTitle>

        {/* Dropdown replaces the old 3×2 grid */}
        <div className="mb-4">
          <VoiceDropdown
            selectedVoiceId={selectedVoiceId}
            onChange={(_voiceId, voiceName) => setVoiceConfig({ voice_name: voiceName })}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-medium text-white/50 mb-2">Speed</label>
            <div className="flex items-center gap-3">
              <input
                type="range" min="0.8" max="1.2" step="0.1"
                value={speedValue}
                onChange={(e) => setVoiceConfig({ voice_speed: parseFloat(e.target.value) })}
                className="flex-1 accent-violet-500"
              />
              <span className="text-[13px] text-white/70 w-8">{speedValue}×</span>
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-white/50 mb-2">Stability</label>
            <div className="flex gap-2">
              {STABILITY_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setVoiceConfig({ voice_stability: s })}
                  className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium border transition-all
                    ${voiceConfig.voice_stability === s
                      ? 'bg-violet-500/15 border-violet-500/35 text-violet-300'
                      : 'bg-[#1A1A24] border-white/10 text-white/50 hover:border-white/20'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* ── Visual source ── */}
      <Card className="mb-4">
        <CardTitle>Visual source</CardTitle>
        <div className="flex flex-wrap gap-2">
          {VISUAL_SOURCES.map((s) => (
            <Chip
              key={s.value}
              label={s.value === 'dalle' && !canUseDalle ? s.label + ' 🔒' : s.label}
              selected={voiceConfig.visual_source === s.value}
              onClick={() => {
                if (s.value === 'dalle' && !canUseDalle) {
                  document.dispatchEvent(new CustomEvent('show-upgrade-prompt', { detail: { reason: 'ai_images' } }))
                  return
                }
                setVoiceConfig({ visual_source: s.value as any })
              }}
            />
          ))}
        </div>
      </Card>

      {/* ── Subtitle + music ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <Card className="mb-0">
          <CardTitle>Subtitle style</CardTitle>
          <div className="flex flex-wrap gap-2">
            {SUBTITLE_STYLES.map((s) => (
              <Chip
                key={s} label={s}
                selected={voiceConfig.subtitle_style === s}
                onClick={() => setVoiceConfig({ subtitle_style: s as any })}
              />
            ))}
          </div>
        </Card>
        <Card className="mb-0">
          <CardTitle>Background music</CardTitle>
          <div className="flex flex-wrap gap-2">
            {MUSIC_OPTIONS.map((m) => (
              <Chip
                key={m} label={m}
                selected={voiceConfig.music === m}
                onClick={() => setVoiceConfig({ music: m })}
              />
            ))}
          </div>
        </Card>
      </div>

      {/* ── Render summary ── */}
      <div className="bg-[#1A1A24] rounded-xl p-4 mb-4 border border-white/[0.07]">
        <p className="text-[11px] text-white/35 uppercase tracking-widest font-semibold mb-2">
          Render summary
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[13px] text-white/65">
          <span><span className="text-white/80 font-medium">{scenes.length}</span> scenes</span>
          <span>
            <span className="text-white/80 font-medium">
              {scenes.reduce((acc, sc) => acc + sc.duration, 0)}s
            </span> total
          </span>
          <span>Voice: <span className="text-white/80 font-medium">{voiceConfig.voice_name}</span></span>
          <span>Subs: <span className="text-white/80 font-medium">{voiceConfig.subtitle_style}</span></span>
        </div>
      </div>

      {/* ── Token balance ── */}
      {tokenBalance && (
        <div className="mb-4 bg-[#111118] border border-white/[0.07] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-white/40 uppercase tracking-widest">
              Token balance
            </span>
            <span className="text-[13px] font-bold text-white">
              {tokenBalance.tokens_remaining}
              <span className="text-white/35 font-normal"> / {tokenBalance.tokens_total}</span>
            </span>
          </div>
          <div className="h-1.5 bg-white/[0.07] rounded-full overflow-hidden mb-2">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, Math.round((tokenBalance.tokens_remaining / tokenBalance.tokens_total) * 100))}%`,
                background: tokenBalance.tokens_remaining < 200 ? '#FF6B6B'
                          : tokenBalance.tokens_remaining < 500 ? '#F59E0B' : '#2DD4BF',
              }}
            />
          </div>
          <div className="flex justify-between">
            <span className="text-[11.5px] text-white/35">
              Cost: <span className="text-white/55 font-medium">{tokenBalance.cost_per_video} tokens</span>
              {' '}per new video · Re-renders are free
            </span>
            {!canRender && (
              <span className="text-[11.5px] text-red-400 font-semibold">Insufficient tokens</span>
            )}
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {renderError && (
        <div className="mb-4 bg-red-500/10 border border-red-500/25 rounded-xl p-4 text-[13px] text-red-300">
          {renderError}
        </div>
      )}

      <Button
        variant="primary"
        onClick={handleRender}
        loading={loading}
        disabled={loading || !canRender}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <polygon points="4,2 14,8 4,14" />
        </svg>
        Render video
      </Button>

      {!canRender && (
        <p className="mt-3 text-[12px] text-white/35">
          You need {tokenBalance?.cost_per_video ?? 100} tokens to render.
          Contact support to top up your balance.
        </p>
      )}
    </div>
  )
}
