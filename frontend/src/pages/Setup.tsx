import React, { useState, useEffect } from 'react'
import { useStore } from '../store'
import { useAuthStore } from '../authStore'
import { getNiches, api, type Niche } from '../lib/api'
import { Button, Card, CardTitle, Chip, Select, TextInput, PageHeader } from '../components/ui'

const STYLES = [
  'Educational', 'Viral / Hook-first', 'Storytelling', 'Listicle',
  'Documentary', 'Tutorial', 'Opinion / Hot take', 'Product showcase',
  'Testimonial', 'Behind the scenes',
]

const PLATFORMS = [
  'TikTok','Instagram Reels','YouTube Shorts','YouTube',
  'Facebook','LinkedIn','Twitter/X','Snapchat','Pinterest',
]

const PLATFORM_HINTS: Record<string, string> = {
  'TikTok':          '9:16 · up to 60s · vertical',
  'Instagram Reels': '9:16 · up to 30s · vertical',
  'YouTube Shorts':  '9:16 · up to 60s · vertical',
  'YouTube':         '16:9 · 3–10 min · landscape',
  'Facebook':        '16:9 · up to 60s · landscape',
  'LinkedIn':        '1:1 · up to 60s · square',
  'Twitter/X':       '16:9 · up to 30s · landscape',
  'Snapchat':        '9:16 · up to 15s · vertical',
  'Pinterest':       '2:3 · up to 60s · portrait',
}

const TONES = [
  'Energetic & punchy', 'Calm & informative', 'Conversational',
  'Professional', 'Humorous', 'Inspirational',
  'Authoritative', 'Luxury', 'Urgent / Sales', 'Corporate B2B', 'Empathetic',
]

const OBJECTIVES = [
  { key: 'awareness',  label: 'Brand awareness',    icon: '📣' },
  { key: 'launch',     label: 'Product launch',      icon: '🚀' },
  { key: 'lead_gen',   label: 'Lead generation',     icon: '🎯' },
  { key: 'testimonial',label: 'Testimonial',          icon: '⭐' },
  { key: 'event',      label: 'Event promo',          icon: '📅' },
  { key: 'tutorial',   label: 'How-to / Tutorial',   icon: '🎓' },
  { key: 'sales',      label: 'Sales / CTA-first',   icon: '💰' },
  { key: 'story',      label: 'Brand story',          icon: '📖' },
]

const DURATIONS = [
  { value: 15,  label: '15s',  scenes: 3  },
  { value: 30,  label: '30s',  scenes: 5  },
  { value: 45,  label: '45s',  scenes: 6  },
  { value: 60,  label: '60s',  scenes: 8  },
  { value: 90,  label: '90s',  scenes: 10 },
  { value: 0,   label: 'Custom', scenes: 6 },
]

// Agency industry categories shown when in agency mode
const AGENCY_INDUSTRIES = [
  { key: 'fmcg',        label: 'FMCG / Consumer goods' },
  { key: 'finance',     label: 'Finance & Fintech' },
  { key: 'healthcare',  label: 'Healthcare' },
  { key: 'automotive',  label: 'Automotive' },
  { key: 'tech',        label: 'Technology / SaaS' },
  { key: 'fashion',     label: 'Fashion & Luxury' },
  { key: 'realestate',  label: 'Real estate' },
  { key: 'food',        label: 'Food & Beverage' },
  { key: 'education',   label: 'Education' },
  { key: 'ecommerce',   label: 'E-commerce / Retail' },
  { key: 'hospitality', label: 'Hospitality & Travel' },
  { key: 'nonprofit',   label: 'Non-profit' },
]


// ── Niche templates ───────────────────────────────────────────────────────────
const NICHE_TEMPLATES = [
  {
    id: 'personal-finance',
    icon: '💰', label: 'Personal Finance',
    niche: 'Finance', style: 'Educational', platform: 'TikTok',
    tone: 'Energetic & punchy', audience: 'Young Nigerians aged 18-35',
    objective: 'awareness',
    context: 'Help Nigerians understand money management, investing, and wealth building',
    ideaHints: 'How to save money on a Nigerian salary',
    duration_hint: 45, scene_count_hint: 6,
  },
  {
    id: 'real-estate',
    icon: '🏡', label: 'Real Estate',
    niche: 'Real Estate', style: 'Product showcase', platform: 'Instagram Reels',
    tone: 'Professional', audience: 'Property buyers and investors in Nigeria',
    objective: 'lead_gen',
    context: 'Showcase properties, land, or real estate investment opportunities in Nigeria',
    ideaHints: '3 reasons to buy land in Ibeju-Lekki now',
    duration_hint: 30, scene_count_hint: 5,
  },
  {
    id: 'fitness',
    icon: '💪', label: 'Fitness & Health',
    niche: 'Fitness', style: 'Tutorial', platform: 'TikTok',
    tone: 'Energetic & punchy', audience: 'Fitness enthusiasts aged 20-40',
    objective: 'awareness',
    context: 'Workout tips, nutrition advice, and healthy lifestyle content for Nigerians',
    ideaHints: '5-minute home workout with no equipment',
    duration_hint: 45, scene_count_hint: 6,
  },
  {
    id: 'ecommerce',
    icon: '🛍️', label: 'E-commerce / Product',
    niche: 'E-commerce', style: 'Product showcase', platform: 'Instagram Reels',
    tone: 'Urgent / Sales', audience: 'Online shoppers in Nigeria',
    objective: 'sales',
    context: 'Showcase products, announce deals, and drive purchases on your Nigerian online store',
    ideaHints: 'Why our customers love this product',
    duration_hint: 30, scene_count_hint: 5,
  },
  {
    id: 'motivational',
    icon: '🔥', label: 'Motivational',
    niche: 'Mindset', style: 'Viral / Hook-first', platform: 'TikTok',
    tone: 'Inspirational', audience: 'Young Nigerian entrepreneurs and hustlers',
    objective: 'awareness',
    context: 'Motivational content for Nigerian youth — mindset, hustle culture, success stories',
    ideaHints: 'How I built my business from nothing',
    duration_hint: 30, scene_count_hint: 5,
  },
  {
    id: 'food',
    icon: '🍲', label: 'Food & Restaurant',
    niche: 'Food', style: 'Behind the scenes', platform: 'TikTok',
    tone: 'Conversational', audience: 'Food lovers and restaurant-goers in Nigeria',
    objective: 'awareness',
    context: 'Nigerian food content — recipes, restaurant tours, street food, and food reviews',
    ideaHints: 'How to make perfect jollof rice',
    duration_hint: 45, scene_count_hint: 6,
  },
  {
    id: 'tech',
    icon: '📱', label: 'Tech & Gadgets',
    niche: 'Tech', style: 'Opinion / Hot take', platform: 'YouTube Shorts',
    tone: 'Conversational', audience: 'Tech-savvy Nigerians aged 18-35',
    objective: 'awareness',
    context: 'Tech reviews, tips, and opinions relevant to Nigerian tech consumers',
    ideaHints: 'Best budget smartphones in Nigeria 2025',
    duration_hint: 60, scene_count_hint: 8,
  },
  {
    id: 'business',
    icon: '🚀', label: 'Business & Entrepreneurship',
    niche: 'Business', style: 'Educational', platform: 'LinkedIn',
    tone: 'Professional', audience: 'Nigerian entrepreneurs and business owners',
    objective: 'awareness',
    context: 'Business advice, startup tips, and entrepreneurship insights for Nigerian founders',
    ideaHints: 'How to register your business in Nigeria',
    duration_hint: 60, scene_count_hint: 8,
  },
  {
    id: 'education',
    icon: '🎓', label: 'Education / Tutorial',
    niche: 'Education', style: 'Tutorial', platform: 'YouTube Shorts',
    tone: 'Calm & informative', audience: 'Students and learners across Nigeria',
    objective: 'tutorial',
    context: 'Educational content — explain concepts, skills, and knowledge in simple terms',
    ideaHints: 'Learn this skill in 60 seconds',
    duration_hint: 60, scene_count_hint: 8,
  },
  {
    id: 'fashion',
    icon: '👗', label: 'Fashion & Style',
    niche: 'Fashion', style: 'Product showcase', platform: 'Instagram Reels',
    tone: 'Luxury', audience: 'Fashion-conscious Nigerians aged 20-35',
    objective: 'awareness',
    context: 'Nigerian fashion — Ankara styles, accessories, designer brands, and style tips',
    ideaHints: '5 Ankara styles trending right now',
    duration_hint: 30, scene_count_hint: 5,
  },
  {
    id: 'comedy',
    icon: '😂', label: 'Comedy / Entertainment',
    niche: 'Comedy', style: 'Storytelling', platform: 'TikTok',
    tone: 'Humorous', audience: 'General Nigerian audience all ages',
    objective: 'awareness',
    context: 'Nigerian comedy, relatable skits, and entertainment content',
    ideaHints: 'Things every Nigerian parent says',
    duration_hint: 30, scene_count_hint: 5,
  },
  {
    id: 'travel',
    icon: '✈️', label: 'Travel & Lifestyle',
    niche: 'Travel', style: 'Documentary', platform: 'YouTube Shorts',
    tone: 'Conversational', audience: 'Nigerian travel enthusiasts aged 25-45',
    objective: 'story',
    context: 'Travel content — destinations in Nigeria and abroad, budget travel tips, visa guides',
    ideaHints: 'Hidden gems in Lagos you need to visit',
    duration_hint: 60, scene_count_hint: 8,
  },
]

export default function Setup() {
  const [niches, setNiches]         = useState<Niche[]>([])
  const [nicheMap, setNicheMap]     = useState<Record<string, string[]>>({})
  const [kitLoaded, setKitLoaded]   = useState(false)
  const [brandKit, setBrandKit]     = useState<any>(null)

  const config           = useStore((s) => s.config)
  const setConfig        = useStore((s) => s.setConfig)
  const setStep          = useStore((s) => s.setStep)
  const markStepComplete = useStore((s) => s.markStepComplete)
  const agencyProjectId  = useStore((s: any) => s.agencyProjectId)
  const currentStep      = useStore((s) => s.currentStep)
  const currentUser      = useAuthStore((s: any) => s.user)
  // Agency mode = actively working on an agency project (not just being a member)
  const isAgencyMode     = !!agencyProjectId || currentStep === 'agency-workflow'

  const [ideaInput, setIdeaInput]     = useState(config.ideaHints || '')
  const [ideaTags, setIdeaTags]       = useState<string[]>(config.ideaTags || [])
  const [objective, setObjective]         = useState<string>(config.objective || '')
  const [customObjective, setCustomObjective] = useState<string>(
    config.objective && !OBJECTIVES.find(o => o.key === config.objective)
      ? config.objective : ''
  )
  const [duration, setDuration]           = useState<number>(config.duration_hint || 60)
  const [sceneCount, setSceneCount]   = useState<number>(config.scene_count_hint || 8)
  const [clientBrief, setClientBrief] = useState<string>(config.client_brief || '')
  const [customDuration, setCustomDuration] = useState<string>('')
  const [showTemplates, setShowTemplates] = useState(false)


  function applyTemplate(t: typeof NICHE_TEMPLATES[0]) {
    // Find the best matching niche key from whatever the admin has loaded
    // Uses case-insensitive match on key or label so template niches
    // work regardless of how the admin capitalised them
    const matched = niches.find(n =>
      n.key.toLowerCase()   === t.niche.toLowerCase() ||
      n.label?.toLowerCase() === t.niche.toLowerCase()
    )
    const nicheKey = matched?.key ?? t.niche  // fallback to raw value if no match yet

    setConfig({
      niche:            nicheKey,
      style:            t.style,
      platform:         t.platform,
      tone:             t.tone,
      audience:         t.audience,
      objective:        t.objective,
      context:          t.context,
      ideaHints:        t.ideaHints,
      ideaTags:         [],
      duration_hint:    t.duration_hint,
      scene_count_hint: t.scene_count_hint,
    })
    setObjective(t.objective)
    setDuration(t.duration_hint)
    setSceneCount(t.scene_count_hint)
    setIdeaInput(t.ideaHints)
    setIdeaTags([])
    setShowTemplates(false)
  }

  useEffect(() => {
    getNiches().then((data) => {
      setNiches(data)
      const map: Record<string, string[]> = {}
      data.forEach((n) => { map[n.key] = n.suggestions })
      setNicheMap(map)

      // Guard: clear niche if personal mode has an agency-only industry key (old lowercase keys)
      const agencyOnlyKeys = ['fmcg','healthcare','automotive','hospitality','nonprofit']
      if (!isAgencyMode && agencyOnlyKeys.includes(config.niche.toLowerCase())) {
        setConfig({ niche: '' })
      }
    }).catch(() => {})
  }, [isAgencyMode])

  // Auto-load brand kit when in agency mode
  useEffect(() => {
    if (!agencyProjectId || kitLoaded) return
    api.get(`/api/agency/projects/${agencyProjectId}`)
      .then(async r => {
        const proj = r.data.project
        setKitLoaded(true)
        if (!proj?.brand_kit_id) return
        const kitRes = await api.get(`/api/agency/brand-kits/${proj.brand_kit_id}`)
        const kit = kitRes.data.kit
        setBrandKit(kit)
        // Pre-fill fields from kit (only if not already set)
        const updates: Record<string, any> = {}
        if (kit.ai_tone && !config.tone)         updates.tone     = kit.ai_tone
        if (kit.client_name && !config.audience) updates.audience = kit.client_name + "'s audience"
        if (proj.platform && !config.platform)   updates.platform = proj.platform
        if (proj.notes && !clientBrief)          setClientBrief(proj.notes)
        if (Object.keys(updates).length)         setConfig(updates)
      })
      .catch(() => { setKitLoaded(true) })
  }, [agencyProjectId])

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
      e.preventDefault(); addTag(ideaInput)
    }
    if (e.key === 'Backspace' && !ideaInput && ideaTags.length > 0) {
      removeTag(ideaTags[ideaTags.length - 1])
    }
  }

  function selectDuration(val: number) {
    setDuration(val)
    const d = DURATIONS.find(d => d.value === val)
    if (d && d.value > 0) setSceneCount(d.scenes)
    setConfig({ duration_hint: val, scene_count_hint: d?.scenes ?? sceneCount })
  }

  const canContinue = !!(config.niche && config.style)

  function handleContinue() {
    setConfig({
      ideaHints: ideaInput, ideaTags,
      objective: objective === 'custom' ? customObjective : objective,
      duration_hint: duration,
      scene_count_hint: sceneCount,
      client_brief: clientBrief,
    })
    markStepComplete('setup')
    setStep('ideas')
  }

  const INP = "w-full bg-white/[0.05] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition"

  return (
    <div>
      <PageHeader
        title={isAgencyMode ? "Project setup" : "New project"}
        subtitle={isAgencyMode
          ? "Configure the brief — SceneForge will generate scripts and scenes from here"
          : "Configure your content — SceneForge will generate everything from here"}
      />


      {/* ── Quick-start templates (personal mode only) ── */}
      {!isAgencyMode && (
        <div className="mb-5">
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="flex items-center gap-2 text-[12px] font-semibold text-violet-300 hover:text-violet-200 transition-colors group"
          >
            <span className="w-5 h-5 rounded-full bg-violet-500/15 flex items-center justify-center group-hover:bg-violet-500/25 transition-colors">
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8">
                {showTemplates
                  ? <path d="M2 7l3-3 3 3"/>
                  : <path d="M2 3l3 3 3-3"/>
                }
              </svg>
            </span>
            {showTemplates ? 'Hide templates' : '⚡ Quick-start with a template'}
          </button>

          {showTemplates && (
            <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
              {NICHE_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => applyTemplate(t)}
                  className="flex items-center gap-2.5 px-3 py-2.5 bg-[#111118] border border-white/[0.07] rounded-xl hover:border-violet-500/30 hover:bg-violet-500/[0.06] transition-all text-left group"
                >
                  <span className="text-xl flex-shrink-0">{t.icon}</span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-white/75 group-hover:text-white/90 truncate">{t.label}</p>
                    <p className="text-[10px] text-white/30 truncate">{t.platform}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Brand kit banner — shown when kit auto-loaded */}
      {brandKit && (
        <div className="mb-4 bg-amber-400/[0.07] border border-amber-400/20 rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-400/15 flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#c9a84c" strokeWidth="1.5"><rect x="1" y="1" width="12" height="12" rx="2"/><path d="M4 7h6M7 4v6"/></svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-amber-300">Brand kit applied — {brandKit.client_name}</div>
            <div className="text-[11px] text-white/35 mt-0.5">Tone, audience and platform pre-filled from kit</div>
          </div>
          <button onClick={() => setBrandKit(null)} className="text-white/25 hover:text-white/50 transition text-lg leading-none">×</button>
        </div>
      )}

      {/* ── Video objective ── */}
      {isAgencyMode && (
        <Card className="mb-4">
          <CardTitle>Campaign objective <span className="text-white/30 normal-case font-normal text-xs">(optional)</span></CardTitle>
          <div className="flex flex-wrap gap-2">
            {OBJECTIVES.map(o => (
              <button key={o.key}
                onClick={() => setObjective(objective === o.key ? '' : o.key)}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition \${
                  objective === o.key
                    ? 'bg-amber-400/15 border-amber-400/30 text-amber-300'
                    : 'bg-white/[0.04] border-white/[0.1] text-white/50 hover:border-white/[0.2] hover:text-white/80'
                }`}>
                <span>{o.icon}</span>{o.label}
              </button>
            ))}
          </div>
          {/* Free-text custom objective */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setObjective(objective === 'custom' ? '' : 'custom')}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition ${
                objective === 'custom'
                  ? 'bg-amber-400/15 border-amber-400/30 text-amber-300'
                  : 'bg-white/[0.04] border-white/[0.1] text-white/50 hover:border-white/[0.2] hover:text-white/80'
              }`}>
              ✎ Other
            </button>
            {objective === 'custom' && (
              <input
                type="text"
                value={customObjective}
                onChange={e => setCustomObjective(e.target.value)}
                placeholder="Describe your campaign goal…"
                autoFocus
                className="flex-1 min-w-[200px] bg-white/[0.05] border border-white/[0.1] rounded-xl px-3 py-1.5 text-white text-sm outline-none focus:border-amber-400/50 placeholder:text-white/20 transition"
              />
            )}
          </div>
        </Card>
      )}

      {/* ── Content niche / Industry ── */}
      <Card className="mb-4">
        <CardTitle>{isAgencyMode ? 'Client industry' : 'Content niche'}</CardTitle>
        {isAgencyMode ? (
          <div className="flex flex-wrap gap-2">
            {AGENCY_INDUSTRIES.map(ind => (
              <Chip key={ind.key} label={ind.label}
                selected={config.niche === ind.key}
                onClick={() => { setConfig({ niche: ind.key }); setIdeaTags([]); setConfig({ ideaTags: [] }) }}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {niches.map((n) => (
              <Chip key={n.label} label={n.label}
                selected={config.niche === n.key}
                onClick={() => { setConfig({ niche: n.key }); setIdeaTags([]); setConfig({ ideaTags: [] }) }}
              />
            ))}
          </div>
        )}
      </Card>

      {/* ── Topic ideas ── */}
      <Card className="mb-4">
        <CardTitle>Topic ideas &amp; hints <span className="text-violet-400 normal-case font-normal">(optional)</span></CardTitle>
        <div
          className="flex flex-wrap gap-2 min-h-[40px] bg-[#1A1A24] border border-white/12 rounded-lg px-3 py-2 mb-3 cursor-text"
          onClick={() => document.getElementById('idea-input')?.focus()}
        >
          {ideaTags.map((tag) => (
            <span key={tag} className="flex items-center gap-1.5 bg-violet-500/20 text-violet-300 text-[12px] font-medium px-2.5 py-1 rounded-full">
              {tag}
              <button onClick={(e) => { e.stopPropagation(); removeTag(tag) }}
                className="text-violet-400/60 hover:text-violet-300 text-[11px] leading-none">x</button>
            </span>
          ))}
          <input id="idea-input" type="text" value={ideaInput}
            onChange={(e) => setIdeaInput(e.target.value)}
            onKeyDown={handleIdeaKeyDown}
            onBlur={() => { if (ideaInput.trim()) addTag(ideaInput) }}
            placeholder={ideaTags.length === 0 ? 'Type a topic or key message, then press Enter...' : 'Add another...'}
            className="flex-1 min-w-[180px] bg-transparent outline-none text-[13px] text-white/80 placeholder-white/25"
          />
        </div>
        {suggestions.length > 0 && (
          <div>
            <p className="text-[11px] text-white/35 mb-2">Quick add:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => addTag(s)} disabled={ideaTags.includes(s)}
                  className={`text-[11.5px] px-3 py-1 rounded-full border transition-all \${
                    ideaTags.includes(s)
                      ? 'border-violet-500/30 bg-violet-500/10 text-violet-400/50 cursor-default'
                      : 'border-white/10 bg-white/3 text-white/45 hover:border-violet-400/40 hover:text-violet-300 hover:bg-violet-500/10'
                  }`}>+ {s}</button>
              ))}
            </div>
          </div>
        )}
        <p className="text-[11px] text-white/30 mt-3">
          Add key messages or topic ideas. Leave blank for fully AI-generated ideas.
        </p>
      </Card>

      {/* ── Video style ── */}
      <Card className="mb-4">
        <CardTitle>Video style</CardTitle>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((s) => (
            <Chip key={s} label={s} selected={config.style === s} onClick={() => setConfig({ style: s })} />
          ))}
        </div>
      </Card>

      {/* ── Duration & scene count ── */}
      <Card className="mb-4">
        <CardTitle>Duration &amp; scenes</CardTitle>
        <div className="flex flex-wrap gap-2 mb-4">
          {DURATIONS.map(d => (
            <button key={d.value}
              onClick={() => selectDuration(d.value)}
              className={`text-sm font-semibold px-4 py-2 rounded-xl border transition \${
                duration === d.value
                  ? 'bg-amber-400/15 border-amber-400/30 text-amber-300'
                  : 'bg-white/[0.04] border-white/[0.1] text-white/50 hover:border-white/[0.2] hover:text-white/80'
              }`}>
              {d.label}
              {d.value > 0 && <span className="text-[10px] font-normal ml-1 opacity-60">~{d.scenes} scenes</span>}
            </button>
          ))}
        </div>
        {duration === 0 && (
          <div className="flex items-center gap-3 mb-3">
            <input type="number" min="10" max="600" value={customDuration}
              onChange={e => setCustomDuration(e.target.value)}
              placeholder="Duration in seconds"
              className={INP + " w-48"} />
            <input type="number" min="2" max="20" value={sceneCount}
              onChange={e => { const v = parseInt(e.target.value); setSceneCount(v); setConfig({ scene_count_hint: v }) }}
              placeholder="Scene count"
              className={INP + " w-36"} />
          </div>
        )}
        {duration > 0 && (
          <div className="flex items-center gap-3">
            <div className="text-xs text-white/40">Scene count:</div>
            <div className="flex gap-1.5">
              {[3,4,5,6,7,8,9,10,12].map(n => (
                <button key={n} onClick={() => { setSceneCount(n); setConfig({ scene_count_hint: n }) }}
                  className={`w-8 h-8 rounded-lg text-xs font-semibold border transition \${
                    sceneCount === n
                      ? 'bg-violet-500/20 border-violet-400/30 text-violet-300'
                      : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:border-white/20 hover:text-white/70'
                  }`}>{n}</button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ── Platform & details ── */}
      <Card className="mb-4">
        <CardTitle>Platform and details</CardTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Target platform" value={config.platform} onChange={(v) => setConfig({ platform: v })} options={PLATFORMS} />
          {config.platform && PLATFORM_HINTS[config.platform] && (
            <p className="text-[11px] text-white/30 -mt-2 ml-1">{PLATFORM_HINTS[config.platform]}</p>
          )}
          <Select label="Tone" value={config.tone} onChange={(v) => setConfig({ tone: v })} options={TONES} />
          <TextInput label="Target audience" value={config.audience} onChange={(v) => setConfig({ audience: v })} placeholder="e.g. decision-makers aged 30-50, B2B SaaS" />
          <TextInput label="Extra context (optional)" value={config.context} onChange={(v) => setConfig({ context: v })} placeholder="Any specific angle or topic focus..." />
        </div>
      </Card>

      {/* ── Client brief ── */}
      {isAgencyMode && (
        <Card className="mb-6">
          <CardTitle>Client brief <span className="text-white/30 normal-case font-normal text-xs">(optional)</span></CardTitle>
          <textarea
            rows={5}
            value={clientBrief}
            onChange={e => setClientBrief(e.target.value)}
            placeholder={`Paste the full client brief here — product details, key messages, target customer, dos & don'ts, references, campaign context...\n\nThe AI will follow these instructions when writing the script.`}
            className={INP + " resize-none"}
          />
          <p className="text-[11px] text-white/25 mt-2 leading-relaxed">
            This is sent directly to the AI alongside your other settings. The more detail, the more on-brief the output.
          </p>
        </Card>
      )}

      {!isAgencyMode && (
        <Card className="mb-6">
          <CardTitle>Extra context <span className="text-white/30 normal-case font-normal text-xs">(optional)</span></CardTitle>
          <textarea rows={3} value={clientBrief} onChange={e => setClientBrief(e.target.value)}
            placeholder="Any specific angle, references or instructions for the AI..."
            className={INP + " resize-none"} />
        </Card>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <Button variant="primary" onClick={handleContinue} disabled={!canContinue}>
          Generate ideas
        </Button>
        <Button variant="ghost" onClick={() => { markStepComplete('setup'); setStep('upload') }}>
          Upload my own script and voice
        </Button>
      </div>
    </div>
  )
}
