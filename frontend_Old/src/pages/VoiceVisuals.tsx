import { useState } from 'react'
import { useStore } from '../store'
import { startRender } from '../lib/api'
import { Button, Card, CardTitle, Chip, Select, PageHeader } from '../components/ui'

const VOICES = [
  { name: 'Marcus', desc: 'Deep, authoritative' },
  { name: 'Sophie', desc: 'Warm, friendly' },
  { name: 'Alex', desc: 'Energetic, young' },
  { name: 'Jordan', desc: 'Professional, clear' },
  { name: 'Luna', desc: 'Calm, storytelling' },
  { name: 'Kai', desc: 'Casual, conversational' },
]

const SPEED_OPTIONS = ['0.8× — slow', '1.0× — normal', '1.1× — slightly fast', '1.2× — fast']
const STABILITY_OPTIONS = ['high', 'medium', 'low']
const VISUAL_SOURCES = [
  { value: 'mixed', label: 'Mixed (Pexels + AI)' },
  { value: 'pexels_video', label: 'Stock video (Pexels)' },
  { value: 'pexels_photo', label: 'Stock photos (Pexels)' },
  { value: 'dalle', label: 'AI images (DALL-E 3)' },
]
const SUBTITLE_STYLES = ['viral', 'minimal', 'karaoke', 'none']
const MUSIC_OPTIONS = ['none', 'upbeat', 'cinematic', 'lofi', 'inspiring']

export default function VoiceVisuals() {
  const voiceConfig = useStore((s) => s.voiceConfig)
  const setVoiceConfig = useStore((s) => s.setVoiceConfig)
  const getRenderRequest = useStore((s) => s.getRenderRequest)
  const setJobId = useStore((s) => s.setJobId)
  const setRenderProgress = useStore((s) => s.setRenderProgress)
  const setStep = useStore((s) => s.setStep)
  const markStepComplete = useStore((s) => s.markStepComplete)
  const scenes = useStore((s) => s.scenes)

  const [loading, setLoading] = useState(false)

  async function handleRender() {
    setLoading(true)
    try {
      const req = getRenderRequest()
      const jobId = await startRender(req)
      setJobId(jobId)
      setRenderProgress(0, 'Queued…', 'queued')
      markStepComplete('voice')
      setStep('export')
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const speedValue = parseFloat(voiceConfig.voice_speed.toString())

  return (
    <div>
      <PageHeader
        title="Voice & visuals"
        subtitle="Configure audio and imagery — then render your video"
      />

      {/* Voice selection */}
      <Card className="mb-4">
        <CardTitle>Voice (ElevenLabs)</CardTitle>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {VOICES.map((v) => (
            <button
              key={v.name}
              onClick={() => setVoiceConfig({ voice_name: v.name })}
              className={`
                p-3 rounded-xl border text-center transition-all
                ${voiceConfig.voice_name === v.name
                  ? 'bg-violet-500/12 border-violet-500/35'
                  : 'bg-[#1A1A24] border-white/[0.07] hover:border-white/15'}
              `}
            >
              <p className="text-[13px] font-medium text-white mb-0.5">{v.name}</p>
              <p className="text-[11px] text-white/40">{v.desc}</p>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-medium text-white/50 mb-2">Speed</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.8"
                max="1.2"
                step="0.1"
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
                  className={`
                    flex-1 py-1.5 rounded-lg text-[12px] font-medium border transition-all
                    ${voiceConfig.voice_stability === s
                      ? 'bg-violet-500/15 border-violet-500/35 text-violet-300'
                      : 'bg-[#1A1A24] border-white/10 text-white/50 hover:border-white/20'}
                  `}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Visual source */}
      <Card className="mb-4">
        <CardTitle>Visual source</CardTitle>
        <div className="flex flex-wrap gap-2">
          {VISUAL_SOURCES.map((s) => (
            <Chip
              key={s.value}
              label={s.label}
              selected={voiceConfig.visual_source === s.value}
              onClick={() => setVoiceConfig({ visual_source: s.value as any })}
            />
          ))}
        </div>
      </Card>

      {/* Subtitle style */}
      <Card className="mb-4">
        <CardTitle>Subtitle style</CardTitle>
        <div className="flex flex-wrap gap-2">
          {SUBTITLE_STYLES.map((s) => (
            <Chip
              key={s}
              label={s}
              selected={voiceConfig.subtitle_style === s}
              onClick={() => setVoiceConfig({ subtitle_style: s as any })}
            />
          ))}
        </div>
      </Card>

      {/* Background music */}
      <Card className="mb-6">
        <CardTitle>Background music</CardTitle>
        <div className="flex flex-wrap gap-2">
          {MUSIC_OPTIONS.map((m) => (
            <Chip
              key={m}
              label={m}
              selected={voiceConfig.music === m}
              onClick={() => setVoiceConfig({ music: m })}
            />
          ))}
        </div>
      </Card>

      {/* Summary */}
      <div className="bg-[#1A1A24] rounded-xl p-4 mb-6 border border-white/[0.07]">
        <p className="text-[12px] text-white/40 mb-2">Render summary</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[13px] text-white/70">
          <span>{scenes.length} scenes</span>
          <span>{scenes.reduce((s, sc) => s + sc.duration, 0)}s total</span>
          <span>Voice: {voiceConfig.voice_name}</span>
          <span>Visuals: {voiceConfig.visual_source}</span>
          <span>Subtitles: {voiceConfig.subtitle_style}</span>
        </div>
      </div>

      <Button variant="primary" onClick={handleRender} loading={loading}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <polygon points="4,2 14,8 4,14" />
        </svg>
        Render video
      </Button>
    </div>
  )
}


