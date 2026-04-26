import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { streamScript, generateScenes } from '../lib/api'
import { Button, Card, Badge, LoadingState, PageHeader, ProgressBar } from '../components/ui'

export default function Script() {
  const config = useStore((s) => s.config)
  const selectedIdea = useStore((s) => s.selectedIdea)
  const script = useStore((s) => s.script)
  const wordCount = useStore((s) => s.wordCount)
  const estimatedDuration = useStore((s) => s.estimatedDuration)
  const setScript = useStore((s) => s.setScript)
  const setScenes = useStore((s) => s.setScenes)
  const setStep = useStore((s) => s.setStep)
  const markStepComplete = useStore((s) => s.markStepComplete)

  const [streaming, setStreaming] = useState(false)
  const [streamedText, setStreamedText] = useState('')
  const [scenesLoading, setScenesLoading] = useState(false)
  const [started, setStarted] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)

  // Auto-start streaming on mount if we have an idea and no script yet
  useEffect(() => {
    if (selectedIdea && !script && !started) {
      setStarted(true)
      startStreaming()
    }
    if (script) {
      setStreamedText(script)
    }
  }, [])

  function startStreaming() {
    if (!selectedIdea) return
    setStreaming(true)
    setStreamedText('')

    const stop = streamScript(
      {
        idea: selectedIdea,
        niche: config.niche,
        style: config.style,
        platform: config.platform,
        tone: config.tone,
        audience: config.audience,
      },
      (chunk) => setStreamedText((prev) => prev + chunk),
      () => {
        setStreaming(false)
        stopRef.current = null
        // Save to store when done
        setStreamedText((final) => {
          const wc = final.split(/\s+/).length
          const dur = Math.round((wc / 150) * 60)
          setScript(final, wc, dur)
          return final
        })
      },
      (err) => {
        console.error('Stream error:', err)
        setStreaming(false)
      }
    )
    stopRef.current = stop
  }

  async function handleBreakIntoScenes() {
    const finalScript = streamedText
    setScenesLoading(true)
    try {
      const result = await generateScenes(finalScript, config.platform)
      setScenes(result.scenes)
      markStepComplete('script')
      setStep('scenes')
    } catch (e) {
      console.error(e)
    } finally {
      setScenesLoading(false)
    }
  }

  // Render script with section labels highlighted
  function renderFormattedScript(text: string) {
    return text.split('\n').map((line, i) => {
      const sectionMatch = line.match(/^\[([A-Z\s]+)\]$/)
      if (sectionMatch) {
        return (
          <div key={i} className="mt-4 mb-1">
            <Badge color="purple">{sectionMatch[1]}</Badge>
          </div>
        )
      }
      const visualMatch = line.match(/\[([^\]]+)\]/)
      if (visualMatch && !sectionMatch) {
        return (
          <p key={i} className="text-[13.5px] leading-7 text-white/80">
            {line.replace(/\[([^\]]+)\]/g, '').trim() && (
              <span>{line.replace(/\[([^\]]+)\]/g, (m, v) => ` `).trim()} </span>
            )}
            {line.match(/\[([^\]]+)\]/g)?.map((m, j) => (
              <span key={j} className="inline-flex items-center px-1.5 py-0.5 bg-teal-500/12 text-teal-400 text-[11px] rounded mx-0.5">
                {m}
              </span>
            ))}
          </p>
        )
      }
      if (!line.trim()) return <div key={i} className="h-2" />
      return (
        <p key={i} className="text-[13.5px] leading-7 text-white/80">
          {line}
        </p>
      )
    })
  }

  const currentWC = streamedText.split(/\s+/).filter(Boolean).length
  const currentDur = Math.round((currentWC / 150) * 60)

  return (
    <div>
      <PageHeader
        title="Script"
        subtitle="AI-written voiceover script — edit before breaking into scenes"
      />

      {/* Stats */}
      {streamedText && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Words', value: currentWC },
            { label: 'Est. duration', value: `${currentDur}s` },
            { label: 'Visual cues', value: (streamedText.match(/\[[A-Z][^\]]+\]/g) ?? []).length },
            { label: 'Est. scenes', value: `~${Math.ceil(currentDur / 6)}` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#1A1A24] rounded-xl p-3.5">
              <p className="text-[22px] font-bold font-display text-white">{value}</p>
              <p className="text-[11px] text-white/40 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Script body */}
      <Card className="mb-5 min-h-[200px]">
        {!streamedText && !streaming && (
          <LoadingState label="Starting script generation…" />
        )}
        {(streamedText || streaming) && (
          <div className="space-y-0.5">
            {renderFormattedScript(streamedText)}
            {streaming && (
              <span className="inline-block w-0.5 h-3.5 bg-violet-400 animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        )}
      </Card>

      {/* Actions */}
      {!streaming && streamedText && (
        <div className="flex gap-3">
          <Button
            variant="primary"
            onClick={handleBreakIntoScenes}
            loading={scenesLoading}
          >
            Break into scenes →
          </Button>
          <Button
            variant="ghost"
            onClick={() => { setStreamedText(''); setScript('', 0, 0); startStreaming() }}
            disabled={streaming}
          >
            Rewrite script
          </Button>
        </div>
      )}
    </div>
  )
}
