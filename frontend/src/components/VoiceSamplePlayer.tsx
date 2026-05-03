import { useState, useRef, useEffect } from 'react'

const BASE = 'https://sceneforge-production-8d19.up.railway.app'

// Read token the same way streamScript does in api.ts
function getToken(): string {
  try {
    const s = JSON.parse(localStorage.getItem('sceneforge-auth') || '{}')
    return s?.state?.token || ''
  } catch {
    return ''
  }
}

interface Props {
  voiceName: string
  className?: string
}

export default function VoiceSamplePlayer({ voiceName, className = '' }: Props) {
  const [playing,  setPlaying]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [progress, setProgress] = useState(0)
  const [error,    setError]    = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const animRef  = useRef<number | null>(null)

  useEffect(() => { return () => stopAudio() }, [voiceName])

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    if (animRef.current) cancelAnimationFrame(animRef.current)
    setPlaying(false)
    setProgress(0)
    setLoading(false)
  }

  function tick() {
    const a = audioRef.current
    if (!a) return
    if (a.duration) setProgress((a.currentTime / a.duration) * 100)
    if (!a.paused && !a.ended) animRef.current = requestAnimationFrame(tick)
  }

  async function togglePlay(e: React.MouseEvent) {
    e.stopPropagation()
    setError(false)
    if (playing) { stopAudio(); return }
    setLoading(true)

    const token = getToken()
    const url = `${BASE}/api/voice/sample/${encodeURIComponent(voiceName)}`
    const audio = new Audio()
    audioRef.current = audio

    audio.oncanplaythrough = () => setLoading(false)
    audio.onended = () => { setPlaying(false); setProgress(0) }
    audio.onerror = () => { setError(true); setLoading(false); setPlaying(false) }
    audio.onplay  = () => {
      setPlaying(true)
      setLoading(false)
      animRef.current = requestAnimationFrame(tick)
    }

    try {
      const resp = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!resp.ok) throw new Error(`${resp.status}`)
      const blob = await resp.blob()
      audio.src = URL.createObjectURL(blob)
      await audio.play()
    } catch {
      setError(true)
      setLoading(false)
    }
  }

  return (
    <button
      onClick={togglePlay}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium
        transition-all border flex-shrink-0
        ${playing
          ? 'bg-violet-500/20 border-violet-500/35 text-violet-300'
          : error
          ? 'bg-red-500/10 border-red-500/20 text-red-400/70'
          : 'bg-white/5 border-white/10 text-white/45 hover:bg-white/8 hover:text-white/65'
        } ${className}`}
      title={playing ? 'Stop preview' : `Preview ${voiceName}`}
    >
      {loading ? (
        <>
          <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="2"
              strokeDasharray="6 6" strokeLinecap="round"/>
          </svg>
          <span>Loading</span>
        </>
      ) : error ? (
        <>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 4v3M6 8.5v.5"/><circle cx="6" cy="6" r="5"/>
          </svg>
          <span>Retry</span>
        </>
      ) : playing ? (
        <>
          <span className="flex items-end gap-px h-2.5">
            {[0.6, 1, 0.7].map((h, i) => (
              <span key={i} className="w-0.5 bg-violet-400 rounded-full animate-pulse"
                style={{ height: `${h * 10}px`, animationDelay: `${i * 0.2}s` }} />
            ))}
          </span>
          <span>Stop</span>
          <div className="w-8 h-0.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-violet-400 rounded-full"
              style={{ width: `${progress}%`, transition: 'width 0.1s linear' }} />
          </div>
        </>
      ) : (
        <>
          <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 1.5l7 3.5-7 3.5V1.5z"/>
          </svg>
          <span>Preview</span>
        </>
      )}
    </button>
  )
}
