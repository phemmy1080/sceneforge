import { useStore } from '../store'
import { useJobPoller } from '../hooks/useJobPoller'
import { exportUrl, voiceUrl } from '../lib/api'
import { Badge, ProgressBar, PageHeader } from '../components/ui'

export default function Export() {
  const jobId          = useStore((s) => s.jobId)
  const renderProgress = useStore((s) => s.renderProgress)
  const renderStage    = useStore((s) => s.renderStage)
  const renderStatus   = useStore((s) => s.renderStatus)
  const videoUrl       = useStore((s) => s.videoUrl)
  const scenes         = useStore((s) => s.scenes)
  const selectedIdea   = useStore((s) => s.selectedIdea)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const projects       = useStore((s) => s.projects)

  useJobPoller(jobId)

  const isProcessing = renderStatus === 'queued' || renderStatus === 'processing'
  const isDone       = renderStatus === 'complete'
  const isFailed     = renderStatus === 'failed'

  const totalDuration = scenes.reduce((s, sc) => s + sc.duration, 0)
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const projectTitle  = selectedIdea?.title ?? activeProject?.name

  if (!jobId) {
    return (
      <div>
        <PageHeader title="Export" subtitle="Complete the Voice & Visuals step to render your video" />
        <div className="py-20 text-center text-white/30 text-sm">No render started yet.</div>
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
          <p className="text-red-400 font-semibold">Render failed</p>
          <p className="text-white/50 text-[13px] mt-1">Check your API keys and worker logs, then try again from Voice & Visuals.</p>
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
                <span className="text-[12px] text-white/45"><span className="text-white/70 font-medium">{scenes.length}</span> scenes</span>
                <span className="text-[12px] text-white/45"><span className="text-white/70 font-medium">{totalDuration}s</span> duration</span>
                {activeProject?.folder && (
                  <span className="text-[12px] text-white/45">saved to <span className="text-violet-400">/{activeProject.folder}</span></span>
                )}
              </div>
            </div>
            <span className="text-[10px] font-bold bg-teal-500/15 text-teal-400 px-2.5 py-1 rounded-full uppercase tracking-widest flex-shrink-0">
              Exported
            </span>
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
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { type: 'full'   as const, icon: '🎬', title: 'Full video',      desc: 'Single MP4 — voice, visuals, subtitles', badge: 'MP4 · H.264',       color: 'teal'   as const },
              { type: 'scenes' as const, icon: '🗂',  title: 'Scene bundle',    desc: 'Per-scene MP4 clips + JSON',              badge: 'ZIP · scenes + JSON', color: 'purple' as const },
              { type: 'capcut' as const, icon: '✂️',  title: 'CapCut package',  desc: 'Scene files + draft_content.json',        badge: 'CapCut ready',       color: 'amber'  as const },
            ].map(({ type, icon, title, desc, badge, color }) => (
              <a
                key={type}
                href={exportUrl(jobId, type, projectTitle)}
                download
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
          <div className="flex gap-3 mb-2">
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
