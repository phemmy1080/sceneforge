import { useEffect } from 'react'

export const AUTHORS: Record<string, {
  name: string
  role: string
  bio: string
  avatar: string
  initials: string
  color: string
  twitter?: string
  posts: string[]
}> = {
  'daniel-osei': {
    name: 'Daniel Osei',
    role: 'Head of Content & AI Strategy',
    bio: 'Daniel has spent 6 years at the intersection of content creation and AI technology. He advises creators across Africa and writes about the future of AI-powered media production.',
    avatar: '',
    initials: 'DO',
    color: '#7C5CFF',
    twitter: 'danielosei',
    posts: ['ai-video-creation-future-2026', 'how-to-create-viral-tiktok-videos-with-ai', 'ai-video-tools-comparison-2026'],
  },
  'amara-diallo': {
    name: 'Amara Diallo',
    role: 'Content Strategy Lead',
    bio: 'Amara helps creators build sustainable audiences through data-driven content strategies. She specialises in short-form video growth on TikTok, YouTube Shorts, and Instagram Reels.',
    avatar: '',
    initials: 'AD',
    color: '#2DD4BF',
    twitter: 'amaradiallo',
    posts: ['tiktok-content-strategy-guide-2026', 'best-niches-for-content-creators-2026', 'youtube-shorts-algorithm-guide', 'content-creator-monetisation-guide'],
  },
  'sceneforge-team': {
    name: 'SceneForge Team',
    role: 'Editorial Team',
    bio: 'Tips, guides, and strategies from the SceneForge team — built to help content creators grow faster with AI.',
    avatar: '',
    initials: 'SF',
    color: '#F59E0B',
    posts: ['how-to-make-money-as-content-creator-with-ai'],
  },
}

const ALL_POSTS_META: Record<string, { title: string; date: string; category: string; readTime: number }> = {
  'how-to-create-viral-tiktok-videos-with-ai':     { title: 'How to Create Viral TikTok Videos with AI in Under 60 Seconds', date: '2026-05-01', category: 'tutorials', readTime: 6 },
  'best-niches-for-content-creators-2026':          { title: 'The 7 Best Content Niches for Creators in 2026', date: '2026-05-05', category: 'strategy', readTime: 8 },
  'ai-video-tools-comparison-2026':                 { title: 'AI Video Creation Tools Compared: Which One is Right for You?', date: '2026-05-08', category: 'strategy', readTime: 7 },
  'youtube-shorts-algorithm-guide':                 { title: 'The YouTube Shorts Algorithm in 2026: What Actually Drives Views', date: '2026-05-12', category: 'strategy', readTime: 7 },
  'content-creator-monetisation-guide':             { title: 'How Content Creators Monetise: 7 Revenue Streams That Work', date: '2026-05-15', category: 'strategy', readTime: 9 },
  'how-to-make-money-as-content-creator-with-ai':   { title: 'How to Make Money as a Content Creator Using AI Video Tools', date: '2026-01-05', category: 'strategy', readTime: 10 },
  'ai-video-creation-future-2026':                  { title: 'The Future of AI Video Creation in 2026', date: '2026-01-08', category: 'tutorials', readTime: 8 },
  'tiktok-content-strategy-guide-2026':             { title: 'The Complete TikTok Content Strategy Guide for 2026', date: '2026-01-15', category: 'strategy', readTime: 9 },
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function AuthorPage({ authorSlug }: { authorSlug: string }) {
  const author = AUTHORS[authorSlug]

  useEffect(() => {
    if (!author) return
    document.title = `${author.name} — SceneForge Blog`
  }, [author])

  if (!author) {
    return (
      <div style={{ minHeight: '100vh', background: '#07070E', color: '#F0F0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 48 }}>404</div>
        <div style={{ color: 'rgba(255,255,255,0.5)' }}>Author not found</div>
        <a href="/blog" style={{ color: '#A78BFA', fontSize: 14 }}>← Back to blog</a>
      </div>
    )
  }

  const authorPosts = author.posts.map(slug => ({ slug, ...ALL_POSTS_META[slug] })).filter(p => p.title)

  return (
    <div style={{ minHeight: '100vh', background: '#07070E', color: '#F0F0FF' }}>
      <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 clamp(16px,5vw,64px)', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'rgba(7,7,14,0.95)', backdropFilter: 'blur(16px)', zIndex: 100 }}>
        <a href="/" style={{ fontFamily: 'Syne, system-ui, sans-serif', fontSize: 18, fontWeight: 800, color: '#F0F0FF', textDecoration: 'none' }}>Scene<span style={{ color: '#A78BFA' }}>Forge</span></a>
        <a href="/blog" style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>← Blog</a>
      </nav>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(32px,5vw,64px) clamp(16px,4vw,32px)' }}>

        {/* Author card */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 'clamp(20px,4vw,36px)', marginBottom: 40, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Avatar */}
          <div style={{
            width: 80, height: 80, borderRadius: '50%', flexShrink: 0,
            background: `linear-gradient(135deg, ${author.color}40, ${author.color}20)`,
            border: `2px solid ${author.color}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, fontWeight: 700, color: author.color,
            fontFamily: 'Syne, system-ui, sans-serif',
          }}>
            {author.initials}
          </div>

          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4, fontFamily: 'Syne, system-ui, sans-serif' }}>{author.name}</div>
            <div style={{ fontSize: 13, color: author.color, fontWeight: 600, marginBottom: 12 }}>{author.role} · SceneForge</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.65, marginBottom: 14 }}>{author.bio}</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: 100 }}>
                {authorPosts.length} article{authorPosts.length !== 1 ? 's' : ''}
              </span>
              {author.twitter && (
                <span style={{ fontSize: 12, color: '#A78BFA', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', padding: '4px 12px', borderRadius: 100 }}>
                  @{author.twitter}
                </span>
              )}
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>SceneForge · {new Date().getFullYear()}</span>
            </div>
          </div>
        </div>

        {/* Posts */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>
          Articles by {author.name.split(' ')[0]}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {authorPosts.map(post => (
            <a
              key={post.slug}
              href={`/blog/${post.slug}`}
              onClick={e => { e.preventDefault(); window.history.pushState({}, '', `/blog/${post.slug}`); window.scrollTo({ top: 0, behavior: 'instant' }) }}
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '16px 20px', textDecoration: 'none', display: 'flex', gap: 16, alignItems: 'center', transition: 'border-color .15s' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(167,139,250,0.3)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)')}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#F0F0FF', marginBottom: 5, lineHeight: 1.35 }}>{post.title}</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{formatDate(post.date)}</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>·</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{post.readTime} min read</span>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 100, background: 'rgba(167,139,250,0.1)', color: '#A78BFA', textTransform: 'capitalize' }}>{post.category}</span>
                </div>
              </div>
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.2)' }}>→</span>
            </a>
          ))}
        </div>
      </main>

      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '32px clamp(16px,5vw,64px)', marginTop: 60, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontFamily: 'Syne, system-ui, sans-serif', fontWeight: 800, fontSize: 15 }}>Scene<span style={{ color: '#A78BFA' }}>Forge</span></span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>AI Video Studio · sceneraforge.com · © {new Date().getFullYear()}</span>
      </footer>
    </div>
  )
}
