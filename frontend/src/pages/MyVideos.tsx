import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { useAuthStore } from '../authStore'
import { api } from '../lib/api'
import { PageHeader } from '../components/ui'

interface RenderRecord {
  job_id: string
  title: string
  niche: string
  platform: string
  video_url: string
  scene_count: number
  duration: number
  ts: string
  status: string
}

function timeAgo(ts: string): string {
  if (!ts) return ''
  try {
    const diff = Date.now() - new Date(ts).getTime()
    const mins  = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days  = Math.floor(diff / 86400000)
    if (mins  < 1)   return 'Just now'
    if (mins  < 60)  return `${mins}m ago`
    if (hours < 24)  return `${hours}h ago`
    if (days  < 7)   return `${days}d ago`
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '' }
}

function platformShort(platform: string): string {
  if (!platform) return ''
  if (platform.toLowerCase().includes('tiktok'))    return 'TikTok'
  if (platform.toLowerCase().includes('youtube'))   return 'YouTube'
  if (platform.toLowerCase().includes('instagram')) return 'Reels'
  if (platform.toLowerCase().includes('linkedin'))  return 'LinkedIn'
  if (platform.toLowerCase().includes('twitter') || platform.toLowerCase().includes('x.com')) return 'X'
  return platform.split('(')[0].trim()
}

function VideoCard({ record, onRerender }: { record: RenderRecord; onRerender: (r: RenderRecord) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hovering, setHovering] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const handleMouseEnter = () => {
    setHovering(true)
    videoRef.current?.play().catch(() => {})
  }
  const handleMouseLeave = () => {
    setHovering(false)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await fetch(record.video_url)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${record.title.replace(/[^a-z0-9]/gi, '_')}.mp4`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      window.open(record.video_url, '_blank')
    } finally {
      setDownloading(false)
    }
  }

  const isPortrait = record.platform?.toLowerCase().includes('tiktok')
    || record.platform?.toLowerCase().includes('9:16')
    || record.platform?.toLowerCase().includes('reels')
    || record.platform?.toLowerCase().includes('shorts')

  return (
    <div
      className="group relative bg-[#111118] border border-white/[0.07] rounded-xl overflow-hidden hover:border-white/15 hover:-translate-y-0.5 transition-all duration-150 cursor-pointer"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Video thumbnail / preview */}
      <div className={`relative w-full bg-[#0a0a12] overflow-hidden ${isPortrait ? 'aspect-[9/16] max-h-48' : 'aspect-video'}`}
           style={{ maxHeight: isPortrait ? '180px' : undefined }}>
        <video
          ref={videoRef}
          src={record.video_url}
          className="w-full h-full object-cover"
          muted
          playsInline
          preload="metadata"
          loop
        />
        {/* Play overlay when not hovering */}
        {!hovering && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="w-10 h-10 rounded-full bg-white/15 border border-white/20 flex items-center justify-center backdrop-blur-sm">
              <svg width="14" height="14" viewBox="0 0 12 14" fill="white">
                <path d="M1 1l10 6-10 6V1z"/>
              </svg>
            </div>
          </div>
        )}
        {/* Duration badge */}
        {record.duration > 0 && (
          <div className="absolute bottom-2 right-2 bg-black/70 text-white/80 text-[10px] font-medium px-1.5 py-0.5 rounded">
            {Math.floor(record.duration / 60)}:{String(Math.round(record.duration % 60)).padStart(2, '0')}
          </div>
        )}
      </div>

      {/* Card info */}
      <div className="p-3">
        <p className="text-[13px] font-medium text-white/85 truncate mb-1">{record.title || 'Untitled'}</p>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {record.niche && (
            <span className="text-[10px] bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full">
              {record.niche}
            </span>
          )}
          {record.platform && (
            <span className="text-[10px] bg-teal-500/10 text-teal-400 border border-teal-500/20 px-2 py-0.5 rounded-full">
              {platformShort(record.platform)}
            </span>
          )}
          {record.scene_count > 0 && (
            <span className="text-[10px] text-white/30">{record.scene_count} scenes</span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-white/30">{timeAgo(record.ts)}</span>

          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Re-render */}
            <button
              onClick={(e) => { e.stopPropagation(); onRerender(record) }}
              title="Open this project to edit or re-render"
              className="h-7 px-2.5 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/25 text-violet-300 text-[11px] font-medium rounded-lg transition-colors flex items-center gap-1"
            >
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M1 6A5 5 0 0 1 9.5 2.5M11 6A5 5 0 0 1 2.5 9.5"/>
                <path d="M9 2l.5 2-2-.5M3 10l-.5-2 2 .5"/>
              </svg>
              Open
            </button>

            {/* Download */}
            <button
              onClick={(e) => { e.stopPropagation(); handleDownload() }}
              title="Download video"
              disabled={downloading}
              className="h-7 w-7 bg-[#1c1c28] hover:bg-white/10 border border-white/[0.08] text-white/60 hover:text-white/85 rounded-lg transition-colors flex items-center justify-center"
            >
              {downloading
                ? <span className="animate-spin text-[9px]">⟳</span>
                : <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M6 1v7M3 6l3 3 3-3M1 10h10"/>
                  </svg>
              }
            </button>

            {/* Open in new tab */}
            <a
              href={record.video_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open video"
              className="h-7 w-7 bg-[#1c1c28] hover:bg-white/10 border border-white/[0.08] text-white/60 hover:text-white/85 rounded-lg transition-colors flex items-center justify-center"
            >
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M7 1h4v4M11 1L6 6"/>
                <path d="M5 3H2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V8"/>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MyVideos() {
  const setStep        = useStore((s) => s.setStep)
  const openProject    = useStore((s) => s.openProject)
  const setPrevJobId   = useStore((s) => (s as any).setPrevJobId as (id: string | null) => void)
  const projects       = useStore((s) => s.projects)
  const [renders, setRenders]   = useState<RenderRecord[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter,  setFilter]    = useState<'all' | string>('all')
  const [search,  setSearch]    = useState('')
  const [locked,  setLocked]    = useState(0)
  const [maxSaved, setMaxSaved] = useState(-1)

  useEffect(() => {
    // Fetch history and backfill scenes in parallel
    Promise.all([
      api.get('/api/render/history?limit=100'),
      api.post('/api/render/scenes/backfill').catch(() => {}), // silent — best effort
    ]).then(([histRes]) => {
      setRenders(histRes.data.renders || [])
      setLocked(histRes.data.locked || 0)
      setMaxSaved(histRes.data.max_saved ?? -1)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const niches = Array.from(new Set(renders.map(r => r.niche).filter(Boolean)))

  const filtered = renders.filter(r => {
    const matchFilter = filter === 'all' || r.niche === filter
    const matchSearch = !search || r.title.toLowerCase().includes(search.toLowerCase())
      || r.niche.toLowerCase().includes(search.toLowerCase())
    return matchFilter && matchSearch
  })

  async function handleRerender(record: RenderRecord) {
    const linked = projects.find(p => p.job_id === record.job_id)

    try {
      // Fetch the original scenes from the existing scene-editor endpoint
      const res = await api.get(`/api/render/scenes/${record.job_id}`)
      const fetchedScenes = res.data.scenes || []
      const found = res.data.found !== false && fetchedScenes.length > 0

      if (found) {
        // Restore scenes and mark as re-render so no tokens are deducted
        if (linked) openProject(linked.id)
        else {
          useStore.getState().setConfig({
            niche:    record.niche    || '',
            platform: record.platform || 'TikTok',
          } as any)
        }
        useStore.getState().setScenes(fetchedScenes)
        useStore.getState().setJobId(record.job_id)
        setStep('scenes')
        // Set prevJobId LAST — openProject() calls CLEAR_WORKFLOW which resets it
        // Setting it after all other operations ensures it survives
        setTimeout(() => setPrevJobId(record.job_id), 0)
        return
      }
    } catch {
      // Scenes expired or unavailable — fall through to setup
    }

    // Scenes not available (render is older than 7 days or not yet stored).
    // Pre-fill config and send user to Setup to regenerate.
    if (linked) openProject(linked.id)
    useStore.getState().setConfig({
      niche:    record.niche    || '',
      platform: record.platform || 'TikTok',
      scene_count_hint: record.scene_count || 8,
    } as any)
    setStep('setup')
    // Brief toast so user knows why they landed on Setup
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: 'Scenes expired — reconfigure your video to re-render', type: 'info' }
      }))
    }, 300)
  }

  return (
    <div>
      <PageHeader title="My Videos" subtitle={renders.length + ' video' + (renders.length !== 1 ? 's' : '') + ' saved' + (locked > 0 ? ' · ' + locked + ' hidden (free plan)' : '')} />

      {/* Search + filter bar */}
      {renders.length > 0 && (
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="5" cy="5" r="4"/><path d="M9 9l2 2"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search videos…"
              className="w-full bg-[#111118] border border-white/[0.07] rounded-lg pl-8 pr-3 py-2 text-[13px] text-white/80 placeholder-white/25 focus:outline-none focus:border-violet-500/40"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {['all', ...niches].map(n => (
              <button
                key={n}
                onClick={() => setFilter(n)}
                className={`px-3 py-1.5 rounded-full text-[12px] font-medium border whitespace-nowrap transition-all ${
                  filter === n
                    ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
                    : 'bg-transparent border-white/[0.07] text-white/40 hover:text-white/70 hover:border-white/15'
                }`}
              >
                {n === 'all' ? `All (${renders.length})` : n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="bg-[#111118] border border-white/[0.05] rounded-xl overflow-hidden animate-pulse">
              <div className="aspect-video bg-white/[0.04]" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-white/[0.06] rounded w-3/4" />
                <div className="h-2.5 bg-white/[0.04] rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && renders.length === 0 && (
        <div className="py-20 text-center">
          <div className="text-5xl mb-4">🎬</div>
          <p className="text-white/50 text-sm mb-1">No videos yet</p>
          <p className="text-white/30 text-xs mb-6">Render your first video to see it here</p>
          <button
            onClick={() => setStep('setup')}
            className="px-5 py-2.5 bg-violet-500 hover:bg-violet-600 text-white text-[13px] font-semibold rounded-xl transition-colors"
          >
            Create your first video
          </button>
        </div>
      )}

      {/* No results */}
      {!loading && renders.length > 0 && filtered.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-white/40 text-sm">No videos match your search</p>
        </div>
      )}

      {/* Video grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {filtered.map(r => (
            <VideoCard key={r.job_id} record={r} onRerender={handleRerender} />
          ))}
        </div>
      )}


      {/* Upgrade prompt — shown when free user has hidden videos */}
      {!loading && locked > 0 && (
        <div className="mt-4 bg-amber-500/[0.07] border border-amber-500/20 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-amber-500/12 flex items-center justify-center flex-shrink-0 text-lg">🔒</div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-amber-300 mb-0.5">
              {locked} video{locked !== 1 ? 's' : ''} hidden — free plan stores {maxSaved}
            </p>
            <p className="text-[12px] text-white/40">
              Upgrade to keep your full video library. Paid plans have unlimited saved videos.
            </p>
          </div>
          <button
            onClick={() => setStep('plans')}
            className="px-4 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[12px] font-semibold rounded-xl transition-colors flex-shrink-0"
          >
            Upgrade
          </button>
        </div>
      )}

      {/* Stats footer */}
      {!loading && renders.length > 0 && (
        <div className="mt-8 pt-6 border-t border-white/[0.05] flex gap-6 flex-wrap">
          {[
            { label: 'Total videos', value: renders.length },
            { label: 'Total scenes', value: renders.reduce((s, r) => s + (r.scene_count || 0), 0) },
            { label: 'Total duration', value: `${Math.round(renders.reduce((s, r) => s + (r.duration || 0), 0) / 60)}m` },
          ].map(stat => (
            <div key={stat.label}>
              <p className="text-[22px] font-bold text-white/85">{stat.value}</p>
              <p className="text-[11px] text-white/35 uppercase tracking-wider">{stat.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
