import { useState } from 'react'
import { useStore } from '../store'
import { usePlanLimits } from '../hooks/usePlanLimits'
import { searchVisuals, type Scene, type VisualResult } from '../lib/api'
import { Button, Badge, PageHeader } from '../components/ui'

const TYPE_COLORS = {
  hook: 'coral',
  intro: 'teal',
  main: 'purple',
  cta: 'amber',
} as const

export default function SceneEditor() {
  const scenes = useStore((s) => s.scenes)
  const activeSceneIndex = useStore((s) => s.activeSceneIndex)
  const setActiveSceneIndex = useStore((s) => s.setActiveSceneIndex)
  const updateScene = useStore((s) => s.updateScene)
  const moveScene = useStore((s) => s.moveScene)
  const deleteScene = useStore((s) => s.deleteScene)
  const addScene = useStore((s) => s.addScene)
  const { canAddScene, scenesRemaining, maxScenes, isFree } = usePlanLimits()
  const setStep = useStore((s) => s.setStep)
  const markStepComplete = useStore((s) => s.markStepComplete)

  const [visualResults, setVisualResults] = useState<VisualResult[]>([])
  const [visualLoading, setVisualLoading] = useState(false)
  const [selectedVisualId, setSelectedVisualId] = useState<string | null>(null)

  const activeScene = scenes[activeSceneIndex]
  const totalDuration = scenes.reduce((s, sc) => s + sc.duration, 0)

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

  if (scenes.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-white/40 text-sm">No scenes yet — complete the Script step first.</p>
      </div>
    )
  }

  return (
    <div>
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
          <Button variant="primary" size="sm" onClick={handleContinue}>
            Next: Voice & visuals →
          </Button>
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
                    onClick={(e) => { e.stopPropagation(); deleteScene(i) }}
                    className="w-5 h-5 bg-[#22222F] rounded text-red-400/60 hover:text-red-400 text-[10px] flex items-center justify-center"
                    title="Delete"
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
              <Badge color={TYPE_COLORS[activeScene.type]}>{activeScene.type}</Badge>
            </div>

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
            <div className="grid grid-cols-2 gap-3 mb-4">
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
          </div>
        )}
      </div>
    </div>
  )
}
