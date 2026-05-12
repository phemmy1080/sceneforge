import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'

interface ShareData {
  caption: string
  hashtags: string[]
  tip: string
  times: { label: string; value: string; note: string }[]
}

const PLATFORM_META: Record<string, {
  label: string
  icon: string
  color: string
  uploadUrl: string
  format: string
}> = {
  tiktok:    { label: 'TikTok',         icon: '📱', color: '#rgba(105,201,208,0.15)', uploadUrl: 'https://www.tiktok.com/upload',        format: '9:16 · up to 3 min' },
  youtube:   { label: 'YouTube Shorts', icon: '▶️', color: 'rgba(195,43,43,0.1)',    uploadUrl: 'https://studio.youtube.com',           format: '9:16 · under 60s'   },
  instagram: { label: 'Instagram Reels',icon: '📸', color: 'rgba(193,53,132,0.1)',   uploadUrl: 'https://www.instagram.com',            format: 'Reels · 9:16'       },
  linkedin:  { label: 'LinkedIn',       icon: '💼', color: 'rgba(10,102,194,0.1)',   uploadUrl: 'https://www.linkedin.com/feed',        format: '1:1 or 9:16'        },
}

const DEFAULT_SHARE: Record<string, ShareData> = {
  tiktok: {
    caption: "Most people don't know this — but you can start investing with almost nothing.\n\nHere's how to build wealth from scratch 👇\n\nSave this. You'll need it. Follow for daily money tips that actually work.",
    hashtags: ['#investing','#moneytips','#wealthbuilding','#financetiktok','#moneyadvice','#personalfinance'],
    times: [
      { label: 'Today morning',  value: '7:00 – 9:00 AM',  note: 'High engagement window' },
      { label: 'This evening',   value: '7:00 – 9:00 PM',  note: 'Peak scroll time'        },
      { label: 'Best day',       value: 'Thursday',         note: 'Finance content peaks'   },
    ],
    tip: "Reply to every comment in the first hour — TikTok's algorithm heavily rewards early engagement velocity on new posts.",
  },
  youtube: {
    caption: "I started investing with almost nothing — here's exactly what I did.\n\n3 steps any beginner can follow right now. No experience needed.\n\nLike and subscribe for weekly wealth-building tips.",
    hashtags: ['#youtubeshorts','#investing','#personalfinance','#moneytips','#wealthbuilding','#shorts'],
    times: [
      { label: 'Today midday',   value: '12:00 – 2:00 PM', note: 'Lunch scroll peak'        },
      { label: 'This evening',   value: '6:00 – 8:00 PM',  note: 'After-work browsing'      },
      { label: 'Best day',       value: 'Wednesday',        note: 'Mid-week engagement high' },
    ],
    tip: "The first 100 characters of your YouTube description appear in search results. Lead with your strongest keyword.",
  },
  instagram: {
    caption: "You don't need a lot of money to start investing. Seriously. 💰\n\nI break down the 3 easiest moves for first-time investors.\n\nSave this post — you'll want to come back to it.\n.\n.\n.",
    hashtags: ['#investing','#moneymoves','#financetips','#reels','#wealthmindset','#personalfinance','#moneygoals'],
    times: [
      { label: 'Today morning',  value: '6:00 – 8:00 AM',  note: 'Morning routine window'   },
      { label: 'This evening',   value: '8:00 – 10:00 PM', note: 'Highest engagement hour'  },
      { label: 'Best day',       value: 'Tuesday',          note: 'Reels peak reach day'     },
    ],
    tip: "The dot-dot-dot trick (. . .) pushes hashtags below the fold so your caption looks cleaner. Instagram rewards saves over likes — end with a reason to save.",
  },
  linkedin: {
    caption: "Most people think you need serious capital to start investing.\n\nI started with almost nothing. Here's what I learned:\n\n→ Start small, stay consistent\n→ Index funds beat stock-picking for beginners  \n→ Automate your contributions\n\nWhat investing advice do you wish you'd gotten earlier?",
    hashtags: ['#investing','#personalfinance','#wealthbuilding','#financialwellness','#linkedinvideo'],
    times: [
      { label: 'Tuesday AM',     value: '8:00 – 10:00 AM', note: 'Peak professional hours'  },
      { label: 'Thursday PM',    value: '5:00 – 6:00 PM',  note: 'End of workday browsing'  },
      { label: 'Best day',       value: 'Tuesday',          note: 'Highest B2B engagement'   },
    ],
    tip: "LinkedIn video gets 3x more reach than text posts. End with a question — LinkedIn's algorithm heavily rewards comment engagement.",
  },
}

export default function SharePanel({ videoUrl, niche, platform, projectTitle, script }: {
  videoUrl: string
  niche?: string
  platform?: string
  projectTitle?: string
  script?: string
}) {
  const [activePlatform, setActivePlatform] = useState('tiktok')
  const [shareData, setShareData]           = useState<ShareData>(DEFAULT_SHARE.tiktok)
  const [loading, setLoading]               = useState(false)
  const [generated, setGenerated]           = useState(false)
  const [copiedCaption, setCopiedCaption]   = useState(false)
  const [copiedTags, setCopiedTags]         = useState(false)
  const [copiedAll, setCopiedAll]           = useState(false)

  // Auto-detect platform from config
  useEffect(() => {
    if (platform) {
      const p = platform.toLowerCase()
      if (p.includes('tiktok')) setActivePlatform('tiktok')
      else if (p.includes('youtube')) setActivePlatform('youtube')
      else if (p.includes('instagram')) setActivePlatform('instagram')
      else if (p.includes('linkedin')) setActivePlatform('linkedin')
    }
  }, [platform])

  useEffect(() => {
    setShareData(DEFAULT_SHARE[activePlatform] || DEFAULT_SHARE.tiktok)
    setGenerated(false)
  }, [activePlatform])

  async function generateCaption() {
    setLoading(true)
    try {
      const meta = PLATFORM_META[activePlatform]
      const prompt = `Generate a ${meta.label} caption and 7 hashtags for this video:\n\nTitle: ${projectTitle || 'Untitled'}\nNiche: ${niche || 'general'}\nPlatform: ${meta.label}\nScript preview: ${(script || '').slice(0, 200)}\n\nRespond ONLY with valid JSON: {"caption":"...","hashtags":["#tag1","#tag2"],"tip":"one posting tip"}`

      const { data } = await api.post('/api/chat/message', {
        messages: [{ role: 'user', content: prompt }],
        context: `Generating share content for ${meta.label}. Niche: ${niche}. Platform: ${platform}.`,
      })

      const text = data.reply || ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        setShareData(prev => ({
          ...prev,
          caption:  parsed.caption  || prev.caption,
          hashtags: parsed.hashtags || prev.hashtags,
          tip:      parsed.tip      || prev.tip,
        }))
        setGenerated(true)
      }
    } catch {
      // keep defaults
    } finally {
      setLoading(false)
    }
  }

  function copy(text: string, setter: (v: boolean) => void) {
    try { navigator.clipboard.writeText(text) } catch {}
    setter(true)
    setTimeout(() => setter(false), 2000)
  }

  const meta = PLATFORM_META[activePlatform]
  const allText = `${shareData.caption}\n\n${shareData.hashtags.join(' ')}`

  return (
    <div style={{ marginTop: 32 }}>
      {/* Section header */}
      <p className="text-[11px] text-white/35 uppercase tracking-widest font-semibold mb-3">Share your video</p>

      {/* Platform selector */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {Object.entries(PLATFORM_META).map(([key, m]) => (
          <button
            key={key}
            onClick={() => setActivePlatform(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 14px', borderRadius: 12,
              background: activePlatform === key ? 'rgba(124,92,255,0.12)' : 'rgba(255,255,255,0.04)',
              border: activePlatform === key ? '1px solid rgba(124,92,255,0.3)' : '1px solid rgba(255,255,255,0.08)',
              color: activePlatform === key ? '#C4B5FD' : 'rgba(255,255,255,0.5)',
              fontSize: 12.5, fontWeight: activePlatform === key ? 600 : 400,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: 15 }}>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>

        {/* Caption card */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Caption</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={generateCaption}
                disabled={loading}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', borderRadius: 8, background: 'rgba(124,92,255,0.15)', border: '1px solid rgba(124,92,255,0.25)', color: '#C4B5FD', cursor: 'pointer' }}
              >
                {loading ? '...' : generated ? '✓ Regenerate' : '✦ AI generate'}
              </button>
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '11px 13px', fontSize: 12.5, color: 'rgba(255,255,255,0.75)', lineHeight: 1.65, marginBottom: 10, whiteSpace: 'pre-wrap', minHeight: 100 }}>
            {shareData.caption}
          </div>

          <button
            onClick={() => copy(shareData.caption, setCopiedCaption)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px', borderRadius: 9, background: copiedCaption ? 'rgba(45,212,191,0.12)' : 'rgba(255,255,255,0.05)', border: `1px solid ${copiedCaption ? 'rgba(45,212,191,0.25)' : 'rgba(255,255,255,0.1)'}`, color: copiedCaption ? '#2DD4BF' : 'rgba(255,255,255,0.5)', fontSize: 12, cursor: 'pointer', transition: 'all 0.2s' }}
          >
            {copiedCaption ? '✓ Copied!' : '⎘ Copy caption'}
          </button>
        </div>

        {/* Hashtags + timing card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Hashtags */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Hashtags</span>
              <button
                onClick={() => copy(shareData.hashtags.join(' '), setCopiedTags)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: 7, background: copiedTags ? 'rgba(45,212,191,0.12)' : 'rgba(255,255,255,0.06)', border: `1px solid ${copiedTags ? 'rgba(45,212,191,0.25)' : 'rgba(255,255,255,0.1)'}`, color: copiedTags ? '#2DD4BF' : 'rgba(255,255,255,0.5)', cursor: 'pointer' }}
              >
                {copiedTags ? '✓ Copied' : '⎘ Copy all'}
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {shareData.hashtags.map(tag => (
                <span key={tag} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 100, background: 'rgba(124,92,255,0.1)', border: '1px solid rgba(124,92,255,0.2)', color: '#C4B5FD' }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Best times */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '14px 16px' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', display: 'block', marginBottom: 10 }}>Best time to post</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {shareData.times.map(t => (
                <div key={t.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>{t.label}</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{t.value}</div>
                    <div style={{ fontSize: 10.5, color: '#2DD4BF' }}>{t.note}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tip */}
          <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 12, padding: '10px 13px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>💡</span>
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)', lineHeight: 1.55 }}>{shareData.tip}</span>
          </div>
        </div>
      </div>

      {/* Upload buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <a
          href={meta.uploadUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 12, background: 'rgba(124,92,255,0.15)', border: '1px solid rgba(124,92,255,0.3)', color: '#C4B5FD', fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}
        >
          <span>{meta.icon}</span>
          Open {meta.label} upload ↗
        </a>
        <button
          onClick={() => copy(allText, setCopiedAll)}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 12, background: copiedAll ? 'rgba(45,212,191,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${copiedAll ? 'rgba(45,212,191,0.25)' : 'rgba(255,255,255,0.1)'}`, color: copiedAll ? '#2DD4BF' : 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer', transition: 'all 0.2s' }}
        >
          {copiedAll ? '✓ All copied!' : '⎘ Copy caption + tags'}
        </button>
      </div>
    </div>
  )
}
