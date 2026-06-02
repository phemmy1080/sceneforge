import { useStore } from '../store'
import SharePanel from '../components/SharePanel'
import { useJobPoller } from '../hooks/useJobPoller'
import { exportUrl, voiceUrl } from '../lib/api'
import { Badge, ProgressBar, PageHeader } from '../components/ui'

export default function Export() {
  const jobId             = useStore((s) => s.jobId)
  const renderProgress    = useStore((s) => s.renderProgress)
  const renderStage       = useStore((s) => s.renderStage)
  const renderStatus      = useStore((s) => s.renderStatus)
  const videoUrl          = useStore((s) => s.videoUrl)
  const scenes            = useStore((s) => s.scenes)
  const selectedIdea      = useStore((s) => s.selectedIdea)
  const activeProjectId   = useStore((s) => s.activeProjectId)
  const projects          = useStore((s) => s.projects)
  const config            = useStore((s) => s.config)
  const script            = useStore((s) => s.script)
  const agencyProjectMeta  = useStore((s: any) => s.agencyProjectMeta)
  const agencyProjectId   = useStore((s: any) => s.agencyProjectId)

  useJobPoller(jobId)

  const isProcessing = renderStatus === 'queued' || renderStatus === 'processing'
  const isDone       = renderStatus === 'complete'
  const isFailed     = renderStatus === 'failed'

  const totalDuration = scenes.reduce((s, sc) => s + sc.duration, 0)
  const activeProject = projects.find((p) => p.id === activeProjectId)
  // Agency export: use meta from the agency project (title + client name)
  const agencyTitle   = agencyProjectMeta
    ? `${agencyProjectMeta.title}${agencyProjectMeta.client_name ? ' — ' + agencyProjectMeta.client_name : ''}`
    : null
  const projectTitle  = agencyTitle ?? selectedIdea?.title ?? activeProject?.name

  // For caption generator: prefer agency project platform/niche if config is empty
  const effectiveConfig = {
    ...config,
    niche:    config?.niche    || agencyProjectMeta?.client_name || '',
    platform: config?.platform || '',
  }

  if (!jobId) {
    return (
      <div>
        <PageHeader title="Export" subtitle="Download your finished video" />
        <div className="py-16 text-center">
          <div className="text-4xl mb-4">🎬</div>
          <p className="text-white/50 text-sm mb-2">No render started yet.</p>
          <p className="text-white/30 text-xs">Complete the Voice &amp; Visuals step to render your video.</p>
          <p className="text-white/20 text-xs mt-4">If you previously rendered a video, open your project from the sidebar to restore it.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Export" subtitle="Download your finished video" />

      {/* ── Progress ── */}
      {isProcessing && (
        <div className="bg-[#111118] border border-white/[0.07] rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[13px] font-medium text-white/80 animate-pulse">{renderStage || 'Processing…'}</p>
            <span className="text-[13px] font-bold text-violet-400">{renderProgress}%</span>
          </div>
          <ProgressBar value={renderProgress} />
          <div className="mt-4 flex flex-wrap gap-4">
            {[
              { label: 'Voice synthesis', done: renderProgress >= 35 },
              { label: 'Visuals',         done: renderProgress >= 55 },
              { label: 'FFmpeg render',   done: renderProgress >= 90 },
              { label: 'Export files',    done: renderProgress >= 100 },
            ].map(({ label, done }) => (
              <div key={label} className="flex items-center gap-1.5 text-[12px]">
                <div className={`w-1.5 h-1.5 rounded-full ${done ? 'bg-teal-400' : 'bg-white/20'}`} />
                <span className={done ? 'text-teal-400' : 'text-white/40'}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Failed ── */}
      {isFailed && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 text-red-400 text-sm mt-0.5">✕</div>
            <div className="flex-1">
              <p className="text-red-400 font-semibold text-[14px] mb-1">Video render failed</p>
              <p className="text-white/60 text-[13px] leading-relaxed mb-3">
                {renderStage && !renderStage.toLowerCase().includes('name') && !renderStage.includes('traceback')
                  ? renderStage
                  : 'Something went wrong while processing your video.'}
              </p>
              <div className="bg-white/5 border border-white/8 rounded-lg p-3 mb-3">
                <p className="text-[11px] text-white/40 font-semibold uppercase tracking-wide mb-2">What to try</p>
                <ul className="text-[12.5px] text-white/60 space-y-1.5 list-none">
                  <li className="flex items-start gap-2"><span className="text-violet-400 mt-0.5">→</span>Go back to Voice &amp; Visuals and try a different visual source</li>
                  <li className="flex items-start gap-2"><span className="text-violet-400 mt-0.5">→</span>Try fewer scenes or a shorter duration</li>
                  <li className="flex items-start gap-2"><span className="text-violet-400 mt-0.5">→</span>Switch to Stock video (Pexels) if using AI images</li>
                  <li className="flex items-start gap-2"><span className="text-violet-400 mt-0.5">→</span>Remove background music and try again</li>
                </ul>
              </div>
              <button
                onClick={() => useStore.getState().setStep('voice')}
                className="text-[12.5px] font-semibold text-violet-400 hover:text-violet-300 flex items-center gap-1.5 transition-colors"
              >
                ← Back to Voice &amp; Visuals
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Success ── */}
      {isDone && (
        <>
          {/* Banner */}
          <div className="bg-teal-500/10 border border-teal-500/25 rounded-xl p-4 mb-6 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-teal-500/20 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#2DD4BF" strokeWidth="2">
                <circle cx="8" cy="8" r="6"/><path d="M5 8l2 2 4-4"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-teal-400 font-semibold text-[14px] truncate">
                {projectTitle ?? 'Video'} — ready
              </p>
              <div className="flex gap-3 mt-1">
                {scenes.length > 0 && (
                  <span className="text-[12px] text-white/45"><span className="text-white/70 font-medium">{scenes.length}</span> scenes</span>
                )}
                {totalDuration > 0 && (
                  <span className="text-[12px] text-white/45"><span className="text-white/70 font-medium">{totalDuration}s</span> duration</span>
                )}
                {effectiveConfig?.platform && (
                  <span className="text-[12px] text-white/45">📱 <span className="text-white/70 font-medium">{effectiveConfig.platform}</span></span>
                )}
                {agencyProjectMeta?.client_name && (
                  <span className="text-[12px] text-white/45">🏷 <span className="text-amber-300/80 font-medium">{agencyProjectMeta.client_name}</span></span>
                )}
                {!agencyProjectMeta && activeProject?.folder && (
                  <span className="text-[12px] text-white/45">saved to <span className="text-violet-400">/{activeProject.folder}</span></span>
                )}
              </div>
            </div>
            <span className="text-[10px] font-bold bg-teal-500/15 text-teal-400 px-2.5 py-1 rounded-full uppercase tracking-widest flex-shrink-0">
              Exported
            </span>
          </div>



          {/* ── Feature discovery ── */}
          <div className="grid grid-cols-1 gap-3 mb-6 sm:grid-cols-3">
            {/* Single-scene re-render */}
            <div className="bg-[#111118] border border-white/[0.07] rounded-xl p-4">
              <div className="text-2xl mb-2">🔁</div>
              <p className="text-[13px] font-semibold text-white/85 mb-1">Single-scene re-render</p>
              <p className="text-[12px] text-white/40 leading-relaxed mb-3">
                One scene looks off? Go back to the Scene Editor, click that scene, and hit Re-render.
                Only that scene is rebuilt — the rest of the video stays untouched and no tokens are charged.
              </p>
              <button
                onClick={() => {
                    const store = useStore.getState()
                    // Mark this as a re-render of the existing video so no tokens
                    // are deducted when the user goes to Voice & Visuals to render
                    if (store.jobId) store.setPrevJobId(store.jobId)
                    store.setStep('scenes')
                  }}
                className="text-[11px] font-semibold text-violet-400 hover:text-violet-300 transition-colors"
              >
                → Open Scene Editor
              </button>
            </div>

            {/* CapCut export */}
            <div className="bg-[#111118] border border-white/[0.07] rounded-xl p-4">
              <div className="text-2xl mb-2">✂️</div>
              <p className="text-[13px] font-semibold text-white/85 mb-1">Open in CapCut</p>
              <p className="text-[12px] text-white/40 leading-relaxed mb-3">
                Download the CapCut draft below. Open CapCut on your phone, tap Import, and your
                scenes, audio and timings load ready to add effects, text and music.
              </p>
              <p className="text-[11px] font-semibold text-teal-400">↓ Download CapCut draft below</p>
            </div>

            {/* Share panel */}
            <div className="bg-[#111118] border border-white/[0.07] rounded-xl p-4">
              <div className="text-2xl mb-2">📤</div>
              <p className="text-[13px] font-semibold text-white/85 mb-1">Share &amp; post</p>
              <p className="text-[12px] text-white/40 leading-relaxed mb-3">
                Scroll down to the Share panel for captions, hashtags and the best posting times
                — already written for your niche and platform.
              </p>
              <p className="text-[11px] font-semibold text-amber-400">↓ See share panel below</p>
            </div>
          </div>

          {/* Video preview */}
          {videoUrl && (
            <div className="mb-6">
              <p className="text-[11px] text-white/35 uppercase tracking-widest font-semibold mb-3">Preview</p>
              <video
                src={videoUrl}
                controls
                className="max-w-[260px] mx-auto rounded-xl border border-white/10 block"
                style={{ maxHeight: 460 }}
              />
            </div>
          )}

          {/* Video downloads */}
          <p className="text-[11px] text-white/35 uppercase tracking-widest font-semibold mb-3">Downloads</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {[
              { type: 'full'   as const, icon: '🎬', title: 'Full video',      desc: 'Single MP4 — voice, visuals, subtitles', badge: 'MP4 · H.264',       color: 'teal'   as const },
              { type: 'scenes' as const, icon: '🗂',  title: 'Scene bundle',    desc: 'Per-scene MP4 clips + JSON',              badge: 'ZIP · scenes + JSON', color: 'purple' as const },
              { type: 'capcut' as const, icon: '✂️',  title: 'CapCut package',  desc: 'Scene files + draft_content.json',        badge: 'CapCut ready',       color: 'amber'  as const },
            ].map(({ type, icon, title, desc, badge, color }) => (
              <a
                key={type}
                href={exportUrl(jobId, type, projectTitle)}
                download
                onClick={() => {
                  // Mark agency project as exported when any file is downloaded
                  if (agencyProjectId) {
                    import('../lib/api').then(({ api }) => {
                      api.put(`/api/agency/projects/${agencyProjectId}`, {
                        status: 'exported',
                      }).catch(() => {})
                    })
                  }
                }}
                className="block bg-[#111118] border border-white/[0.07] rounded-xl p-5 text-center hover:border-white/15 hover:-translate-y-0.5 transition-all duration-150 cursor-pointer"
              >
                <div className="text-2xl mb-3">{icon}</div>
                <p className="font-semibold text-[13.5px] text-white mb-1">{title}</p>
                <p className="text-[12px] text-white/40 mb-3">{desc}</p>
                <Badge color={color}>{badge}</Badge>
              </a>
            ))}
          </div>

          {/* ── Voice extraction ── */}
          <p className="text-[11px] text-white/35 uppercase tracking-widest font-semibold mb-3">Extract voice</p>
          <div className="flex flex-col sm:flex-row gap-3 mb-2">
            {(['mp3', 'wav'] as const).map((fmt) => (
              <a
                key={fmt}
                href={voiceUrl(jobId, fmt, projectTitle)}
                download
                className="flex items-center gap-3 flex-1 bg-[#111118] border border-white/[0.07] rounded-xl px-4 py-3.5 hover:border-white/15 hover:-translate-y-0.5 transition-all duration-150 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-lg bg-violet-500/15 flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#A78BFA" strokeWidth="1.5">
                    <path d="M8 2v8M5 4v6M11 4v6M2 7v2M14 7v2"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-white">Voiceover · {fmt.toUpperCase()}</p>
                  <p className="text-[11.5px] text-white/40">
                    {fmt === 'mp3' ? 'Compressed · smaller file' : 'Uncompressed · studio quality'}
                  </p>
                </div>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                  <path d="M8 2v8M4 7l4 4 4-4M2 14h12"/>
                </svg>
              </a>
            ))}
          </div>
          <p className="text-[11px] text-white/25 mb-8">
            Audio extracted from your rendered video — ready for podcasts, voiceover reuse, or archiving
          </p>

          {/* Share panel */}
          {videoUrl && (
            <SharePanel
              videoUrl={videoUrl}
              niche={effectiveConfig?.niche}
              platform={effectiveConfig?.platform}
              projectTitle={projectTitle}
              script={script}
            />
          )}

          {/* New project */}
          <div className="pt-5 border-t border-white/[0.07] flex items-center justify-between">
            <p className="text-[13px] text-white/40">Ready for your next video?</p>
            <button
              onClick={() => document.dispatchEvent(new CustomEvent('open-new-project-modal'))}
              className="flex items-center gap-2 px-4 py-2 bg-violet-500/15 border border-violet-500/30 rounded-lg text-violet-300 text-[13px] font-medium hover:bg-violet-500/25 transition-all"
            >
              + New project
            </button>
          </div>
        </>
      )}
    </div>
  )
}
