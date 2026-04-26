import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useJobPoller } from '../hooks/useJobPoller'
import { getManifest, exportUrl } from '../lib/api'
import { Button, Badge, ProgressBar, PageHeader } from '../components/ui'

export default function Export() {
  const jobId = useStore((s) => s.jobId)
  const renderProgress = useStore((s) => s.renderProgress)
  const renderStage = useStore((s) => s.renderStage)
  const renderStatus = useStore((s) => s.renderStatus)
  const videoUrl = useStore((s) => s.videoUrl)
  const scenes = useStore((s) => s.scenes)
  const selectedIdea = useStore((s) => s.selectedIdea)

  const [manifest, setManifest] = useState<any>(null)

  // Start polling
  useJobPoller(jobId)

  // Load manifest once complete
  useEffect(() => {
    if (renderStatus === 'complete' && jobId) {
      getManifest(jobId).then(setManifest).catch(() => {})
    }
  }, [renderStatus, jobId])

  const isProcessing = renderStatus === 'queued' || renderStatus === 'processing'
  const isDone = renderStatus === 'complete'
  const isFailed = renderStatus === 'failed'

  if (!jobId) {
    return (
      <div>
        <PageHeader title="Export" subtitle="Complete the Voice & Visuals step to render your video" />
        <div className="py-20 text-center text-white/30 text-sm">
          No render started yet.
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Export" subtitle="Download your video or scene files for CapCut" />

      {/* Render progress */}
      {isProcessing && (
        <div className="bg-[#111118] border border-white/[0.07] rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[13px] font-medium text-white/80 animate-pulse">{renderStage || 'Processing…'}</p>
            <span className="text-[13px] font-bold text-violet-400">{renderProgress}%</span>
          </div>
          <ProgressBar value={renderProgress} />
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { label: 'Voice synthesis', done: renderProgress >= 35 },
              { label: 'Visuals', done: renderProgress >= 55 },
              { label: 'FFmpeg render', done: renderProgress >= 90 },
              { label: 'Export files', done: renderProgress >= 100 },
            ].map(({ label, done }) => (
              <div key={label} className="flex items-center gap-1.5 text-[12px]">
                <div className={`w-1.5 h-1.5 rounded-full ${done ? 'bg-teal-400' : 'bg-white/20'}`} />
                <span className={done ? 'text-teal-400' : 'text-white/40'}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failed state */}
      {isFailed && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-5 mb-6">
          <p className="text-red-400 font-medium">Render failed</p>
          <p className="text-white/50 text-sm mt-1">Check your API keys and try again from the Voice & Visuals step.</p>
        </div>
      )}

      {/* Success state */}
      {isDone && (
        <>
          <div className="bg-teal-500/10 border border-teal-500/25 rounded-xl p-4 mb-6 flex items-center gap-3">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#2DD4BF" strokeWidth="2">
              <circle cx="8" cy="8" r="6" />
              <path d="M5 8l2 2 4-4" />
            </svg>
            <div>
              <p className="text-teal-400 font-medium text-[14px]">Render complete</p>
              <p className="text-white/40 text-[12px]">
                {scenes.length} scenes · {scenes.reduce((s, sc) => s + sc.duration, 0)}s
              </p>
            </div>
          </div>

          {/* Export options */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              {
                type: 'full' as const,
                icon: '🎬',
                title: 'Full video',
                desc: 'Single MP4 — voice, visuals, subtitles',
                badge: 'MP4 · H.264',
                color: 'teal' as const,
              },
              {
                type: 'scenes' as const,
                icon: '🗂',
                title: 'Scene bundle',
                desc: 'Per-scene MP4s + JSON manifest',
                badge: 'ZIP · scenes + JSON',
                color: 'purple' as const,
              },
              {
                type: 'capcut' as const,
                icon: '✂️',
                title: 'CapCut package',
                desc: 'Scene files + draft_content.json for import',
                badge: 'CapCut ready',
                color: 'amber' as const,
              },
            ].map(({ type, icon, title, desc, badge, color }) => (
              <a
                key={type}
                href={exportUrl(jobId, type)}
                download
                className="block bg-[#111118] border border-white/[0.07] rounded-xl p-5 text-center hover:border-white/15 hover:-translate-y-0.5 transition-all duration-150"
              >
                <div className="text-3xl mb-3">{icon}</div>
                <p className="font-display font-bold text-[14px] text-white mb-1">{title}</p>
                <p className="text-[12px] text-white/40 mb-3">{desc}</p>
                <Badge color={color}>{badge}</Badge>
              </a>
            ))}
          </div>

          {/* Video preview */}
          {videoUrl && (
            <div className="mb-8">
              <p className="text-[12px] text-white/40 uppercase tracking-widest font-semibold mb-3">Preview</p>
              <video
                src={videoUrl}
                controls
                className="max-w-xs mx-auto rounded-xl border border-white/10"
                style={{ maxHeight: 400 }}
              />
            </div>
          )}

          {/* CapCut manifest */}
          {manifest && (
            <div>
              <p className="text-[12px] text-white/40 uppercase tracking-widest font-semibold mb-3">
                Scene manifest
              </p>
              <div className="bg-[#0D0D14] border border-white/[0.07] rounded-xl p-4 font-mono text-[11.5px] text-white/50 max-h-52 overflow-y-auto whitespace-pre leading-relaxed">
                {JSON.stringify(manifest, null, 2)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
