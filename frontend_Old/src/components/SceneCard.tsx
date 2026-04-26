import type { Scene } from '../lib/api'
import { Badge } from './ui'

const TYPE_COLORS = {
  hook:  'coral',
  intro: 'teal',
  main:  'purple',
  cta:   'amber',
} as const

interface SceneCardProps {
  scene: Scene
  index: number
  active?: boolean
  onClick?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onDelete?: () => void
}

export default function SceneCard({
  scene,
  index,
  active = false,
  onClick,
  onMoveUp,
  onMoveDown,
  onDelete,
}: SceneCardProps) {
  return (
    <div
      onClick={onClick}
      className={`
        relative group p-3 rounded-xl border cursor-pointer transition-all duration-150
        ${active
          ? 'bg-violet-500/12 border-violet-500/35'
          : 'bg-[#111118] border-white/[0.07] hover:border-white/15'}
      `}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[9px] font-bold text-white/30 font-display tracking-wider">
          {String(index + 1).padStart(2, '0')}
        </span>
        <Badge color={TYPE_COLORS[scene.type]}>{scene.type}</Badge>
      </div>

      {/* Text preview */}
      <p className="text-[12px] text-white/65 leading-snug line-clamp-2 mb-1.5 pr-6">
        {scene.text}
      </p>

      {/* Duration */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-teal-400">{scene.duration}s</span>
        {scene.visual_keyword && (
          <span className="text-[10px] text-white/25 truncate max-w-[100px]">
            {scene.visual_keyword}
          </span>
        )}
      </div>

      {/* Hover action buttons */}
      <div className="absolute top-2 right-2 hidden group-hover:flex flex-col gap-0.5">
        <button
          onClick={(e) => { e.stopPropagation(); onMoveUp?.() }}
          className="w-5 h-5 bg-[#22222F] rounded text-white/35 hover:text-white/80 text-[10px] flex items-center justify-center transition-colors"
          title="Move up"
        >↑</button>
        <button
          onClick={(e) => { e.stopPropagation(); onMoveDown?.() }}
          className="w-5 h-5 bg-[#22222F] rounded text-white/35 hover:text-white/80 text-[10px] flex items-center justify-center transition-colors"
          title="Move down"
        >↓</button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete?.() }}
          className="w-5 h-5 bg-[#22222F] rounded text-red-400/50 hover:text-red-400 text-[11px] flex items-center justify-center transition-colors"
          title="Delete"
        >×</button>
      </div>
    </div>
  )
}
