import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../authStore'
import { getAvailableVoices, type VoiceOption } from '../lib/voice_config'

const BASE = 'https://sceneforge-production-8d19.up.railway.app'

function getToken(): string {
  try {
    const s = JSON.parse(localStorage.getItem('sceneforge-auth') || '{}')
    return s?.state?.token || ''
  } catch { return '' }
}

// ── Mini inline audio player ──────────────────────────────────────────────────
function PreviewButton({ voiceId, voiceName }: { voiceId: string; voiceName: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef   = useRef<number | null>(null)

  useEffect(() => () => stop(), [voiceId])

  function stop() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; audioRef.current = null }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setState('idle'); setProgress(0)
  }

  function tick() {
    const a = audioRef.current
    if (!a) return
    if (a.duration) setProgress((a.currentTime / a.duration) * 100)
    if (!a.paused && !a.ended) rafRef.current = requestAnimationFrame(tick)
  }

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (state === 'playing') { stop(); return }
    setState('loading')
    const token = getToken()
    try {
      const resp = await fetch(`${BASE}/api/voice/sample/${encodeURIComponent(voiceName)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!resp.ok) throw new Error()
      const blob = await resp.blob()
      const audio = new Audio(URL.createObjectURL(blob))
      audioRef.current = audio
      audio.onplay    = () => { setState('playing'); rafRef.current = requestAnimationFrame(tick) }
      audio.onended   = () => { setState('idle'); setProgress(0) }
      audio.onerror   = () => setState('error')
      await audio.play()
    } catch { setState('error') }
  }

  return (
    <button
      onClick={toggle}
      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-medium
        border transition-all flex-shrink-0
        ${state === 'playing' ? 'bg-violet-500/20 border-violet-500/30 text-violet-300'
          : state === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400/60'
          : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60 hover:bg-white/8'}`}
    >
      {state === 'loading' ? (
        <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="2" strokeDasharray="6 6"/>
        </svg>
      ) : state === 'playing' ? (
        <span className="flex items-end gap-px h-2.5">
          {[6, 10, 7].map((h, i) => (
            <span key={i} className="w-0.5 bg-violet-400 rounded-full animate-pulse"
              style={{ height: h, animationDelay: `${i * 0.15}s`, animationDuration: '0.5s' }} />
          ))}
        </span>
      ) : (
        <svg width="7" height="7" viewBox="0 0 10 10" fill="currentColor">
          <path d="M2 1.5l7 3.5-7 3.5V1.5z"/>
        </svg>
      )}
      <span>{state === 'loading' ? 'Loading' : state === 'playing' ? 'Stop' : state === 'error' ? 'Retry' : 'Preview'}</span>
      {state === 'playing' && (
        <div className="w-6 h-0.5 bg-white/10 rounded-full overflow-hidden ml-0.5">
          <div className="h-full bg-violet-400 rounded-full" style={{ width: `${progress}%`, transition: 'width 0.1s linear' }} />
        </div>
      )}
    </button>
  )
}

// ── Main dropdown ─────────────────────────────────────────────────────────────
interface Props {
  selectedVoiceId: string
  onChange: (voiceId: string, voiceName: string) => void
}

export default function VoiceDropdown({ selectedVoiceId, onChange }: Props) {
  const user = useAuthStore(s => s.user)
  const plan = user?.plan || 'free'

  const voices    = getAvailableVoices(plan)
  const freeCount = voices.filter(v => v.free).length
  const isPaid    = !['free'].includes(plan?.toLowerCase())

  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'male' | 'female'>('all')
  const dropRef = useRef<HTMLDivElement>(null)

  const selected = voices.find(v => v.id === selectedVoiceId) || voices[0]

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = voices.filter(v => {
    const matchSearch = !search ||
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.accent.toLowerCase().includes(search.toLowerCase()) ||
      v.style.toLowerCase().includes(search.toLowerCase())
    const matchGender = filter === 'all' || v.gender.toLowerCase() === filter
    return matchSearch && matchGender
  })

  // Group by accent
  const groups = filtered.reduce<Record<string, VoiceOption[]>>((acc, v) => {
    const key = v.accent
    if (!acc[key]) acc[key] = []
    acc[key].push(v)
    return acc
  }, {})

  function select(voice: VoiceOption) {
    onChange(voice.id, voice.name)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={dropRef} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border
          transition-all text-left
          ${open ? 'bg-violet-500/10 border-violet-500/30' : 'bg-[#1A1A24] border-white/10 hover:border-white/20'}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[12px] font-bold
            ${selected?.gender === 'Female' ? 'bg-pink-500/15 text-pink-400' : 'bg-blue-500/15 text-blue-400'}`}>
            {selected?.name?.[0] || '?'}
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-white">{selected?.name || 'Select voice'}</p>
            <p className="text-[11px] text-white/40 truncate">{selected?.style} · {selected?.accent}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {selected && <PreviewButton voiceId={selected.id} voiceName={selected.name} />}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round"
            className={`text-white/30 transition-transform ${open ? 'rotate-180' : ''}`}>
            <path d="M3 5l4 4 4-4"/>
          </svg>
        </div>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#111118] border border-white/10
          rounded-xl shadow-2xl z-50 overflow-hidden">

          {/* Search + filter bar */}
          <div className="p-3 border-b border-white/[0.07] flex gap-2">
            <div className="flex-1 relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25 w-3.5 h-3.5"
                viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5l3 3"/>
              </svg>
              <input
                autoFocus
                type="text"
                placeholder="Search voices..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5
                  text-[12px] text-white/80 placeholder-white/25 outline-none
                  focus:border-violet-500/40 focus:bg-violet-500/5"
              />
            </div>
            <div className="flex gap-1">
              {(['all', 'male', 'female'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium capitalize transition-all
                    ${filter === f ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                      : 'text-white/35 hover:text-white/55 hover:bg-white/5 border border-transparent'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Free plan upgrade nudge */}
          {!isPaid && (
            <div className="mx-3 mt-2.5 mb-1 bg-amber-500/8 border border-amber-500/20 rounded-lg
              px-3 py-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold text-amber-400">Free plan — 6 voices</p>
                <p className="text-[10.5px] text-white/35 mt-0.5">Upgrade to access {voices.length > freeCount ? `${24 - freeCount} more voices` : 'all voices'} including British, Australian & more</p>
              </div>
              <button
                onClick={() => { setOpen(false); document.dispatchEvent(new CustomEvent('show-upgrade-prompt', { detail: { reason: 'voice_limit' } })) }}
                className="text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20
                  px-3 py-1.5 rounded-lg hover:bg-amber-500/20 transition-colors flex-shrink-0">
                Upgrade
              </button>
            </div>
          )}

          {/* Voice list */}
          <div className="max-h-72 overflow-y-auto p-2 scrollbar-thin">
            {Object.keys(groups).length === 0 ? (
              <p className="text-center text-white/30 text-[12px] py-6">No voices match your search</p>
            ) : (
              Object.entries(groups).map(([accent, accentVoices]) => (
                <div key={accent} className="mb-1">
                  <p className="text-[9.5px] font-bold text-white/20 uppercase tracking-widest px-2 py-1">
                    {accent}
                  </p>
                  {accentVoices.map(voice => (
                    <button
                      key={voice.id}
                      onClick={() => select(voice)}
                      className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left
                        transition-all mb-0.5
                        ${voice.id === selectedVoiceId
                          ? 'bg-violet-500/15 border border-violet-500/20'
                          : 'hover:bg-white/4 border border-transparent'}`}
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0
                        text-[11px] font-bold
                        ${voice.gender === 'Female' ? 'bg-pink-500/15 text-pink-400' : 'bg-blue-500/15 text-blue-400'}`}>
                        {voice.name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[13px] font-medium ${voice.id === selectedVoiceId ? 'text-violet-300' : 'text-white/80'}`}>
                            {voice.name}
                          </span>
                          <span className={`text-[9.5px] px-1.5 py-0.5 rounded-full font-medium
                            ${voice.gender === 'Female'
                              ? 'bg-pink-500/10 text-pink-400/70'
                              : 'bg-blue-500/10 text-blue-400/70'}`}>
                            {voice.gender}
                          </span>
                          {voice.id === selectedVoiceId && (
                            <svg className="ml-auto w-3 h-3 text-violet-400" viewBox="0 0 12 12"
                              fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M2 6l3 3 5-5"/>
                            </svg>
                          )}
                        </div>
                        <p className="text-[11px] text-white/35 truncate">{voice.style}</p>
                      </div>
                      <PreviewButton voiceId={voice.id} voiceName={voice.name} />
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* Footer count */}
          <div className="px-3 py-2 border-t border-white/[0.06] flex items-center justify-between">
            <span className="text-[10.5px] text-white/25">
              {filtered.length} voice{filtered.length !== 1 ? 's' : ''} available
            </span>
            {isPaid && (
              <span className="text-[10.5px] text-teal-400/60 font-medium">✓ All voices unlocked</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
