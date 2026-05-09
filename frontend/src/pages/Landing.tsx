import React, { useEffect, useRef, useState } from 'react'

interface LandingProps {
  onLogin: () => void
  onSignup: () => void
}

const FEATURES = [
  { icon: '⚡', title: 'AI Script Generation', desc: 'From niche to full voiceover script in seconds. Streamed live as it writes.' },
  { icon: '🎬', title: 'Scene Editor', desc: 'Edit every scene — text, duration, and visuals — before a single frame renders.' },
  { icon: '🎙️', title: 'Neural Voice Synthesis', desc: '24+ neural voices with adjustable pace and tone. Upload your own voice too.' },
  { icon: '📸', title: 'Auto Visuals', desc: 'Pexels stock footage matched per scene automatically. Zero manual searching.' },
  { icon: '✂️', title: 'CapCut Export', desc: 'Full MP4 or per-scene bundle with CapCut draft ready to import instantly.' },
  { icon: '📊', title: 'Multi-Platform', desc: 'Optimised for TikTok, YouTube Shorts, Instagram Reels, and LinkedIn.' },
]

const STEPS = [
  { num: '01', label: 'Choose your niche', sub: 'Pick from curated content categories' },
  { num: '02', label: 'AI writes your script', sub: 'Full voiceover, streamed live' },
  { num: '03', label: 'Edit & customise', sub: 'Scenes, voice, visuals — all yours' },
  { num: '04', label: 'Render & publish', sub: 'MP4 ready in under 60 seconds' },
]

const STATS = [
  { value: '60s', label: 'Average render time' },
  { value: '24+', label: 'Neural voice options' },
  { value: '4', label: 'Platforms supported' },
  { value: '100%', label: 'AI-powered workflow' },
]

const TESTIMONIALS = [
  { quote: 'I went from idea to published TikTok in under 3 minutes. SceneForge is the tool I didn\'t know I needed.', name: 'Adebayo O.', role: 'Content creator · Lagos', init: 'AO', color: '#A78BFA' },
  { quote: 'The neural voice quality is unreal. My audience can\'t tell it\'s AI-narrated. Views went up 4x since I started using SceneForge.', name: 'Priya M.', role: 'YouTube creator · Mumbai', init: 'PM', color: '#2DD4BF' },
  { quote: 'I produce 3 YouTube Shorts a day with this. What used to take me 2 hours now takes 8 minutes. Absolute game-changer.', name: 'Carlos R.', role: 'Fitness creator · São Paulo', init: 'CR', color: '#F59E0B' },
  { quote: 'SceneForge replaced my entire video production stack. Script, voiceover, footage — all done before I finish my coffee.', name: 'Amina K.', role: 'Business educator · Nairobi', init: 'AK', color: '#34D399' },
  { quote: 'Best investment I\'ve made for my brand. The CapCut export feature saves me another 30 minutes per video.', name: 'James T.', role: 'Finance creator · London', init: 'JT', color: '#60A5FA' },
  { quote: 'As a non-native English speaker the neural voices sound better than my own recordings. My channel grew 2k subs in a month.', name: 'Yuki S.', role: 'Tech creator · Tokyo', init: 'YS', color: '#F472B6' },
]

const SAMPLE_PROJECTS = [
  { title: '5 Morning Habits That Changed My Life', niche: 'Lifestyle', platform: 'TikTok', duration: '58s', scenes: 8, color: '#A78BFA' },
  { title: 'How to Invest ₦50k in 2026', niche: 'Finance', platform: 'YouTube Shorts', duration: '55s', scenes: 7, color: '#2DD4BF' },
  { title: 'Top 10 AI Tools You Need Right Now', niche: 'Tech', platform: 'Instagram Reels', duration: '44s', scenes: 10, color: '#F59E0B' },
  { title: '3 Home Workouts No Equipment Needed', niche: 'Fitness', platform: 'TikTok', duration: '52s', scenes: 9, color: '#34D399' },
  { title: 'The Psychology of Viral Content', niche: 'Marketing', platform: 'LinkedIn', duration: '60s', scenes: 8, color: '#60A5FA' },
  { title: 'Why Africa is the Next Tech Hub', niche: 'Business', platform: 'YouTube Shorts', duration: '57s', scenes: 9, color: '#F472B6' },
  { title: 'Healthy Meal Prep in 20 Minutes', niche: 'Food', platform: 'Instagram Reels', duration: '48s', scenes: 7, color: '#FB923C' },
  { title: 'Crypto Explained for Beginners', niche: 'Finance', platform: 'TikTok', duration: '60s', scenes: 10, color: '#A78BFA' },
]

function ScrollRow({ children, speed = 40 }: { children: React.ReactNode; speed?: number }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const animRef = useRef<number>()
  const lastTime = useRef<number>(0)

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const half = row.scrollWidth / 2

    const tick = (time: number) => {
      const dt = lastTime.current ? (time - lastTime.current) / 1000 : 0
      lastTime.current = time
      setOffset(prev => {
        const next = prev + speed * dt
        return next >= half ? 0 : next
      })
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [speed])

  return (
    <div style={{ overflow: 'hidden', width: '100%' }}>
      <div
        ref={rowRef}
        style={{
          display: 'flex', gap: 16,
          transform: `translateX(-${offset}px)`,
          willChange: 'transform',
          width: 'max-content',
        }}
      >
        {children}
        {children}
      </div>
    </div>
  )
}

export default function Landing({ onLogin, onSignup }: LandingProps) {
  return (
    <div style={{ minHeight: '100vh', background: '#07070E', color: '#F0F0FF', overflowX: 'hidden', fontFamily: 'var(--font-body)' }}>

      {/* NAV */}
      <nav aria-label="Main navigation" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 clamp(20px, 5vw, 64px)', height: 64,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(7,7,14,0.92)', backdropFilter: 'blur(16px)',
      }}>
        <div style={{ fontFamily: "'Syne', system-ui, sans-serif", fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px' }}>
          Scene<span style={{ color: '#A78BFA' }}>Forge</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={onLogin} style={ghostBtn}>Log in</button>
          <button onClick={onSignup} style={primaryBtn}>Start free →</button>
        </div>
      </nav>

      <main>

        {/* HERO */}
        <section aria-labelledby="hero-heading" style={{ position: 'relative', textAlign: 'center', padding: 'clamp(72px, 12vw, 120px) 20px clamp(60px, 10vw, 100px)', overflow: 'hidden' }}>
          <div aria-hidden="true" style={{
            position: 'absolute', inset: 0, zIndex: 0,
            backgroundImage: `linear-gradient(rgba(167,139,250,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(167,139,250,0.04) 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
          }} />
          <div aria-hidden="true" style={{
            position: 'absolute', top: -100, left: '50%', transform: 'translateX(-50%)',
            width: 900, height: 600, borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(124,92,255,0.14) 0%, rgba(45,212,191,0.04) 50%, transparent 70%)',
            pointerEvents: 'none', zIndex: 0,
          }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)',
              borderRadius: 100, padding: '6px 16px', marginBottom: 28,
            }}>
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: '#A78BFA', display: 'inline-block' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#C4B5FD', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                AI Video Studio
              </span>
            </div>
            <h1 id="hero-heading" style={{
              fontFamily: "'Syne', system-ui, sans-serif",
              fontSize: 'clamp(32px, 3.5vw, 52px)',
              fontWeight: 800, lineHeight: 1.1, letterSpacing: '-1px',
              margin: '0 auto 28px', maxWidth: 920,
            }}>
              Go from idea to{' '}
              <span style={{ background: 'linear-gradient(135deg, #A78BFA 0%, #2DD4BF 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                viral video
              </span>{' '}
              in 60 seconds
            </h1>
            <p style={{ fontSize: 'clamp(16px, 2vw, 20px)', color: 'rgba(255,255,255,0.72)', maxWidth: 560, margin: '0 auto 40px', lineHeight: 1.7 }}>
              SceneForge writes your script, voices it with neural narration, sources footage, and renders — fully automated, completely customisable.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
              <button onClick={onSignup} style={{ ...primaryBtn, padding: '14px 36px', fontSize: 15, fontWeight: 700 }}>
                Create your first video free
              </button>
              <button onClick={onLogin} style={{ ...ghostBtn, padding: '14px 28px', fontSize: 15 }}>
                Sign in to your account
              </button>
            </div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', margin: 0 }}>
              No credit card required · Free plan · 3 videos/day
            </p>
          </div>
        </section>

        {/* STATS BAR */}
        <section aria-label="Platform statistics" style={{
          borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.02)',
        }}>
          <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 clamp(20px, 4vw, 48px)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {STATS.map((s, i) => (
              <div key={i} style={{ textAlign: 'center', padding: '28px 16px', borderRight: i < 3 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                <div style={{ fontFamily: "'Syne', system-ui, sans-serif", fontSize: 30, fontWeight: 800, color: '#A78BFA', letterSpacing: '-1px', marginBottom: 4 }}>{s.value}</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.60)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* SAMPLE PROJECTS — auto-scrolling */}
        <section aria-labelledby="projects-heading" style={{ padding: 'clamp(60px, 8vw, 80px) 0', overflow: 'hidden' }}>
          <div style={{ textAlign: 'center', marginBottom: 40, padding: '0 20px' }}>
            <p style={sectionEyebrow}>Made with SceneForge</p>
            <h2 id="projects-heading" style={sectionTitle}>Videos creators are making right now</h2>
          </div>
          <ScrollRow speed={45}>
            {SAMPLE_PROJECTS.map((p, i) => (
              <div key={i} style={{
                flexShrink: 0, width: 220,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16, padding: '20px 18px',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: p.color + '22', border: `1px solid ${p.color}44`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 14, fontSize: 16,
                }} aria-hidden="true">🎬</div>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF', marginBottom: 10, lineHeight: 1.4 }}>{p.title}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ ...pill, background: p.color + '18', color: p.color, border: `1px solid ${p.color}33` }}>{p.niche}</span>
                  <span style={{ ...pill, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.65)' }}>{p.platform}</span>
                  <span style={{ ...pill, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.65)' }}>{p.duration}</span>
                  <span style={{ ...pill, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.65)' }}>{p.scenes} scenes</span>
                </div>
              </div>
            ))}
          </ScrollRow>
        </section>

        {/* HOW IT WORKS */}
        <section aria-labelledby="steps-heading" style={{ padding: 'clamp(40px, 6vw, 72px) clamp(20px, 4vw, 48px)', maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <p style={sectionEyebrow}>How it works</p>
            <h2 id="steps-heading" style={sectionTitle}>Four steps. One perfect video.</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {STEPS.map((step, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16, padding: '28px 22px', position: 'relative',
              }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 36, height: 36, borderRadius: 10,
                  background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.2)', marginBottom: 16,
                }}>
                  <span style={{ fontFamily: "'Syne', system-ui, sans-serif", fontSize: 12, fontWeight: 800, color: '#A78BFA' }}>{step.num}</span>
                </div>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#FFFFFF', marginBottom: 6, lineHeight: 1.3 }}>{step.label}</p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.60)', lineHeight: 1.5, margin: 0 }}>{step.sub}</p>
                {i < STEPS.length - 1 && (
                  <div aria-hidden="true" style={{ position: 'absolute', right: -8, top: '40px', color: 'rgba(167,139,250,0.4)', fontSize: 18, zIndex: 2 }}>→</div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* FEATURES */}
        <section aria-labelledby="features-heading" style={{ padding: 'clamp(40px, 6vw, 72px) clamp(20px, 4vw, 48px)', maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <p style={sectionEyebrow}>Features</p>
            <h2 id="features-heading" style={sectionTitle}>Everything you need to create</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {FEATURES.map((f, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16, padding: '26px 24px',
              }}>
                <div aria-hidden="true" style={{ fontSize: 24, marginBottom: 14, lineHeight: 1 }}>{f.icon}</div>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#FFFFFF', marginBottom: 8 }}>{f.title}</p>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.68)', lineHeight: 1.65, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* TESTIMONIALS — auto-scrolling */}
        <section aria-labelledby="testimonials-heading" style={{ padding: 'clamp(60px, 8vw, 80px) 0', overflow: 'hidden' }}>
          <div style={{ textAlign: 'center', marginBottom: 40, padding: '0 20px' }}>
            <p style={sectionEyebrow}>Creator stories</p>
            <h2 id="testimonials-heading" style={sectionTitle}>Loved by creators worldwide</h2>
          </div>
          <ScrollRow speed={30}>
            {TESTIMONIALS.map((t, i) => (
              <div key={i} style={{
                flexShrink: 0, width: 320,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 20, padding: '24px 24px',
              }}>
                {/* Stars */}
                <div aria-label="5 stars" style={{ marginBottom: 14 }}>
                  {'★★★★★'.split('').map((s, j) => (
                    <span key={j} style={{ color: '#F59E0B', fontSize: 14 }}>{s}</span>
                  ))}
                </div>
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.80)', lineHeight: 1.65, marginBottom: 20, fontStyle: 'italic' }}>
                  "{t.quote}"
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%',
                    background: t.color + '33', border: `1px solid ${t.color}55`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: t.color, flexShrink: 0,
                  }} aria-hidden="true">{t.init}</div>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.90)', margin: 0 }}>{t.name}</p>
                    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', margin: 0 }}>{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </ScrollRow>
        </section>

        {/* CTA */}
        <section aria-labelledby="cta-heading" style={{
          padding: 'clamp(72px, 10vw, 110px) clamp(20px, 4vw, 48px)',
          textAlign: 'center', position: 'relative',
        }}>
          <div aria-hidden="true" style={{
            position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
            width: 700, height: 350,
            background: 'radial-gradient(ellipse at center bottom, rgba(124,92,255,0.12) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <p style={sectionEyebrow}>Get started today</p>
            <h2 id="cta-heading" style={{
              fontFamily: "'Syne', system-ui, sans-serif",
              fontSize: 'clamp(28px, 2.8vw, 42px)',
              fontWeight: 800, letterSpacing: '-1px',
              margin: '0 auto 16px', maxWidth: 560, color: '#FFFFFF', lineHeight: 1.1,
            }}>
              Your next viral video is one click away
            </h2>
            <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.72)', maxWidth: 440, margin: '0 auto 36px' }}>
              Join creators using SceneForge to produce more content in less time — powered by neural narration and AI visuals.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={onSignup} style={{ ...primaryBtn, padding: '15px 40px', fontSize: 15, fontWeight: 700 }}>
                Create free account →
              </button>
              <button onClick={onLogin} style={{ ...ghostBtn, padding: '15px 28px', fontSize: 15 }}>
                Log in
              </button>
            </div>
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer aria-label="Site footer" style={{
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: 'clamp(20px, 3vw, 28px) clamp(20px, 4vw, 64px)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
      }}>
        <span aria-label="SceneForge" style={{ fontFamily: "'Syne', system-ui, sans-serif", fontSize: 15, fontWeight: 800, color: 'rgba(255,255,255,0.80)' }}>
          Scene<span style={{ color: '#A78BFA' }}>Forge</span>
        </span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
          © {new Date().getFullYear()} SceneForge. All rights reserved.
        </span>
      </footer>
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  background: 'linear-gradient(135deg, #7C5CFF 0%, #6344E8 100%)',
  color: '#fff', border: 'none', borderRadius: 12,
  padding: '11px 22px', minHeight: 44, fontSize: 14, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'var(--font-body)',
  transition: 'opacity 0.15s, transform 0.15s',
  boxShadow: '0 0 0 1px rgba(124,92,255,0.4)',
}

const ghostBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  color: 'rgba(255,255,255,0.85)',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 12, padding: '11px 20px', minHeight: 44,
  fontSize: 14, fontWeight: 500, cursor: 'pointer',
  fontFamily: 'var(--font-body)', transition: 'border-color 0.15s',
}

const sectionEyebrow: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#A78BFA',
  textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 12px',
}

const sectionTitle: React.CSSProperties = {
  fontFamily: "'Syne', system-ui, sans-serif",
  fontSize: 'clamp(22px, 2vw, 30px)',
  fontWeight: 800, letterSpacing: '-0.5px',
  color: '#FFFFFF', margin: '0 auto', lineHeight: 1.15,
}

const pill: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '3px 9px',
  borderRadius: 100, display: 'inline-block',
}
