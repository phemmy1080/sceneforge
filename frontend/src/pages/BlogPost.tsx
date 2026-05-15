import { useEffect, useState } from 'react'
import BlogThumbnail from '../components/BlogThumbnail'
import { AUTHORS } from '../pages/AuthorPage'
import { STEP_IMAGES } from '../components/StepImages'

interface PostMeta {
  slug: string
  title: string
  description: string
  date: string
  category: string
  tags: string[]
  readTime: number
  author?: string
  hasStepImages?: boolean
}

const ALL_META: PostMeta[] = [
  { slug:'how-to-create-viral-tiktok-videos-with-ai', title:'How to Create Viral TikTok Videos with AI in Under 60 Seconds', description:'Learn how AI video tools help content creators produce scroll-stopping TikToks without a camera, editing skills, or hours of work.', date:'2026-05-01', category:'tutorials', tags:['tiktok','ai video','content creation','viral'], readTime:6 },
  { slug:'best-niches-for-content-creators-2026', title:'The 7 Best Content Niches for Creators in 2026', description:'The most profitable and fastest-growing content niches for TikTok, YouTube Shorts, and Instagram Reels — with specific video ideas for each.', date:'2026-05-05', category:'strategy', tags:['content strategy','niches','youtube shorts','instagram reels'], readTime:8 },
  { slug:'ai-video-tools-comparison-2026', title:'AI Video Creation Tools Compared: Which One is Right for You in 2026?', description:'An honest comparison of the top AI video creation tools in 2026 — features, pricing, and which works best for short-form content creators.', date:'2026-05-08', category:'strategy', tags:['ai tools','comparison','video creation','review'], readTime:7 },
  { slug:'youtube-shorts-algorithm-guide', title:'The YouTube Shorts Algorithm in 2026: What Actually Drives Views', description:'A practical guide to the YouTube Shorts algorithm — what signals matter, what to optimise, and how to get recommended to new viewers.', date:'2026-05-12', category:'strategy', tags:['youtube shorts','algorithm','views','growth'], readTime:7 },
  { slug:'content-creator-monetisation-guide', title:'How Content Creators Monetise in 2026: 7 Revenue Streams That Work', description:'A practical guide to the revenue streams that actually work for content creators — platform income, digital products, affiliate marketing, and more.', date:'2026-05-15', category:'strategy', tags:['monetisation','content creator','income','digital products'], readTime:9 },
  { slug:'how-to-make-money-as-content-creator-with-ai', title:'How to Make Money as a Content Creator Using AI Video Tools in 2026', description:'A complete guide to monetising your content creator journey using AI video tools.', date:'2026-01-05', category:'strategy', tags:['monetisation','ai video','content creator'], readTime:10, author:'sceneforge-team' },
  { slug:'how-to-create-a-video-with-sceneforge-step-by-step', title:'How to Create a Video with SceneForge: A Complete Step-by-Step Guide (2026)', description:'A complete visual walkthrough of SceneForge — every step shown with screenshots.', date:'2026-01-20', category:'tutorials', tags:['tutorial','how to','sceneforge','step by step'], readTime:12, author:'daniel-osei', hasStepImages:true },
  { slug:'ai-video-creation-future-2026', title:'The Future of AI Video Creation in 2026: What Every Creator Needs to Know', description:'AI video generation has changed everything for content creators in 2026.', date:'2026-01-08', category:'tutorials', tags:['ai video','content creation','2026'], readTime:8, author:'daniel-osei' },
  { slug:'tiktok-content-strategy-guide-2026', title:'The Complete TikTok Content Strategy Guide for 2026', description:'Everything you need to build a TikTok audience in 2026.', date:'2026-01-15', category:'strategy', tags:['tiktok','content strategy','2026'], readTime:9, author:'amara-diallo' },
]

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function renderMarkdown(md: string): string {
  return md
    .replace(/^# (.+)$/gm, '<h1 style="font-family:Syne,system-ui,sans-serif;font-size:clamp(24px,4vw,38px);font-weight:800;letter-spacing:-1px;margin:0 0 24px;line-height:1.2">$1</h1>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:22px;font-weight:700;margin:40px 0 14px;letter-spacing:-0.3px">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:18px;font-weight:600;margin:28px 0 10px;color:rgba(255,255,255,0.85)">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;font-weight:600">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#A78BFA;text-decoration:none;border-bottom:1px solid rgba(167,139,250,0.3)" target="_blank" rel="noopener">$1</a>')
    .replace(/^- (.+)$/gm, '<li style="margin-bottom:8px;padding-left:4px">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => `<ul style="margin:12px 0 20px;padding-left:22px;list-style:none">${match.replace(/<li/g,'<li style="margin-bottom:8px;padding-left:4px;position:relative"><span style="position:absolute;left:-16px;color:#A78BFA">•</span').replace(/<\/li>/g,'</li>')}</ul>`)
    .replace(/\n\n/g, '</p><p style="font-size:16px;line-height:1.8;color:rgba(255,255,255,0.72);margin:0 0 20px">')
    .replace(/^(?!<[hupola])/gm, '')
}

export default function BlogPost({ slug }: { slug: string }) {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const meta = ALL_META.find(p => p.slug === slug)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    if (!meta) return
    document.title = `${meta.title} — SceneForge Blog`
    // Set meta description
    let desc = document.querySelector('meta[name="description"]')
    if (!desc) { desc = document.createElement('meta'); (desc as HTMLMetaElement).name = 'description'; document.head.appendChild(desc) }
    desc.setAttribute('content', meta.description)
    // OG tags
    const og: Record<string, string> = {
      'og:title': meta.title,
      'og:description': meta.description,
      'og:type': 'article',
      'og:url': `https://sceneraforge.com/blog/${slug}`,
    }
    Object.entries(og).forEach(([property, content]) => {
      let el = document.querySelector(`meta[property="${property}"]`)
      if (!el) { el = document.createElement('meta'); el.setAttribute('property', property); document.head.appendChild(el) }
      el.setAttribute('content', content)
    })
    // Structured data
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: meta.title,
      description: meta.description,
      datePublished: meta.date,
      publisher: { '@type': 'Organization', name: 'SceneForge', url: 'https://sceneraforge.com' },
    }
    let sd = document.getElementById('blog-schema')
    if (!sd) { sd = document.createElement('script'); sd.id = 'blog-schema'; sd.setAttribute('type', 'application/ld+json'); document.head.appendChild(sd) }
    sd.textContent = JSON.stringify(schema)

    // Load markdown from public folder
    fetch(`/posts/${slug}.md`)
      .then(r => r.text())
      .then(text => {
        // Strip frontmatter
        const stripped = text.replace(/^---[\s\S]+?---\n/, '')
        setContent(stripped)
        setLoading(false)
      })
      .catch(() => {
        setContent('> This article content could not be loaded. Please try refreshing the page.')
        setLoading(false)
      })
  }, [slug, meta])

  if (!meta) {
    return (
      <div style={{ minHeight: '100vh', background: '#07070E', color: '#F0F0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 48 }}>404</div>
        <div style={{ color: 'rgba(255,255,255,0.5)' }}>Post not found</div>
        <a href="/blog" style={{ color: '#A78BFA', fontSize: 14 }}>← Back to blog</a>
      </div>
    )
  }

  const related = ALL_META.filter(p => p.slug !== slug && (p.category === meta.category || p.tags.some(t => meta.tags.includes(t)))).slice(0,2)

  return (
    <div style={{ minHeight: '100vh', background: '#07070E', color: '#F0F0FF' }}>
      {/* Nav */}
      <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 clamp(16px,5vw,64px)', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'rgba(7,7,14,0.95)', backdropFilter: 'blur(16px)', zIndex: 100 }}>
        <a href="/" style={{ fontFamily: 'Syne, system-ui, sans-serif', fontSize: 18, fontWeight: 800, color: '#F0F0FF', textDecoration: 'none' }}>Scene<span style={{ color: '#A78BFA' }}>Forge</span></a>
        <a href="/blog" style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>← Blog</a>
      </nav>

      <article style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(32px,5vw,64px) clamp(16px,4vw,32px)' }}>
        {/* Category + date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#A78BFA', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 100, padding: '3px 10px' }}>{meta.category}</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{formatDate(meta.date)}</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginLeft: 'auto' }}>{meta.readTime} min read</span>
        </div>

        {/* Hero thumbnail */}
        <div style={{ marginBottom: 28 }}>
          <BlogThumbnail slug={slug} title={meta.title} category={meta.category} size="hero" />
        </div>

        {/* Author byline */}
        {meta.author && AUTHORS[meta.author] && (
          <a
            href={`/blog/author/${meta.author}`}
            onClick={e => { e.preventDefault(); window.history.pushState({}, '', `/blog/author/${meta.author}`) }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, textDecoration: 'none' }}
          >
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: `${AUTHORS[meta.author].color}25`, border: `1.5px solid ${AUTHORS[meta.author].color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: AUTHORS[meta.author].color, flexShrink: 0 }}>
              {AUTHORS[meta.author].initials}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F0FF' }}>{AUTHORS[meta.author].name}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)' }}>{AUTHORS[meta.author].role} · {new Date(meta.date).getFullYear()}</div>
            </div>
          </a>
        )}

        {/* Content */}
        {loading ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', padding: '60px 0', textAlign: 'center' }}>Loading...</div>
        ) : (
          {meta.hasStepImages ? (
            // For step-by-step posts: split on ::step-image:: markers and render components inline
            <div style={{ fontSize: 16, lineHeight: 1.8, color: 'rgba(255,255,255,0.72)' }}>
              {content.replace(/^---[\s\S]+?---\n/, '').split(/^::step-image::(.+)$/m).map((part, i) => {
                if (i % 2 === 0) {
                  return part.trim() ? (
                    <div key={i} dangerouslySetInnerHTML={{ __html: `<p style="font-size:16px;line-height:1.8;color:rgba(255,255,255,0.72);margin:0 0 20px">${renderMarkdown(part)}</p>` }} />
                  ) : null
                }
                const key = part.trim()
                const Comp = STEP_IMAGES[key]
                return Comp ? (
                  <div key={i} style={{ margin: '24px 0' }}>
                    <Comp />
                    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginTop: 8, fontStyle: 'italic' }}>
                      SceneForge — {key.replace('step', 'Step ').replace('-', ': ').replace(/-/g,' ')}
                    </p>
                  </div>
                ) : null
              })}
            </div>
          ) : (
            <div
              style={{ fontSize: 16, lineHeight: 1.8, color: 'rgba(255,255,255,0.72)' }}
              dangerouslySetInnerHTML={{ __html: `<p style="font-size:16px;line-height:1.8;color:rgba(255,255,255,0.72);margin:0 0 20px">${renderMarkdown(content)}</p>` }}
            />
          )}
        )}

        {/* Tags */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 40, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {meta.tags.map(tag => (
            <span key={tag} style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: 100 }}>#{tag}</span>
          ))}
        </div>

        {/* CTA */}
        <div style={{ background: 'linear-gradient(135deg,rgba(124,92,255,0.1),rgba(45,212,191,0.05))', border: '1px solid rgba(124,92,255,0.2)', borderRadius: 16, padding: 28, marginTop: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10, fontFamily: 'Syne, system-ui, sans-serif' }}>Create your first AI video free</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', marginBottom: 20 }}>No camera, no editing skills, no credit card. Start in 60 seconds.</div>
          <a href="/" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#7C5CFF,#5B3FE0)', color: '#fff', padding: '12px 28px', borderRadius: 12, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
            Try SceneForge free →
          </a>
        </div>

        {/* Related posts */}
        {related.length > 0 && (
          <div style={{ marginTop: 48 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 16 }}>Related posts</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 14 }}>
              {related.map(p => (
                <a key={p.slug} href={`/blog/${p.slug}`} onClick={e => { e.preventDefault(); window.history.pushState({}, '', `/blog/${p.slug}`); window.dispatchEvent(new PopStateEvent('popstate')) }}
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 16, textDecoration: 'none', display: 'block' }}>
                  <div style={{ fontSize: 12, color: '#A78BFA', marginBottom: 6 }}>{p.readTime} min read</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#F0F0FF', lineHeight: 1.4 }}>{p.title}</div>
                </a>
              ))}
            </div>
          </div>
        )}
      </article>

      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '32px clamp(16px,5vw,64px)', marginTop: 60, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontFamily: 'Syne, system-ui, sans-serif', fontWeight: 800, fontSize: 15 }}>Scene<span style={{ color: '#A78BFA' }}>Forge</span></span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>AI Video Studio · <a href="https://sceneraforge.com" style={{ color: '#A78BFA', textDecoration: 'none' }}>sceneraforge.com</a></span>
      </footer>
    </div>
  )
}
