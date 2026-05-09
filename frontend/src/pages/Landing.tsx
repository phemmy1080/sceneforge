import React from 'react'

interface LandingProps {
  onLogin: () => void
  onSignup: () => void
}

const FEATURES = [
  {
    icon: '◈',
    title: 'AI idea generation',
    desc: 'SceneForge generates 6 viral content ideas from your niche and style in seconds.',
  },
  {
    icon: '◎',
    title: 'Script + scene breakdown',
    desc: 'Full voiceover scripts streamed live, then auto-split into timestamped scenes.',
  },
  {
    icon: '▣',
    title: 'Scene editor',
    desc: 'Edit every scene — text, duration, visual — before a single frame is rendered.',
  },
  {
    icon: '◉',
    title: 'Voice synthesis',
    desc: 'Multi-engine text-to-speech with diverse voices, adjustable speed, and voice tuning.',
  },
  {
    icon: '◫',
    title: 'Auto visuals',
    desc: 'Pexels stock footage matched per scene, automatically filling every shot.',
  },
  {
    icon: '◱',
    title: 'CapCut export',
    desc: 'Full MP4 or per-scene bundle with draft_content.json ready for CapCut import.',
  },
]

const STEPS = [
  { num: '01', label: 'Pick niche & style' },
  { num: '02', label: 'SceneForge writes the script' },
  { num: '03', label: 'Edit scenes visually' },
  { num: '04', label: 'Render & export' },
]

export default function Landing({ onLogin, onSignup }: LandingProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#080810',
        color: '#EEEEFF',
        fontFamily: "'DM Sans', sans-serif",
        overflowX: 'hidden',
      }}
    >
      {/* ── NAV ───────────────────────────────────────────────── */}
      <nav
        aria-label="Main navigation"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px clamp(16px, 4vw, 48px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          position: 'sticky',
          top: 0,
          background: 'rgba(8,8,16,0.85)',
          backdropFilter: 'blur(12px)',
          zIndex: 100,
        }}
      >
        <div
          aria-label="SceneForge"
          style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px' }}
        >
          Scene<span style={{ color: '#A78BFA' }}>Forge</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onLogin} style={ghostBtn}>Log in</button>
          <button onClick={onSignup} style={primaryBtn}>Get started free →</button>
        </div>
      </nav>

      {/* ── MAIN CONTENT (landmark fix) ───────────────────────── */}
      <main>

        {/* ── HERO ────────────────────────────────────────────── */}
        <section
          aria-labelledby="hero-heading"
          style={{
            textAlign: 'center',
            padding: 'clamp(60px,10vw,100px) 20px clamp(50px,8vw,80px)',
            position: 'relative',
          }}
        >
          {/* Radial glow — decorative, hidden from screen readers */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
              width: 600, height: 400,
              background: 'radial-gradient(ellipse at center top, rgba(124,92,255,0.18) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />

          <h1
            id="hero-heading"
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 'clamp(40px, 7vw, 78px)',
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: '-2px',
              margin: '0 auto 24px',
              maxWidth: 860,
            }}
          >
            Turn any idea into a<br />
            <span style={{
              background: 'linear-gradient(135deg, #A78BFA 0%, #2DD4BF 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              ready-to-post video
            </span>
          </h1>

          {/* contrast fix: 0.5 → 0.75 */}
          <p style={{
            fontSize: 18,
            color: 'rgba(255,255,255,0.75)',
            maxWidth: 540,
            margin: '0 auto 44px',
            lineHeight: 1.7,
          }}>
            Pick your niche. SceneForge writes the script, breaks it into scenes,
            sources visuals, synthesises voice, and renders your video — all in one flow.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onSignup} style={{ ...primaryBtn, padding: '14px 32px', fontSize: 15 }}>
              Create your first video — free
            </button>
            <button onClick={onLogin} style={{ ...ghostBtn, padding: '14px 28px', fontSize: 15 }}>
              Already have an account
            </button>
          </div>

          {/* contrast fix: 0.25 → 0.55 */}
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 20 }}>
            No credit card required · Free plan includes 3 videos/day
          </p>
        </section>

        {/* ── HOW IT WORKS ────────────────────────────────────── */}
        <section
          aria-labelledby="steps-heading"
          style={{ padding: 'clamp(36px,6vw,60px) clamp(16px,4vw,48px)', maxWidth: 1000, margin: '0 auto' }}
        >
          {/* contrast fix: 0.3 → 0.6 */}
          <p id="steps-heading" style={sectionLabel}>How it works</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
            {STEPS.map((step, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 14,
                padding: '24px 20px',
                position: 'relative',
              }}>
                <div
                  aria-hidden="true"
                  style={{
                    fontFamily: "'Syne', sans-serif",
                    fontSize: 36,
                    fontWeight: 800,
                    color: 'rgba(124,92,255,0.35)',
                    lineHeight: 1,
                    marginBottom: 12,
                  }}
                >
                  {step.num}
                </div>
                {/* contrast fix: 0.8 → 0.9 */}
                <p style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>
                  {step.label}
                </p>
                {i < STEPS.length - 1 && (
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute', right: -12, top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'rgba(255,255,255,0.3)', fontSize: 18, zIndex: 2,
                    }}
                  >→</div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── FEATURES ────────────────────────────────────────── */}
        <section
          aria-labelledby="features-heading"
          style={{ padding: 'clamp(28px,5vw,40px) clamp(16px,4vw,48px) clamp(48px,8vw,80px)', maxWidth: 1000, margin: '0 auto' }}
        >
          <p id="features-heading" style={sectionLabel}>Everything included</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {FEATURES.map((f, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 16,
                padding: '22px 22px',
                transition: 'border-color 0.2s',
              }}>
                <div aria-hidden="true" style={{ fontSize: 22, color: '#A78BFA', marginBottom: 12, lineHeight: 1 }}>
                  {f.icon}
                </div>
                {/* contrast fix: 0.9 → 1.0 */}
                <p style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF', marginBottom: 6 }}>
                  {f.title}
                </p>
                {/* contrast fix: 0.4 → 0.7 */}
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.70)', lineHeight: 1.6 }}>
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA BANNER ──────────────────────────────────────── */}
        <section
          aria-labelledby="cta-heading"
          style={{
            margin: '0 48px 80px',
            background: 'linear-gradient(135deg, rgba(124,92,255,0.15) 0%, rgba(45,212,191,0.1) 100%)',
            border: '1px solid rgba(124,92,255,0.25)',
            borderRadius: 24,
            padding: 'clamp(32px,5vw,52px) clamp(16px,4vw,48px)',
            textAlign: 'center',
          }}
        >
          <h2
            id="cta-heading"
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: '-1px',
              marginBottom: 16,
              color: '#FFFFFF',
            }}
          >
            Ready to create?
          </h2>
          {/* contrast fix: 0.5 → 0.75 */}
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.75)', marginBottom: 28 }}>
            Join creators already using SceneForge to publish faster.
          </p>
          <button onClick={onSignup} style={{ ...primaryBtn, padding: '14px 36px', fontSize: 15 }}>
            Start for free →
          </button>
        </section>

      </main>

      {/* ── FOOTER ──────────────────────────────────────────────── */}
      <footer
        aria-label="Site footer"
        style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: 'clamp(16px,3vw,24px) clamp(16px,4vw,48px)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          aria-label="SceneForge"
          style={{ fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}
        >
          Scene<span style={{ color: '#A78BFA' }}>Forge</span>
        </span>
        {/* contrast fix: 0.2 → 0.55 */}
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
          © {new Date().getFullYear()} SceneForge. All rights reserved.
        </span>
      </footer>
    </div>
  )
}

// ── Shared style objects ──────────────────────────────────────────────────────

const primaryBtn: React.CSSProperties = {
  background: '#7C5CFF',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '11px 20px',
  minHeight: 44,
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: "'DM Sans', sans-serif",
  transition: 'background 0.15s, transform 0.15s',
}

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'rgba(255,255,255,0.85)',
  border: '1px solid rgba(255,255,255,0.25)',
  borderRadius: 10,
  padding: '11px 18px',
  minHeight: 44,
  fontSize: 13.5,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: "'DM Sans', sans-serif",
  transition: 'border-color 0.15s',
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.60)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: 20,
}
