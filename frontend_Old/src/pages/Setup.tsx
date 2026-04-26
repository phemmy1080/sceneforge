import { useStore } from '../store'
import { Button, Card, CardTitle, Chip, Select, TextInput, PageHeader } from '../components/ui'

const NICHES = ['Finance', 'Fitness', 'Tech', 'Travel', 'Food', 'Business', 'Science', 'History', 'Mindset', 'Gaming', 'Fashion', 'Health']
const STYLES = ['Educational', 'Viral / Hook-first', 'Storytelling', 'Listicle', 'Documentary', 'Tutorial', 'Opinion / Hot take']
const PLATFORMS = ['TikTok (9:16, 60s)', 'YouTube Shorts (9:16, 60s)', 'Instagram Reels (9:16, 30s)', 'YouTube (16:9, 3–10 min)', 'LinkedIn (1:1, 60s)']
const TONES = ['Energetic & punchy', 'Calm & informative', 'Conversational', 'Professional', 'Humorous', 'Inspirational']

export default function Setup() {
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const setStep = useStore((s) => s.setStep)
  const markStepComplete = useStore((s) => s.markStepComplete)

  const canContinue = config.niche && config.style

  function handleContinue() {
    markStepComplete('setup')
    setStep('ideas')
  }

  return (
    <div>
      <PageHeader
        title="New project"
        subtitle="Configure your content — AI will generate everything from here"
      />

      <Card className="mb-4">
        <CardTitle>Content niche</CardTitle>
        <div className="flex flex-wrap gap-2">
          {NICHES.map((n) => (
            <Chip
              key={n}
              label={n}
              selected={config.niche === n}
              onClick={() => setConfig({ niche: n })}
            />
          ))}
        </div>
      </Card>

      <Card className="mb-4">
        <CardTitle>Video style</CardTitle>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((s) => (
            <Chip
              key={s}
              label={s}
              selected={config.style === s}
              onClick={() => setConfig({ style: s })}
            />
          ))}
        </div>
      </Card>

      <Card className="mb-6">
        <CardTitle>Platform & details</CardTitle>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Target platform"
            value={config.platform}
            onChange={(v) => setConfig({ platform: v })}
            options={PLATFORMS}
          />
          <Select
            label="Tone"
            value={config.tone}
            onChange={(v) => setConfig({ tone: v })}
            options={TONES}
          />
          <TextInput
            label="Target audience"
            value={config.audience}
            onChange={(v) => setConfig({ audience: v })}
            placeholder="e.g. beginner investors aged 20–35"
          />
          <TextInput
            label="Extra context (optional)"
            value={config.context}
            onChange={(v) => setConfig({ context: v })}
            placeholder="Any specific angle or topic focus…"
          />
        </div>
      </Card>

      <Button variant="primary" onClick={handleContinue} disabled={!canContinue}>
        Generate ideas →
      </Button>
    </div>
  )
}
