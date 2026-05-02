import { useState, useRef, useEffect } from 'react'

/**
 * Voice sample URLs — use short ElevenLabs preview clips or your own hosted samples.
 * For now these use publicly available ElevenLabs voice preview URLs.
 * Replace with your own hosted samples on R2/CDN once you have them.
 */
const VOICE_SAMPLES: Record<string, string> = {
  Marcus:  'https://storage.googleapis.com/eleven-public-prod/premade/voices/TxGEqnHWrfWFTfGW9XjX/preview.mp3',
  Sophie:  'https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/preview.mp3',
  Alex:    'https://storage.googleapis.com/eleven-public-prod/premade/voices/ErXwobaYiN019PkySvjV/preview.mp3',
  Jordan:  'https://storage.googleapis.com/eleven-public-prod/premade/voices/VR6AewLTigWG4xSOukaG/preview.mp3',
  Luna:    'https://storage.googleapis.com/eleven-public-prod/premade/voices/pNInz6obpgDQGcFmaJgB/preview.mp3',
  Kai:     'https://storage.googleapis.com/eleven-public-prod/premade/voices/yoZ06aMxZJJ28mfd3POQ/preview.mp3',
}

interface VoiceSamplePlayerProps {
  voiceName: string
  className?: string
}

export default function VoiceSamplePlayer({ voiceName, className = '' }: VoiceSamplePlayerProps) {
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const animRef  = useRef<number | null>(null)

  const sampleUrl = VOICE_SAMPLES[voiceName]

  // Cleanup on unmount or voice change
  useEffect(() => {
    return () => {
      stopAudio()
    }
  }, [voiceName])

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
    const audio = audioRef.current
    if (!audio) return
    if (audio.duration) {
      setProgress((audio.currentTime / audio.duration) * 100)
    }
    if (!audio.paused && !audio.ended) {
      animRef.current = requestAnimationFrame(tick)
    }
  }

  async function togglePlay() {
    if (!sampleUrl) return
    setError(false)

    if (playing) {
      stopAudio()
      return
    }

    setLoading(true)
    const audio = new Audio(sampleUrl)
    audioRef.current = audio

    audio.oncanplaythrough = () => setLoading(false)
    audio.onended = () => {
      setPlaying(false)
      setProgress(0)
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
    audio.onerror = () => {
      setError(true)
      setLoading(false)
      setPlaying(false)
    }
    audio.onplay = () => {
      setPlaying(true)
      setLoading(false)
      animRef.current = requestAnimationFrame(tick)
    }

    try {
      await audio.play()
    } catch {
      setError(true)
      setLoading(false)
    }
  }

  if (!sampleUrl) return null

  return (
    <button
      onClick={(e) => { e.stopPropagation(); togglePlay() }}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-[11.5px] font-medium
        ${playing
          ? 'bg-violet-500/20 border border-violet-500/40 text-violet-300'
          : 'bg-white/5 border border-white/10 text-white/50 hover:bg-white/8 hover:text-white/70'
        } ${className}`}
      title={playing ? 'Stop preview' : `Preview ${voiceName}`}
    >
      {loading ? (
        <>
          <svg className="animate-spin w-3 h-3 text-violet-400" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="2" strokeDasharray="6 6"/>
          </svg>
          <span>Loading...</span>
        </>
      ) : error ? (
        <>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6" cy="6" r="5"/><path d="M6 4v3M6 8.5v.5"/>
          </svg>
          <span>Unavailable</span>
        </>
      ) : playing ? (
        <>
          {/* Animated sound bars */}
          <span className="flex items-end gap-px h-3">
            {[1, 2, 3].map((i) => (
              <span
                key={i}
                className="w-0.5 bg-violet-400 rounded-sm animate-pulse"
                style={{
                  height: `${[8, 12, 6][i - 1]}px`,
                  animationDelay: `${i * 0.15}s`,
                  animationDuration: '0.6s',
                }}
              />
            ))}
          </span>
          <span>Stop</span>
          {/* Progress bar */}
          <div className="w-10 h-0.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-400 rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 1.5l7 3.5-7 3.5V1.5z"/>
          </svg>
          <span>Preview</span>
        </>
      )}
    </button>
  )
}
