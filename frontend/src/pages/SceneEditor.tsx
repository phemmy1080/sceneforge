import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { useAuthStore } from '../authStore'
import { usePlanLimits } from '../hooks/usePlanLimits'
import { searchVisuals, uploadVoiceClip, type Scene, type VisualResult, api } from '../lib/api'
import { Button, Badge, PageHeader } from '../components/ui'

const TYPE_COLORS = {
  hook: 'coral',
  intro: 'teal',
  main: 'purple',
  cta: 'amber',
} as const

interface ReviewNote {
  id: string
  author_name: string
  text: string
  scene_index: number | null
  is_client: boolean
  resolved: boolean
  created_at: string
}

export default function SceneEditor() {
  const scenes = useStore((s) => s.scenes)
  const activeSceneIndex = useStore((s) => s.activeSceneIndex)
  const setActiveSceneIndex = useStore((s) => s.setActiveSceneIndex)
  const updateScene = useStore((s) => s.updateScene)
  const moveScene = useStore((s) => s.moveScene)
  const deleteScene = useStore((s) => s.deleteScene)
  const addScene = useStore((s) => s.addScene)
  const duplicateScene = useStore((s: any) => s.duplicateScene)
  const undoScenes = useStore((s: any) => s.undoScenes)
  const redoScenes = useStore((s: any) => s.redoScenes)
  const sceneHistoryIndex = useStore((s: any) => s.sceneHistoryIndex)
  const sceneHistory = useStore((s: any) => s.sceneHistory)
  const { canAddScene, scenesRemaining, maxScenes, isFree } = usePlanLimits()
  const setStep = useStore((s) => s.setStep)
  const markStepComplete = useStore((s) => s.markStepComplete)

  const [visualResults, setVisualResults] = useState<VisualResult[]>([])
  const [visualLoading, setVisualLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null)

  // Review notes from agency project comments
  const [reviewNotes, setReviewNotes] = useState<ReviewNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [showNotes, setShowNotes] = useState(true)

  // Voice upload/record per scene
  const [voiceUploading, setVoiceUploading] = useState<Record<number, boolean>>({})
  const [voiceProcessing, setVoiceProcessing] = useState<Record<number, boolean>>({})
  const [voiceError, setVoiceError] = useState<Record<number, string>>({})
  const [voiceRecording, setVoiceRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [recordingChunks, setRecordingChunks] = useState<Blob[]>([])
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const voiceFileInputRef = useRef<HTMLInputElement>(null)
  const voiceUploadForScene = useRef<number | null>(null)

  // Custom image upload per scene
  const [uploading, setUploading] = useState<Record<number, boolean>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadingForScene = useRef<number | null>(null)

  const agencyProjectId  = useStore((s: any) => s.agencyProjectId)
  const [savingBack, setSavingBack] = useState(false)
  const user = useAuthStore((s: any) => s.user)
  const [selectedVisualId, setSelectedVisualId] = useState<string | null>(null)

  const activeScene = scenes[activeSceneIndex]
  const totalDuration = scenes.reduce((s, sc) => s + sc.duration, 0)

  // Load review notes for this agency project
  useEffect(() => {
    if (!agencyProjectId) return
    setNotesLoading(true)
    api.get(`/api/agency/projects/${agencyProjectId}`)
      .then(r => {
        const notes: ReviewNote[] = (r.data.comments || []).filter(
          (c: ReviewNote) => !c.resolved
        )
        setReviewNotes(notes)
      })
      .catch(() => {})
      .finally(() => setNotesLoading(false))
  }, [agencyProjectId])

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z = redo
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      // Don't fire inside text inputs / textareas
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoScenes() }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redoScenes() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undoScenes, redoScenes])

  // Delete confirmation modal rendered inline
  const DeleteConfirmModal = confirmDeleteIndex !== null ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="bg-[#16161F] border border-white/[0.10] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="text-2xl mb-3 text-center">🗑️</div>
        <h3 className="text-white font-bold text-base text-center mb-1">Delete Scene {confirmDeleteIndex + 1}?</h3>
        <p className="text-white/40 text-sm text-center mb-6 leading-relaxed">
          This scene will be permanently removed from your video.<br/>
          <span className="text-white/25 text-xs">You can undo this with Ctrl+Z.</span>
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setConfirmDeleteIndex(null)}
            className="flex-1 h-9 rounded-xl border border-white/[0.10] text-white/60 hover:text-white hover:border-white/20 text-sm font-semibold transition"
          >
            Cancel
          </button>
          <button
            onClick={() => { deleteScene(confirmDeleteIndex); setConfirmDeleteIndex(null) }}
            className="flex-1 h-9 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 hover:text-red-300 text-sm font-semibold transition"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  ) : null

  async function processVoiceFile(sceneIdx: number, file: File | Blob) {
    setVoiceError(e => ({ ...e, [sceneIdx]: '' }))
    setVoiceUploading(u => ({ ...u, [sceneIdx]: true }))
    setVoiceProcessing(p => ({ ...p, [sceneIdx]: true }))
    try {
      const result = await uploadVoiceClip(file, sceneIdx)
      updateScene(sceneIdx, {
        custom_voice_url: result.voice_url,
        custom_voice_duration: result.duration,
        duration: Math.max(1, Math.ceil(result.duration)),
      } as any)
    } catch (e: any) {
      const raw = e?.response?.data?.detail || e?.message || ''
      let msg = 'Voice processing failed — please try again'
      if (!raw || raw.toLowerCase().includes('network')) {
        msg = 'Could not reach the server. Check your connection and try again.'
      } else if (raw.toLowerCase().includes('too large') || e?.response?.status === 413) {
        msg = 'File too large — maximum 50 MB.'
      } else if (raw.toLowerCase().includes('invalid file') || e?.response?.status === 400) {
        msg = 'Invalid file type. Please upload an audio file (MP3, WAV, WebM, M4A).'
      } else if (raw.toLowerCase().includes('processing failed')) {
        msg = 'Audio processing failed. Try a different file format or re-record.'
      } else if (raw) {
        msg = raw
      }
      setVoiceError(err => ({ ...err, [sceneIdx]: msg }))
    } finally {
      setVoiceUploading(u => ({ ...u, [sceneIdx]: false }))
      setVoiceProcessing(p => ({ ...p, [sceneIdx]: false }))
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const chunks: Blob[] = []
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        setRecordingChunks(chunks)
      }
      mr.start(100)
      setMediaRecorder(mr)
      setVoiceRecording(true)
      setRecordingSeconds(0)
      setRecordingChunks([])
      recordingTimer.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000)
    } catch {
      setVoiceError(e => ({ ...e, [activeSceneIndex]: 'Microphone access denied' }))
    }
  }

  function stopRecordingAndProcess() {
    if (mediaRecorder) mediaRecorder.stop()
    if (recordingTimer.current) clearInterval(recordingTimer.current)
    setVoiceRecording(false)
  }

  // When recording stops and chunks arrive, process them
  useEffect(() => {
    if (!voiceRecording && recordingChunks.length > 0) {
      const blob = new Blob(recordingChunks, { type: 'audio/webm;codecs=opus' })
      setRecordingChunks([])
      processVoiceFile(activeSceneIndex, blob)
    }
  }, [voiceRecording, recordingChunks])


  // Preview a single scene using the partial re-render endpoint
  async function previewScene() {
    if (!activeScene || !agencyProjectId) return
    setPreviewing(true)
    setPreviewUrl(null)
    try {
      const projRes = await api.get(`/api/agency/projects/${agencyProjectId}`)
      const jobIds: string[] = projRes.data.project?.render_job_ids || []
      if (jobIds.length === 0) {
        alert('No previous render found. Complete a full render first before previewing individual scenes.')
        return
      }
      const lastJobId = jobIds[jobIds.length - 1]
      // Flush current scenes to Redis first
      await api.put(`/api/render/scenes/${lastJobId}`, { scenes: useStore.getState().scenes })
      // Trigger partial re-render for just this scene
      const res = await api.post(`/api/render/scenes/${lastJobId}/${activeSceneIndex}`, {
        scene: activeScene,
        visual_source: 'pexels_video',
        subtitle_style: 'viral',
        platform: useStore.getState().config?.platform || 'TikTok',
        motion: 'auto',
      })
      setPreviewUrl(res.data.scene_url || res.data.video_url || null)
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Preview failed. Try again.')
    } finally {
      setPreviewing(false)
    }
  }

  // Upload custom image for a scene
  async function uploadCustomImage(sceneIndex: number, file: File) {
    const allowed = ['image/png','image/jpeg','image/jpg','image/webp']
    if (!allowed.includes(file.type)) { alert('Use PNG, JPG or WebP'); return }
    if (file.size > 10 * 1024 * 1024) { alert('Image must be under 10 MB'); return }
    setUploading(u => ({ ...u, [sceneIndex]: true }))
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await api.post('/api/agency/scene-image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      updateScene(sceneIndex, { custom_image_url: res.data.image_url } as any)
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(u => ({ ...u, [sceneIndex]: false }))
    }
  }

  async function handleSearchVisuals() {
    if (!activeScene) return
    setVisualLoading(true)
    setVisualResults([])
    try {
      const results = await searchVisuals(activeScene.visual_keyword, activeScene.id)
      setVisualResults(results)
    } catch {
      // silently fail — show empty state
    } finally {
      setVisualLoading(false)
    }
  }

  function handleContinue() {
    markStepComplete('scenes')
    setStep('voice')
  }

  async function saveAndReturnToProject() {
    if (!agencyProjectId) return
    setSavingBack(true)
    const editedSceneIndex = useStore.getState().activeSceneIndex ?? -1
    try {
      const projRes = await api.get(`/api/agency/projects/${agencyProjectId}`)
      const jobIds: string[] = projRes.data.project?.render_job_ids || []
      if (jobIds.length > 0) {
        const lastJobId = jobIds[jobIds.length - 1]
        const currentScenes = useStore.getState().scenes
        await api.put(`/api/render/scenes/${lastJobId}`, { scenes: currentScenes })
        // Flag this scene as pending re-render so project page can show badge
        try {
          const stored = JSON.parse(sessionStorage.getItem('sf_pending_edits') || '{}')
          stored[agencyProjectId] = stored[agencyProjectId] || []
          if (editedSceneIndex >= 0 && !stored[agencyProjectId].includes(editedSceneIndex)) {
            stored[agencyProjectId].push(editedSceneIndex)
          }
          sessionStorage.setItem('sf_pending_edits', JSON.stringify(stored))
        } catch {}
      }
    } catch (e) {
      console.warn('Scene save failed (non-fatal):', e)
    } finally {
      setSavingBack(false)
    }
    useStore.getState().setStep('agency-detail' as any)
  }

  if (scenes.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-white/40 text-sm">No scenes yet — complete the Script step first.</p>
      </div>
    )
  }

  return (
    <div>
      {DeleteConfirmModal}
      <PageHeader
        title="Scene editor"
        subtitle="Edit each scene before rendering — your video storyboard"
      />

      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <Badge color="purple">{scenes.length} scenes</Badge>
          <Badge color="teal">{totalDuration}s total</Badge>
        </div>
        <div className="flex gap-2">
          {/* Undo / Redo */}
          <div className="flex items-center gap-1 mr-2">
            <button
              onClick={undoScenes}
              disabled={sceneHistoryIndex <= 0}
              title="Undo (Ctrl+Z)"
              className="flex items-center gap-1 px-2 h-7 rounded-lg text-[11px] font-semibold border transition
                disabled:opacity-30 disabled:cursor-not-allowed
                border-white/[0.10] text-white/60 hover:text-white hover:bg-white/[0.07] hover:border-white/20
                disabled:border-white/[0.06] disabled:text-white/25"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6C2 3.8 3.8 2 6 2c1.5 0 2.8.8 3.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M2 2v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Undo
            </button>
            <button
              onClick={redoScenes}
              disabled={sceneHistoryIndex >= (sceneHistory?.length ?? 0) - 1}
              title="Redo (Ctrl+Shift+Z)"
              className="flex items-center gap-1 px-2 h-7 rounded-lg text-[11px] font-semibold border transition
                disabled:opacity-30 disabled:cursor-not-allowed
                border-white/[0.10] text-white/60 hover:text-white hover:bg-white/[0.07] hover:border-white/20
                disabled:border-white/[0.06] disabled:text-white/25"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10 6C10 3.8 8.2 2 6 2c-1.5 0-2.8.8-3.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10 2v4H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Redo
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isFree && maxScenes !== -1 && (
              <span style={{
                fontSize: 11, color: scenes.length >= maxScenes ? '#f87171' : 'rgba(255,255,255,0.35)',
                fontWeight: 600,
              }}>
                {scenes.length}/{maxScenes} scenes
                {scenes.length >= maxScenes && ' — upgrade for more'}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!canAddScene(scenes.length)) {
                  document.dispatchEvent(new CustomEvent('show-upgrade-prompt', {
                    detail: { reason: 'scene_limit', max: maxScenes }
                  }))
                  return
                }
                addScene()
              }}
              style={{ opacity: canAddScene(scenes.length) ? 1 : 0.5 }}
            >
              {canAddScene(scenes.length) ? '+ Add scene' : '🔒 Upgrade to add more'}
            </Button>
          </div>
          {agencyProjectId ? (
            <div className="flex items-center gap-2">
              <button
                onClick={saveAndReturnToProject}
                disabled={savingBack}
                className="text-sm font-semibold px-4 py-2 rounded-xl bg-amber-400/15 border border-amber-400/25 text-amber-300 hover:bg-amber-400/20 transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {savingBack
                  ? <><div className="w-3 h-3 border border-amber-400/50 border-t-transparent rounded-full animate-spin" />Saving…</>
                  : <>✓ Save & return to project</>
                }
              </button>
              <Button variant="primary" size="sm" onClick={handleContinue}>
                Next: Voice & visuals →
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="sm" onClick={handleContinue}>
              Next: Voice & visuals →
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-5">
        {/* Scene list */}
        <div className="w-56 shrink-0">
          <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-1">
            {scenes.map((scene, i) => (
              <div
                key={scene.id}
                onClick={() => {
                  setActiveSceneIndex(i)
                  setVisualResults([])
                  setSelectedVisualId(null)
                }}
                className={`
                  relative group p-3 rounded-xl border cursor-pointer transition-all duration-150
                  ${i === activeSceneIndex
                    ? 'bg-violet-500/12 border-violet-500/35'
                    : 'bg-[#111118] border-white/[0.07] hover:border-white/15'}
                `}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[9px] font-bold text-white/30 font-display tracking-wider">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <Badge color={TYPE_COLORS[scene.type]}>{scene.type}</Badge>
                </div>
                <p className="text-[12px] text-white/70 leading-snug line-clamp-2 mb-1.5">
                  {scene.text}
                </p>
                <p className="text-[11px] text-teal-400">{scene.duration}s</p>

                {/* Hover actions */}
                <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); moveScene(i, i - 1) }}
                    className="w-5 h-5 bg-[#22222F] rounded text-white/40 hover:text-white/80 text-[10px] flex items-center justify-center"
                    title="Move up"
                  >↑</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveScene(i, i + 1) }}
                    className="w-5 h-5 bg-[#22222F] rounded text-white/40 hover:text-white/80 text-[10px] flex items-center justify-center"
                    title="Move down"
                  >↓</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); duplicateScene(i) }}
                    className="w-5 h-5 bg-[#22222F] rounded text-white/40 hover:text-teal-400 text-[10px] flex items-center justify-center"
                    title="Duplicate"
                  >⧉</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteIndex(i) }}
                    className="w-5 h-5 bg-[#22222F] rounded text-red-400/60 hover:text-red-400 text-[10px] flex items-center justify-center"
                    title="Delete scene"
                  >×</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Edit panel */}
        {activeScene && (
          <div className="flex-1 bg-[#111118] border border-white/[0.07] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-[15px] text-white">
                Scene {activeSceneIndex + 1}
              </h3>
              <div className="flex items-center gap-2">
                {agencyProjectId && (
                  <button
                    onClick={previewScene}
                    disabled={previewing}
                    title="Preview this scene — renders a quick clip without saving"
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-violet-400/15 border border-violet-400/25 text-violet-300 hover:bg-violet-400/20 transition disabled:opacity-50 flex items-center gap-1"
                  >
                    {previewing
                      ? <><div className="w-2.5 h-2.5 border border-violet-400/50 border-t-transparent rounded-full animate-spin" />Previewing…</>
                      : <>▶ Preview scene</>}
                  </button>
                )}
                <Badge color={TYPE_COLORS[activeScene.type]}>{activeScene.type}</Badge>
              </div>
            </div>

            {/* Preview result */}
            {previewUrl && (
              <div className="mb-4 bg-violet-400/[0.06] border border-violet-400/20 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-violet-400/10">
                  <span className="text-xs font-bold text-violet-300">▶ Scene preview</span>
                  <button onClick={() => setPreviewUrl(null)} className="text-white/25 hover:text-white/60 transition text-sm">×</button>
                </div>
                <div className="p-3">
                  <video
                    key={previewUrl}
                    src={previewUrl}
                    controls
                    autoPlay
                    className="w-full rounded-lg bg-black"
                    style={{ maxHeight: 200, objectFit: 'contain' }}
                  />
                  <p className="text-[10px] text-white/25 mt-2 text-center">
                    Preview only — click Save &amp; return to project to keep changes
                  </p>
                </div>
              </div>
            )}

            {/* Voiceover */}
            <div className="mb-4">
              <label className="block text-[12px] font-medium text-white/50 mb-1.5">
                Voiceover text
              </label>
              <textarea
                value={activeScene.text}
                onChange={(e) => updateScene(activeSceneIndex, { text: e.target.value })}
                rows={3}
                className="w-full bg-[#1A1A24] border border-white/12 rounded-lg text-[13.5px] text-white/90 px-3 py-2.5 outline-none focus:border-violet-500/60 resize-none"
              />
            </div>

            {/* Duration + Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-[12px] font-medium text-white/50 mb-1.5">
                  Duration (seconds)
                </label>
                <input
                  type="number"
                  min={1}
                  value={activeScene.duration}
                  onChange={(e) => updateScene(activeSceneIndex, { duration: Math.max(1, parseInt(e.target.value) || 5) })}
                  className="w-full bg-[#1A1A24] border border-white/12 rounded-lg text-[13.5px] text-white/90 px-3 py-2.5 outline-none focus:border-violet-500/60"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-white/50 mb-1.5">
                  Scene type
                </label>
                <select
                  value={activeScene.type}
                  onChange={(e) => updateScene(activeSceneIndex, { type: e.target.value as Scene['type'] })}
                  className="w-full bg-[#1A1A24] border border-white/12 rounded-lg text-[13.5px] text-white/90 px-3 py-2.5 outline-none focus:border-violet-500/60 cursor-pointer"
                >
                  {['hook', 'intro', 'main', 'cta'].map((t) => (
                    <option key={t} value={t} className="bg-[#1A1A24]">{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Review notes for this scene ── */}
            {agencyProjectId && reviewNotes.filter(n =>
              n.scene_index === activeSceneIndex || n.scene_index === null
            ).length > 0 && (
              <div className="mb-4 bg-amber-400/[0.07] border border-amber-400/20 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-amber-400/10">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-xs font-bold text-amber-300">Review notes</span>
                  </div>
                  <button onClick={() => setShowNotes(n => !n)}
                    className="text-[10px] text-amber-400/50 hover:text-amber-300 transition">
                    {showNotes ? 'Hide' : 'Show'}
                  </button>
                </div>
                {showNotes && (
                  <div className="divide-y divide-amber-400/10 max-h-48 overflow-y-auto">
                    {reviewNotes
                      .filter(n => n.scene_index === activeSceneIndex || n.scene_index === null)
                      .map(note => (
                      <div key={note.id} className="flex gap-2.5 px-3 py-2.5">
                        <div className={`w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          note.is_client ? 'bg-violet-400/20 text-violet-300' : 'bg-white/[0.08] text-white/50'
                        }`}>
                          {note.author_name.slice(0,2).toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-white/70">{note.author_name}</span>
                            {note.is_client && <span className="text-[9px] text-violet-400 font-semibold">Client</span>}
                            {note.scene_index === null && <span className="text-[9px] text-white/25">General</span>}
                          </div>
                          <p className="text-xs text-white/55 leading-relaxed mt-0.5">{note.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Visual description */}
            <div className="mb-4">
              <label className="block text-[12px] font-medium text-white/50 mb-1.5">
                Visual description
              </label>
              <textarea
                value={activeScene.visual}
                onChange={(e) => updateScene(activeSceneIndex, { visual: e.target.value })}
                rows={2}
                className="w-full bg-[#1A1A24] border border-white/12 rounded-lg text-[13.5px] text-white/90 px-3 py-2.5 outline-none focus:border-violet-500/60 resize-none"
              />
            </div>

            {/* Visual keyword + search */}
            <div className="mb-4">
              <label className="block text-[12px] font-medium text-white/50 mb-1.5">
                Stock footage keyword
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={activeScene.visual_keyword}
                  onChange={(e) => updateScene(activeSceneIndex, { visual_keyword: e.target.value })}
                  className="flex-1 bg-[#1A1A24] border border-white/12 rounded-lg text-[13.5px] text-white/90 px-3 py-2.5 outline-none focus:border-violet-500/60"
                />
                <Button
                  variant="teal"
                  size="sm"
                  onClick={handleSearchVisuals}
                  loading={visualLoading}
                >
                  Search
                </Button>
              </div>
            </div>

            {/* Visual results */}
            {visualResults.length > 0 && (
              <div>
                <p className="text-[11px] text-white/40 mb-2">
                  Pexels results for "{activeScene.visual_keyword}" — click to select
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {visualResults.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        setSelectedVisualId(v.id)
                        updateScene(activeSceneIndex, { visual_keyword: activeScene.visual_keyword })
                      }}
                      className={`
                        aspect-[9/16] rounded-lg overflow-hidden border-2 transition-all
                        ${selectedVisualId === v.id ? 'border-violet-500' : 'border-transparent hover:border-white/25'}
                      `}
                    >
                      <img
                        src={v.thumbnail_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {visualLoading && (
              <div className="text-center py-4">
                <p className="text-[12px] text-white/40 animate-pulse">Searching Pexels…</p>
              </div>
            )}

            {/* ── Custom image upload ── */}
            <div className="mb-4 mt-2">
              <label className="block text-[12px] font-medium text-white/50 mb-1.5">
                Upload your own image
                <span className="ml-2 text-[10px] text-white/25 font-normal">overrides stock footage for this scene</span>
              </label>

              {/* Show current custom image */}
              {(activeScene as any).custom_image_url && (
                <div className="relative mb-2 group">
                  {/* Fixed-height container with dark bg — image contained inside, never stretched */}
                  <div className="w-full rounded-lg border border-white/10 bg-black overflow-hidden"
                    style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img
                      src={(activeScene as any).custom_image_url}
                      alt="Custom scene image"
                      style={{
                        maxWidth: '100%',
                        maxHeight: '200px',
                        width: 'auto',
                        height: 'auto',
                        objectFit: 'contain',
                        display: 'block',
                      }}
                    />
                  </div>
                  <button
                    onClick={() => updateScene(activeSceneIndex, { custom_image_url: null } as any)}
                    className="absolute top-2 right-2 w-6 h-6 bg-black/70 text-white/70 hover:text-rose-400 rounded-full text-sm leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    ×
                  </button>
                  <div className="absolute bottom-2 left-2 text-[10px] bg-black/60 text-amber-300 px-2 py-0.5 rounded-full font-semibold">
                    Custom image ✓
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  uploadingForScene.current = activeSceneIndex
                  fileInputRef.current?.click()
                }}
                disabled={uploading[activeSceneIndex]}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-white/15 hover:border-white/30 rounded-lg text-[12px] text-white/40 hover:text-white/70 transition disabled:opacity-40">
                {uploading[activeSceneIndex] ? (
                  <><div className="w-3.5 h-3.5 border border-white/40 border-t-transparent rounded-full animate-spin" /> Uploading…</>
                ) : (
                  <><span>📷</span> Choose PNG, JPG or WebP — max 10 MB</>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  const si = uploadingForScene.current
                  if (f && si !== null) uploadCustomImage(si, f)
                  e.target.value = ''
                }}
              />
            </div>

            {/* ── Voice upload / record ── */}
            <div className="mb-4 mt-4 border-t border-white/[0.06] pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[12px] font-semibold text-white/60">
                  Custom voice
                  <span className="ml-2 text-[10px] text-white/25 font-normal">upload or record for this scene</span>
                </label>
                {(activeScene as any).custom_voice_url && (
                  <button
                    onClick={() => updateScene(activeSceneIndex, { custom_voice_url: null, custom_voice_duration: null } as any)}
                    className="text-[10px] text-rose-400/60 hover:text-rose-400 transition">
                    Remove
                  </button>
                )}
              </div>

              {/* Current voice clip player */}
              {(activeScene as any).custom_voice_url && !voiceUploading[activeSceneIndex] && (
                <div className="mb-3 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-teal-400/15 border border-teal-400/20 flex items-center justify-center flex-shrink-0">
                    <svg width="10" height="12" viewBox="0 0 10 12" fill="none"><path d="M1 1l8 5-8 5V1z" fill="#2dd4bf"/></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <audio src={(activeScene as any).custom_voice_url} controls
                      className="w-full h-7" style={{ colorScheme: 'dark' }} />
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-[10px] text-teal-300 font-semibold">Custom voice ✓</div>
                    {(activeScene as any).custom_voice_duration && (
                      <div className="text-[10px] text-white/30">{((activeScene as any).custom_voice_duration as number).toFixed(1)}s — duration updated</div>
                    )}
                  </div>
                </div>
              )}

              {/* Processing steps badge */}
              {voiceProcessing[activeSceneIndex] && (
                <div className="mb-3 bg-teal-400/[0.06] border border-teal-400/15 rounded-xl px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] text-teal-300">
                    <div className="w-3 h-3 border border-teal-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    Processing your voice clip…
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {["Trimming silence","Reducing noise","EQ balancing","Compression","Loudness norm","Fade in/out"].map(step => (
                      <span key={step} className="text-[10px] bg-teal-400/10 text-teal-400/70 border border-teal-400/15 px-1.5 py-0.5 rounded-full">
                        {step}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Error */}
              {voiceError[activeSceneIndex] && (
                <div className="mb-2 text-[11px] text-rose-400 bg-rose-400/[0.08] border border-rose-400/20 rounded-lg px-3 py-2">
                  {voiceError[activeSceneIndex]}
                </div>
              )}

              {/* Recording UI */}
              {voiceRecording ? (
                <div className="flex items-center gap-3 mb-2 bg-red-400/[0.08] border border-red-400/20 rounded-xl px-4 py-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse flex-shrink-0" />
                  <span className="text-[12px] text-red-300 font-semibold flex-1">
                    Recording… {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}
                  </span>
                  <button onClick={stopRecordingAndProcess}
                    className="text-[11px] font-bold bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 px-3 py-1.5 rounded-lg transition">
                    Stop & process
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  {/* Upload button */}
                  <button
                    onClick={() => {
                      voiceUploadForScene.current = activeSceneIndex
                      voiceFileInputRef.current?.click()
                    }}
                    disabled={voiceUploading[activeSceneIndex] || voiceProcessing[activeSceneIndex]}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-dashed border-white/15 hover:border-white/30 rounded-lg text-[11.5px] text-white/40 hover:text-white/70 transition disabled:opacity-40">
                    {voiceUploading[activeSceneIndex] ? (
                      <><div className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin" />Uploading…</>
                    ) : (
                      <><span>🎤</span> Upload voice clip</>
                    )}
                  </button>
                  {/* Record button */}
                  <button
                    onClick={startRecording}
                    disabled={voiceUploading[activeSceneIndex] || voiceProcessing[activeSceneIndex]}
                    className="flex items-center gap-1.5 px-3 py-2.5 border border-dashed border-red-400/20 hover:border-red-400/40 rounded-lg text-[11.5px] text-red-400/50 hover:text-red-400 transition disabled:opacity-40">
                    <div className="w-2 h-2 rounded-full bg-red-400/60" />
                    Record
                  </button>
                </div>
              )}

              <input
                ref={voiceFileInputRef}
                type="file"
                accept="audio/*,.webm,.ogg,.wav,.mp3,.mp4,.m4a,.aac"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  const si = voiceUploadForScene.current
                  if (f && si !== null) processVoiceFile(si!, f)
                  e.target.value = ''
                }}
              />
              <p className="text-[10px] text-white/20 mt-1.5 leading-relaxed">
                MP3, WAV, WebM, M4A — max 50 MB. Processing applies noise reduction, EQ, loudness normalisation and auto-adjusts scene duration.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
