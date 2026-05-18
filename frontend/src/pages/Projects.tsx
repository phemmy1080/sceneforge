import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { useAuthStore } from '../authStore'
import { Button, Badge, PageHeader, EmptyState } from '../components/ui'

type FilterStatus = 'all' | 'active' | 'draft' | 'exported'

const STATUS_LABELS = {
  active:   'Active',
  exported: 'Exported',
  draft:    'Draft',
}

export default function Projects() {
  const projects         = useStore((s) => s.projects)
  const openProject      = useStore((s) => s.openProject)
  const deleteProject    = useStore((s) => s.deleteProject)
  const duplicateProject = useStore((s) => s.duplicateProject)
  const setStep          = useStore((s) => s.setStep)
  const user             = useAuthStore((s) => s.user)

  const [filter, setFilter] = useState<FilterStatus>('all')

  // Workspace members (non-owners) should work in the agency flow, not here.
  // Redirect them to the agency dashboard automatically.
  useEffect(() => {
    const role = user?.workspace_role
    const wsId = user?.workspace_id
    if (wsId && role !== 'owner') {
      setStep('agency' as any)
    }
  }, [user?.workspace_id, user?.workspace_role])

  // Non-owners in a workspace see this redirect message briefly
  if (user?.workspace_id && user?.workspace_role !== 'owner') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <div className="text-2xl">🏢</div>
          <p className="text-white/50 text-sm">Redirecting to your agency workspace…</p>
        </div>
      </div>
    )
  }

  const filtered = filter === 'all' ? projects : projects.filter((p) => p.status === filter)

  const counts = {
    all:      projects.length,
    active:   projects.filter((p) => p.status === 'active').length,
    exported: projects.filter((p) => p.status === 'exported').length,
    draft:    projects.filter((p) => p.status === 'draft').length,
  }

  function handleOpen(id: string) {
    openProject(id)
    setStep('setup')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <PageHeader title="Projects" subtitle="All your saved projects — hover a card for options" />
        <Button
          variant="primary"
          size="sm"
          onClick={() => document.dispatchEvent(new CustomEvent('open-new-project-modal'))}
        >
          + New project
        </Button>
      </div>

      {/* Filter chips — py-2 ensures ≥36px height for touch targets */}
      <div className="flex gap-2 flex-wrap mb-5">
        {(['all', 'active', 'exported', 'draft'] as FilterStatus[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            aria-label={`Filter by ${f} (${counts[f]})`}
            className={`
              px-3.5 py-2 rounded-full text-[12px] font-medium border transition-all
              ${filter === f
                ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
                : 'bg-[#1A1A24] border-white/10 text-white/60 hover:border-white/25 hover:text-white/80'}
            `}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState label={filter === 'all' ? 'No projects yet — create your first one above.' : `No ${filter} projects.`} />
      ) : (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {filtered.map((proj) => (
            <div
              key={proj.id}
              onClick={() => handleOpen(proj.id)}
              role="button"
              tabIndex={0}
              aria-label={`Open project: ${proj.name}`}
              onKeyDown={(e) => e.key === 'Enter' && handleOpen(proj.id)}
              className="group relative bg-[#111118] border border-white/[0.07] rounded-xl p-4 cursor-pointer hover:border-white/15 hover:-translate-y-0.5 transition-all duration-150"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-[13.5px] font-semibold text-white leading-snug flex-1">{proj.name}</p>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${
                    proj.status === 'active'   ? 'bg-violet-500/15 text-violet-300'
                    : proj.status === 'exported' ? 'bg-teal-500/15 text-teal-400'
                    : 'bg-amber-500/15 text-amber-400'
                  }`}
                >
                  {STATUS_LABELS[proj.status]}
                </span>
              </div>

              {/* Meta — boosted from /40 to /60 for contrast */}
              <p className="text-[11.5px] text-white/60 mb-2">
                {proj.niche} · {proj.style} · {proj.platform.split(' ')[0]}
              </p>

              {/* Tags */}
              <div className="flex gap-2 flex-wrap mb-3">
                {proj.sceneCount > 0 && <Badge color="teal">{proj.sceneCount} scenes</Badge>}
                {proj.duration > 0   && <Badge color="purple">{proj.duration}s</Badge>}
                {proj.sceneCount === 0 && <Badge color="gray">{proj.step} step</Badge>}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between">
                {/* Date — boosted from /25 to /55 for contrast */}
                <span className="text-[10.5px] text-white/55">{proj.createdAt}</span>

                {/* Action buttons — w-8 h-8 + relative positioning for 44px tap area via CSS */}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleOpen(proj.id) }}
                    className="w-8 h-8 bg-[#22222F] rounded text-white/60 hover:text-white/90 text-[10px] flex items-center justify-center transition-colors"
                    title="Open"
                    aria-label="Open project"
                  >▶</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); duplicateProject(proj.id) }}
                    className="w-8 h-8 bg-[#22222F] rounded text-white/60 hover:text-white/90 text-[11px] flex items-center justify-center transition-colors"
                    title="Duplicate"
                    aria-label="Duplicate project"
                  >⊕</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteProject(proj.id) }}
                    className="w-8 h-8 bg-[#22222F] rounded text-red-400/60 hover:text-red-400 text-[11px] flex items-center justify-center transition-colors"
                    title="Delete"
                    aria-label="Delete project"
                  >×</button>
                </div>
              </div>
            </div>
          ))}

          {/* New project card */}
          <button
            onClick={() => document.dispatchEvent(new CustomEvent('open-new-project-modal'))}
            aria-label="Create new project"
            className="border border-dashed border-white/12 rounded-xl flex flex-col items-center justify-center gap-2 min-h-[120px] cursor-pointer hover:border-white/25 transition-all duration-150 bg-transparent w-full"
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
              <circle cx="11" cy="11" r="9" />
              <path d="M11 6v10M6 11h10" />
            </svg>
            <span className="text-[12px] text-white/55">New project</span>
          </button>
        </div>
      )}
    </div>
  )
}
