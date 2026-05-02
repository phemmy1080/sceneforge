import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { getNiches, type Niche } from '../lib/api'
import { Button, Card, CardTitle, Chip, Select, TextInput, PageHeader } from '../components/ui'

// Niches loaded from API — see useEffect below
const STYLES = ['Educational', 'Viral / Hook-first', 'Storytelling', 'Listicle', 'Documentary', 'Tutorial', 'Opinion / Hot take']
const PLATFORMS = ['TikTok (9:16, 60s)', 'YouTube Shorts (9:16, 60s)', 'Instagram Reels (9:16, 30s)', 'YouTube (16:9, 3–10 min)', 'LinkedIn (1:1, 60s)']
const TONES = ['Energetic & punchy', 'Calm & informative', 'Conversational', 'Professional', 'Humorous', 'Inspirational']

// Suggested idea prompts per niche — shown as quick-add chips
// Suggestions loaded from API

export default function Setup() {
  const [niches, setNiches] = useState<Niche[]>([])
  const [nicheMap, setNicheMap] = useState<Record<string, string[]>>({})

  useEffect(() => {
    getNiches().then((data) => {
      setNiches(data)
      const map: Record<string, string[]> = {}
      data.forEach((n) => { map[n.key] = n.suggestions })
      setNicheMap(map)
    }).catch(() => {})
  }, [])

  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const setStep = useStore((s) => s.setStep)
  const markStepComplete = useStore((s) => s.markStepComplete)

  const [ideaInput, setIdeaInput] = useState(config.ideaHints || '')
  const [ideaTags, setIdeaTags] = useState<string[]>(config.ideaTags || [])

  const suggestions = nicheMap[config.niche] || []

  function addTag(tag: string) {
    const trimmed = tag.trim()
    if (!trimmed || ideaTags.includes(trimmed)) return
    const next = [...ideaTags, trimmed]
    setIdeaTags(next)
    setConfig({ ideaTags: next })
    setIdeaInput('')
  }

  function removeTag(tag: string) {
    const next = ideaTags.filter((t) => t !== tag)
    setIdeaTags(next)
    setConfig({ ideaTags: next })
  }

  function handleIdeaKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && ideaInput.trim()) {
      e.preventDefault()
      addTag(ideaInput)
    }
    if (e.key === 'Backspace' && !ideaInput && ideaTags.length > 0) {
      removeTag(ideaTags[ideaTags.length - 1])
    }
  }

  const canContinue = !!(config.niche && config.style)

  function handleContinue() {
    setConfig({ ideaHints: ideaInput, ideaTags })
    markStepComplete('setup')
    setStep('ideas')
  }

  return (
    <div>
      <PageHeader
        title="New project"
        subtitle="Configure your content — AI will generate everything from here"
      />

      {/* Niche */}
      <Card className="mb-4">
        <CardTitle>Content niche</CardTitle>
        <div className="flex flex-wrap gap-2">
          {niches.map((n) => (
            <Chip key={n.label} label={n.label} selected={config.niche === n.key}
              onClick={() => {
                setConfig({ niche: n.key })
                setIdeaTags([])
                setConfig({ ideaTags: [] })
              }}
            />
          ))}
        </div>
      </Card>

      {/* Idea hints — NEW FEATURE */}
      <Card className="mb-4">
        <CardTitle>Topic ideas & hints <span className="text-violet-400 normal-case font-normal">(optional — guides AI generation)</span></CardTitle>

        {/* Tag input */}
        <div className="flex flex-wrap gap-2 min-h-[40px] bg-[#1A1A24] border border-white/12 rounded-lg px-3 py-2 mb-3 cursor-text"
          onClick={() => document.getElementById('idea-input')?.focus()}
        >
          {ideaTags.map((tag) => (
            <span key={tag} className="flex items-center gap-1.5 bg-violet-500/20 text-violet-300 text-[12px] font-medium px-2.5 py-1 rounded-full">
              {tag}
              <button onClick={(e) => { e.stopPropagation(); removeTag(tag) }}
                className="text-violet-400/60 hover:text-violet-300 text-[11px] leading-none">×</button>
            </span>
          ))}
          <input
            id="idea-input"
            type="text"
            value={ideaInput}
            onChange={(e) => setIdeaInput(e.target.value)}
            onKeyDown={handleIdeaKeyDown}
            onBlur={() => { if (ideaInput.trim()) addTag(ideaInput) }}
            placeholder={ideaTags.length === 0 ? 'Type a topic idea, then press Enter or comma to add…' : 'Add another…'}
            className="flex-1 min-w-[180px] bg-transparent outline-none text-[13px] text-white/80 placeholder-white/25"
          />
        </div>

        {/* Suggestions for the selected niche */}
        {suggestions.length > 0 && (
          <div>
            <p className="text-[11px] text-white/35 mb-2">Quick add for {config.niche}:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => addTag(s)}
                  disabled={ideaTags.includes(s)}
                  className={`text-[11.5px] px-3 py-1 rounded-full border transition-all
                    ${ideaTags.includes(s)
                      ? 'border-violet-500/30 bg-violet-500/10 text-violet-400/50 cursor-default'
                      : 'border-white/10 bg-white/3 text-white/45 hover:border-violet-400/40 hover:text-violet-300 hover:bg-violet-500/10'}`}
                >
                  + {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-white/30 mt-3">
          Add up to 5 topics. AI will generate ideas around your hints. Leave blank for fully AI-generated ideas.
        </p>
      </Card>

      {/* Style */}
      <Card className="mb-4">
        <CardTitle>Video style</CardTitle>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((s) => (
            <Chip key={s} label={s} selected={config.style === s} onClick={() => setConfig({ style: s })} />
          ))}
        </div>
      </Card>

      {/* Platform & details */}
      <Card className="mb-6">
        <CardTitle>Platform & details</CardTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Target platform" value={config.platform} onChange={(v) => setConfig({ platform: v })} options={PLATFORMS} />
          <Select label="Tone" value={config.tone} onChange={(v) => setConfig({ tone: v })} options={TONES} />
          <TextInput label="Target audience" value={config.audience} onChange={(v) => setConfig({ audience: v })} placeholder="e.g. beginner investors aged 20–35" />
          <TextInput label="Extra context (optional)" value={config.context} onChange={(v) => setConfig({ context: v })} placeholder="Any specific angle or topic focus…" />
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button variant="primary" onClick={handleContinue} disabled={!canContinue}>
          Generate ideas →
        </Button>
        <Button variant="ghost" onClick={() => { markStepComplete('setup'); setStep('upload') }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v8M4 6l4-4 4 4M2 14h12"/></svg>
          Upload my own script & voice
        </Button>
      </div>
    </div>
  )
}

import React from 'react'
