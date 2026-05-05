import { useState, useRef, useCallback } from 'react'
import { useStore } from '../store'
import { usePlanLimits } from '../hooks/usePlanLimits'
import { generateScenes } from '../lib/api'
import { Button, Card, CardTitle, PageHeader, LoadingState } from '../components/ui'

type UploadMode = 'script-only' | 'script-and-voice'

export default function UploadScript() {
  const setScript = useStore((s) => s.setScript)
  const setScenes = useStore((s) => s.setScenes)
  const setStep = useStore((s) => s.setStep)
  const markStepComplete = useStore((s) => s.markStepComplete)
  const setUploadedVoicePath = useStore((s) => s.setUploadedVoicePath)
  const config = useStore((s) => s.config)

  const [mode, setMode] = useState<UploadMode>('script-only')
  const { canUploadFootage, isFree } = usePlanLimits()
  const [scriptText, setScriptText] = useState('')
  const [scriptFileName, setScriptFileName] = useState('')
  const [voiceFile, setVoiceFile] = useState<File | null>(null)
  const [voiceDuration, setVoiceDuration] = useState<number | null>(null)
  const [breaking, setBreaking] = useState(false)
  const [error, setError] = useState('')

  const scriptInputRef = useRef<HTMLInputElement>(null)
  const voiceInputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  // ── Script file handling ──────────────────────────────────────────────────
  function handleScriptFile(file: File) {
    if (!file.name.match(/\.(txt|md|docx?)$/i)) {
      setError('Please upload a .txt or .md file')
      return
    }
    setScriptFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = (e.target?.result as string) || ''
      setScriptText(text)
      setError('')
    }
    reader.readAsText(file)
  }

  function handleScriptDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleScriptFile(file)
  }

  // ── Voice file handling ───────────────────────────────────────────────────
  function handleVoiceFile(file: File) {
    if (!file.name.match(/\.(mp3|wav|m4a|ogg|aac)$/i)) {
      setError('Please upload an MP3, WAV, M4A, or AAC file')
      return
    }
    setVoiceFile(file)
    setError('')
    // Get duration via Audio API
    const url = URL.createObjectURL(file)
    const audio = new Audio(url)
    audio.onloadedmetadata = () => {
      setVoiceDuration(Math.round(audio.duration))
      URL.revokeObjectURL(url)
    }
  }

  // ── Scene breakdown ───────────────────────────────────────────────────────
  async function handleBreakIntoScenes() {
    if (!scriptText.trim()) { setError('Please enter or upload a script first'); return }
    setBreaking(true)
    setError('')
    try {
      const result = await generateScenes(scriptText, config.platform)
      const wc = scriptText.split(/\s+/).length
      const est = Math.round(wc / 150 * 60)
      setScript(scriptText, wc, est)
      setScenes(result.scenes)

      // If voice was uploaded, store it for the render worker
      if (voiceFile && mode === 'script-and-voice') {
        const url = URL.createObjectURL(voiceFile)
        setUploadedVoicePath(url)
      }

      markStepComplete('setup')
      markStepComplete('ideas')
      markStepComplete('script')
      setStep('scenes')
    } catch (e: any) {
      setError(e?.message || 'Failed to break script into scenes. Please try again.')
    } finally {
      setBreaking(false)
    }
  }

  const wordCount = scriptText.split(/\s+/).filter(Boolean).length
  const estimatedDuration = Math.round(wordCount / 150 * 60)

  return (
    <div>
      <PageHeader
        title="Upload your script"
        subtitle="Paste or upload your own script — optionally include a voiceover recording"
      />

      {/* Mode selector */}
      <div className="flex gap-3 mb-6">
        {[
          { id: 'script-only' as UploadMode, label: 'Script only', desc: 'SceneForge generates voice from your script', icon: '◎' },
          { id: 'script-and-voice' as UploadMode, label: 'Script + voiceover', desc: 'Use your own recorded voice', icon: '◉' },
        ].map((m) => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`flex-1 text-left p-4 rounded-xl border transition-all
              ${mode === m.id ? 'bg-violet-500/12 border-violet-500/35' : 'bg-[#111118] border-white/[0.07] hover:border-white/15'}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[16px] ${mode === m.id ? 'text-violet-400' : 'text-white/30'}`}>{m.icon}</span>
              <span className={`text-[13.5px] font-semibold ${mode === m.id ? 'text-violet-300' : 'text-white/70'}`}>{m.label}</span>
            </div>
            <p className="text-[12px] text-white/40 ml-6">{m.desc}</p>
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 mb-4 text-[12.5px] text-red-300">{error}</div>
      )}

      {/* Script input */}
      <Card className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <CardTitle>Your script</CardTitle>
          <button onClick={() => scriptInputRef.current?.click()}
            className="text-[11.5px] text-violet-400 hover:text-violet-300 flex items-center gap-1.5 transition-colors">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v8M4 6l4-4 4 4M2 14h12"/></svg>
            {scriptFileName ? 'Replace file' : 'Upload .txt or .md'}
          </button>
          <input ref={scriptInputRef} type="file" accept=".txt,.md,.doc,.docx" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleScriptFile(e.target.files[0])} />
        </div>

        {/* Drop zone / textarea */}
        <div
          ref={dropRef}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleScriptDrop}
          className={`relative rounded-lg border transition-all ${dragging ? 'border-violet-500 bg-violet-500/10' : 'border-white/10'}`}
        >
          {dragging && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-violet-500/10 z-10">
              <p className="text-violet-300 text-[13px] font-medium">Drop script file here</p>
            </div>
          )}
          <textarea
            value={scriptText}
            onChange={(e) => { setScriptText(e.target.value); setScriptFileName('') }}
            placeholder={`Paste your voiceover script here…\n\nYou can use section labels like:\n[HOOK]\n[INTRO]\n[MAIN]\n[CTA]\n\nOr just paste plain text — SceneForge will structure it into scenes automatically.`}
            className="w-full bg-[#1A1A24] rounded-lg text-[13px] text-white/85 px-4 py-3 outline-none resize-none min-h-[240px] placeholder-white/20 leading-relaxed"
          />
        </div>

        {/* Stats */}
        {wordCount > 0 && (
          <div className="flex gap-6 mt-3 text-[12px] text-white/40">
            <span><span className="text-white/70 font-medium">{wordCount}</span> words</span>
            <span><span className="text-white/70 font-medium">~{estimatedDuration}s</span> estimated</span>
            <span><span className="text-white/70 font-medium">~{Math.ceil(estimatedDuration / 6)}</span> scenes</span>
            {scriptFileName && <span className="text-violet-400">📄 {scriptFileName}</span>}
          </div>
        )}
      </Card>

      {/* Voice upload — only in script-and-voice mode */}
      {mode === 'script-and-voice' && (
        <Card className="mb-6">
          <CardTitle>Your voiceover recording</CardTitle>
          <div
            onClick={() => voiceInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
              ${voiceFile ? 'border-teal-500/40 bg-teal-500/8' : 'border-white/12 hover:border-violet-500/40 hover:bg-violet-500/5'}`}
          >
            <input ref={voiceInputRef} type="file" accept=".mp3,.wav,.m4a,.ogg,.aac" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleVoiceFile(e.target.files[0])} />

            {voiceFile ? (
              <div>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#2DD4BF" strokeWidth="1.5"><path d="M8 2v12M5 4v8M11 4v8M2 7v2M14 7v2"/></svg>
                  <span className="text-[14px] font-medium text-teal-400">{voiceFile.name}</span>
                </div>
                <p className="text-[12px] text-white/40">
                  {(voiceFile.size / 1024 / 1024).toFixed(1)} MB
                  {voiceDuration !== null && ` · ${Math.floor(voiceDuration / 60)}m ${voiceDuration % 60}s`}
                </p>
                <button onClick={(e) => { e.stopPropagation(); setVoiceFile(null); setVoiceDuration(null) }}
                  className="mt-2 text-[11.5px] text-white/35 hover:text-red-400 transition-colors">Remove</button>
              </div>
            ) : (
              <div>
                <svg className="mx-auto mb-3" width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                  <path d="M14 4v16M8 8v8M20 8v8M2 12v4M26 12v4"/>
                </svg>
                <p className="text-[13px] text-white/45 mb-1">Click to upload or drag your audio file</p>
                <p className="text-[11.5px] text-white/25">MP3, WAV, M4A, AAC — your own recorded voiceover</p>
              </div>
            )}
          </div>

          {voiceFile && (
            <div className="mt-3 bg-teal-500/8 border border-teal-500/20 rounded-lg p-3 text-[12px] text-teal-400/80">
              Your voiceover will be used directly in the final video. SceneForge will generate a matching visual for each scene based on your script timing.
            </div>
          )}
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          variant="primary"
          onClick={handleBreakIntoScenes}
          disabled={!scriptText.trim() || breaking}
          loading={breaking}
        >
          Break into scenes →
        </Button>
        <Button variant="ghost" onClick={() => setStep('setup')}>
          ← Back to setup
        </Button>
      </div>

      {breaking && (
        <div className="mt-4">
          <LoadingState label="SceneForge is breaking your script into scenes…" progress={65} />
        </div>
      )}

      {/* Help text */}
      <div className="mt-6 bg-[#111118] border border-white/[0.07] rounded-xl p-4">
        <p className="text-[11.5px] font-semibold text-white/40 uppercase tracking-widest mb-2">How it works</p>
        <div className="space-y-1.5 text-[12.5px] text-white/40 leading-relaxed">
          <p>1. Paste or upload your script in any format — plain text, formatted, or with section labels</p>
          <p>2. SceneForge reads your script and splits it into {mode === 'script-and-voice' ? '6–12 timed scenes' : 'scenes with visual descriptions and keywords'}</p>
          {mode === 'script-and-voice'
            ? <p>3. Your uploaded voiceover is mapped to each scene by timing — no AI voice generation needed</p>
            : <p>3. SceneForge generates a voiceover for each scene using your selected voice from the next step</p>}
          <p>4. You can edit every scene before rendering — text, duration, visuals, order</p>
        </div>
      </div>
    </div>
  )
}
