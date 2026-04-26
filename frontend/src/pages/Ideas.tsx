import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useStore } from '../store'
import { generateIdeas, type IdeaItem } from '../lib/api'
import { Button, Badge, LoadingState, PageHeader } from '../components/ui'

export default function Ideas() {
  const config = useStore((s) => s.config)
  const ideas = useStore((s) => s.ideas)
  const selectedIdea = useStore((s) => s.selectedIdea)
  const setIdeas = useStore((s) => s.setIdeas)
  const setSelectedIdea = useStore((s) => s.setSelectedIdea)
  const setStep = useStore((s) => s.setStep)
  const markStepComplete = useStore((s) => s.markStepComplete)

  const [fetchKey, setFetchKey] = useState(0)

  const { isLoading } = useQuery({
    queryKey: ['ideas', config.niche, config.style, fetchKey],
    queryFn: async () => {
      const data = await generateIdeas({
        niche: config.niche,
        style: config.style,
        platform: config.platform,
        tone: config.tone,
        audience: config.audience,
        context: config.context,
        idea_tags: config.ideaTags || [],
      })
      setIdeas(data)
      return data
    },
    enabled: !!(config.niche && config.style),
    staleTime: Infinity,
  })

  function handleSelect(idea: IdeaItem) {
    setSelectedIdea(idea)
  }

  function handleContinue() {
    if (!selectedIdea) return
    markStepComplete('ideas')
    setStep('script')
  }

  const TYPE_COLORS: Record<string, 'purple' | 'teal' | 'coral' | 'amber'> = {
    'Educational': 'teal',
    'Viral / Hook-first': 'coral',
    'Storytelling': 'purple',
    'Listicle': 'amber',
  }
  const badgeColor = TYPE_COLORS[config.style] ?? 'purple'

  return (
    <div>
      <PageHeader
        title="Content ideas"
        subtitle={`AI-generated for ${config.niche} · ${config.style} — select one to continue`}
      />

      {isLoading && <LoadingState label="Generating ideas with SceneForge…" progress={60} />}

      {!isLoading && ideas.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {ideas.map((idea, i) => {
              const isSelected = selectedIdea?.title === idea.title
              return (
                <button
                  key={i}
                  onClick={() => handleSelect(idea)}
                  className={`
                    text-left p-4 rounded-xl border transition-all duration-150
                    ${isSelected
                      ? 'bg-violet-500/12 border-violet-500/40'
                      : 'bg-[#111118] border-white/[0.07] hover:border-white/15 hover:-translate-y-0.5'}
                  `}
                >
                  <p className="text-[10px] font-bold text-white/30 font-display tracking-wider mb-1.5">
                    IDEA {String(i + 1).padStart(2, '0')}
                  </p>
                  <p className="text-[14px] font-medium text-white leading-snug mb-1.5">
                    {idea.title}
                  </p>
                  <p className="text-[12.5px] text-white/50 mb-3 leading-relaxed">
                    "{idea.hook}"
                  </p>
                  <Badge color={badgeColor}>{idea.angle}</Badge>
                </button>
              )
            })}
          </div>

          <div className="flex gap-3">
            <Button
              variant="primary"
              onClick={handleContinue}
              disabled={!selectedIdea}
            >
              Write script →
            </Button>
            <Button variant="ghost" onClick={() => setFetchKey((k) => k + 1)}>
              Regenerate ideas
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
