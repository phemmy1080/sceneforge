import { useState, useEffect } from 'react'
import BlogThumbnail from '../components/BlogThumbnail'

interface Post {
  slug: string
  title: string
  description: string
  date: string
  category: string
  tags: string[]
  readTime: number
  content: string
}

const POSTS_META: Omit<Post, 'content'>[] = [
  {
    slug: 'how-to-create-viral-tiktok-videos-with-ai',
    title: 'How to Create Viral TikTok Videos with AI in Under 60 Seconds',
    description: 'Learn how AI video tools help content creators produce scroll-stopping TikToks without a camera, editing skills, or hours of work.',
    date: '2026-05-01',
    category: 'tutorials',
    tags: ['tiktok', 'ai video', 'content creation', 'viral'],
    readTime: 6,
  },
  {
    slug: 'best-niches-for-content-creators-2026',
    title: 'The 7 Best Content Niches for Creators in 2026',
    description: 'The most profitable and fastest-growing content niches for TikTok, YouTube Shorts, and Instagram Reels — with specific video ideas for each.',
    date: '2026-05-05',
    category: 'strategy',
    tags: ['content strategy', 'niches', 'youtube shorts', 'instagram reels'],
    readTime: 8,
  },
  {
    slug: 'ai-video-tools-comparison-2026',
    title: 'AI Video Creation Tools Compared: Which One is Right for You in 2026?',
    description: 'An honest comparison of the top AI video creation tools in 2026 — features, pricing, and which works best for short-form content creators.',
    date: '2026-05-08',
    category: 'strategy',
    tags: ['ai tools', 'comparison', 'video creation', 'review'],
    readTime: 7,
  },
  {
    slug: 'youtube-shorts-algorithm-guide',
    title: 'The YouTube Shorts Algorithm in 2026: What Actually Drives Views',
    description: 'A practical guide to the YouTube Shorts algorithm — what signals matter, what to optimise, and how to get recommended to new viewers.',
    date: '2026-05-12',
    category: 'strategy',
    tags: ['youtube shorts', 'algorithm', 'views', 'growth'],
    readTime: 7,
  },
  {
    slug: 'content-creator-monetisation-guide',
    title: 'How Content Creators Monetise in 2026: 7 Revenue Streams That Work',
    description: 'A practical guide to the revenue streams that actually work for content creators — platform income, digital products, affiliate marketing, and more.',
    date: '2026-05-15',
    category: 'strategy',
    tags: ['monetisation', 'content creator', 'income', 'digital products'],
    readTime: 9,
  },
  {
    slug: 'how-to-make-money-as-content-creator-with-ai',
    title: 'How to Make Money as a Content Creator Using AI Video Tools in 2026',
    description: 'A complete guide to monetising your content creator journey using AI video tools — from your first video to your first $1,000 month. No camera required.',
    date: '2026-01-05',
    category: 'strategy',
    tags: ['monetisation', 'ai video', 'content creator', 'make money online', 'tiktok'],
    readTime: 10,
    author: 'sceneforge-team',
  },
  {
    slug: 'ai-video-creation-future-2026',
    title: 'The Future of AI Video Creation in 2026: What Every Creator Needs to Know',
    description: 'AI video generation has changed everything for content creators in 2026. Here is what is working right now, what is coming next, and how to stay ahead.',
    date: '2026-01-08',
    category: 'tutorials',
    tags: ['ai video', 'content creation', '2026', 'future', 'technology'],
    readTime: 8,
    author: 'daniel-osei',
  },
  {
    slug: 'tiktok-content-strategy-guide-2026',
    title: 'The Complete TikTok Content Strategy Guide for 2026',
    description: 'Everything you need to build a TikTok audience in 2026 — algorithm changes, content formats, posting strategy, and how AI accelerates growth.',
    date: '2026-01-15',
    category: 'strategy',
    tags: ['tiktok', 'content strategy', 'social media', '2026', 'algorithm'],
    readTime: 9,
    author: 'amara-diallo',
  },
]

const CATEGORIES = ['all', 'tutorials', 'strategy']

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function CategoryBadge({ cat }: { cat: string }) {
  const colors: Record<string, string> = {
    tutorials: 'bg-violet-500/15 text-violet-300 border-violet-500/20',
    strategy:  'bg-teal-500/15 text-teal-300 border-teal-500/20',
  }
  return (
    <span className={`text-[10.5px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${colors[cat] || 'bg-white/8 text-white/50 border-white/10'}`}>
      {cat}
    </span>
  )
}

export default function Blog() {
  const [search, setSearch]     = useState('')
  const [category, setCategory] = useState('all')

  const filtered = POSTS_META.filter(p => {
    const matchesCat = category === 'all' || p.category === category
    const q = search.toLowerCase()
    const matchesSearch = !q || p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.tags.some(t => t.includes(q))
    return matchesCat && matchesSearch
  })

  // Update document title and meta
  useEffect(() => {
    document.title = 'Blog — SceneForge | AI Video Creation Tips & Strategies'
    let meta = document.querySelector('meta[name="description"]')
    if (!meta) { meta = document.createElement('meta'); (meta as HTMLMetaElement).name = 'description'; document.head.appendChild(meta) }
    meta.setAttribute('content', 'AI video creation tips, content strategy guides, and creator growth resources from the SceneForge team.')
  }, [])

  function openPost(slug: string) {
    window.history.pushState({}, '', `/blog/${slug}`)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#07070E', color: '#F0F0FF' }}>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 clamp(16px,5vw,64px)', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'rgba(7,7,14,0.95)', backdropFilter: 'blur(16px)', zIndex: 100 }}>
        <a href="/" style={{ fontFamily: 'Syne, system-ui, sans-serif', fontSize: 18, fontWeight: 800, color: '#F0F0FF', textDecoration: 'none', letterSpacing: '-0.5px' }}>
          Scene<span style={{ color: '#A78BFA' }}>Forge</span>
        </a>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="/blog" style={{ fontSize: 13, color: '#A78BFA', fontWeight: 600, textDecoration: 'none' }}>Blog</a>
          <a href="/" style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>← Back to app</a>
        </div>
      </nav>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: 'clamp(32px,5vw,64px) clamp(16px,4vw,32px)' }}>

        {/* Header */}
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#A78BFA', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 100, padding: '4px 14px', marginBottom: 16 }}>
            SceneForge Blog
          </div>
          <h1 style={{ fontFamily: 'Syne, system-ui, sans-serif', fontSize: 'clamp(28px,5vw,48px)', fontWeight: 800, letterSpacing: '-1px', margin: '0 0 14px' }}>
            Creator resources &amp; AI video guides
          </h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', maxWidth: 540, margin: '0 auto' }}>
            Tips, strategies, and tutorials for content creators who want to grow faster with AI.
          </p>
        </div>

        {/* Search + filter */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 32, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search posts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#F0F0FF', fontSize: 13, outline: 'none' }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            {CATEGORIES.map(c => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${category === c ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.1)'}`, background: category === c ? 'rgba(167,139,250,0.12)' : 'transparent', color: category === c ? '#C4B5FD' : 'rgba(255,255,255,0.5)', fontSize: 12.5, cursor: 'pointer', fontWeight: category === c ? 600 : 400, textTransform: 'capitalize' }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Post grid */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.3)' }}>No posts found for "{search}"</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
            {filtered.map((post, i) => (
              <article
                key={post.slug}
                onClick={() => openPost(post.slug)}
                style={{ background: i === 0 && category === 'all' && !search ? 'rgba(167,139,250,0.05)' : 'rgba(255,255,255,0.02)', border: `1px solid ${i === 0 && category === 'all' && !search ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 16, padding: 22, cursor: 'pointer', transition: 'border-color .15s, background .15s', gridColumn: i === 0 && category === 'all' && !search ? '1 / -1' : 'auto' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(167,139,250,0.35)'; (e.currentTarget as HTMLElement).style.background = 'rgba(167,139,250,0.06)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = i === 0 && category === 'all' && !search ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLElement).style.background = i === 0 && category === 'all' && !search ? 'rgba(167,139,250,0.05)' : 'rgba(255,255,255,0.02)' }}
              >
                <BlogThumbnail slug={post.slug} title={post.title} category={post.category} size={i === 0 && category === 'all' && !search ? 'hero' : 'card'} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, marginTop: 14 }}>
                  <CategoryBadge cat={post.category} />
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{formatDate(post.date)}</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>{post.readTime} min read</span>
                </div>
                <h2 style={{ fontSize: i === 0 && category === 'all' && !search ? 22 : 16, fontWeight: 700, margin: '0 0 10px', lineHeight: 1.35, letterSpacing: '-0.3px' }}>{post.title}</h2>
                <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: '0 0 14px' }}>{post.description}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {post.tags.slice(0,3).map(tag => (
                    <span key={tag} style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 100 }}>#{tag}</span>
                  ))}
                  <span style={{ marginLeft: 'auto', fontSize: 12.5, color: '#A78BFA', fontWeight: 500 }}>Read more →</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '32px clamp(16px,5vw,64px)', marginTop: 80, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontFamily: 'Syne, system-ui, sans-serif', fontWeight: 800, fontSize: 15 }}>Scene<span style={{ color: '#A78BFA' }}>Forge</span></span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>AI Video Studio · <a href="https://sceneraforge.com" style={{ color: '#A78BFA', textDecoration: 'none' }}>sceneraforge.com</a></span>
      </footer>
    </div>
  )
}
