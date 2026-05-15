interface ThumbnailProps {
  slug: string
  title: string
  category: string
  size?: 'card' | 'hero'
}

const THUMBNAIL_THEMES: Record<string, { bg: string; accent: string; icon: string; label: string }> = {
  'ai-video-creation-future-2026':         { bg: 'linear-gradient(135deg,#0D0A1E 0%,#1A0D3A 100%)', accent: '#A78BFA', icon: '✦', label: 'AI & Technology' },
  'tiktok-content-strategy-guide-2026':    { bg: 'linear-gradient(135deg,#0A1A1A 0%,#001A2E 100%)', accent: '#2DD4BF', icon: '▶', label: 'Strategy' },
  'how-to-create-viral-tiktok-videos-with-ai': { bg: 'linear-gradient(135deg,#1A0A00 0%,#2E1500 100%)', accent: '#F59E0B', icon: '⚡', label: 'Tutorial' },
  'best-niches-for-content-creators-2025': { bg: 'linear-gradient(135deg,#001A10 0%,#002A1A 100%)', accent: '#34D399', icon: '◆', label: 'Strategy' },
  'ai-video-tools-comparison-2025':        { bg: 'linear-gradient(135deg,#0A0A1A 0%,#15153A 100%)', accent: '#818CF8', icon: '⊞', label: 'Review' },
  'youtube-shorts-algorithm-guide':        { bg: 'linear-gradient(135deg,#1A0A0A 0%,#2E0808 100%)', accent: '#F87171', icon: '▷', label: 'Strategy' },
  'content-creator-monetisation-guide':    { bg: 'linear-gradient(135deg,#0A1400 0%,#162300 100%)', accent: '#86EFAC', icon: '$', label: 'Monetisation' },
  'how-to-make-money-as-content-creator-with-ai': { bg: 'linear-gradient(135deg,#0D0A00 0%,#1A1200 100%)', accent: '#FCD34D', icon: '◈', label: 'Monetisation' },
}

const DEFAULT_THEME = { bg: 'linear-gradient(135deg,#0D0A1E 0%,#1A0D3A 100%)', accent: '#A78BFA', icon: '✦', label: 'Blog' }

export default function BlogThumbnail({ slug, title, category, size = 'card' }: ThumbnailProps) {
  const theme = THUMBNAIL_THEMES[slug] || DEFAULT_THEME
  const h = size === 'hero' ? 260 : 160
  const titleSize = size === 'hero' ? 22 : 15

  return (
    <div style={{
      width: '100%', height: h,
      background: theme.bg,
      borderRadius: 12,
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      padding: size === 'hero' ? '20px 24px' : '14px 16px',
    }}>
      {/* Grid pattern overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
        backgroundSize: '32px 32px',
      }} />

      {/* Glow blob */}
      <div style={{
        position: 'absolute', top: '-20%', right: '-10%',
        width: '55%', height: '70%',
        background: `radial-gradient(circle, ${theme.accent}22 0%, transparent 70%)`,
        borderRadius: '50%',
        filter: 'blur(24px)',
      }} />

      {/* Icon */}
      <div style={{
        position: 'absolute', top: size === 'hero' ? 20 : 12, right: size === 'hero' ? 24 : 14,
        width: size === 'hero' ? 44 : 32, height: size === 'hero' ? 44 : 32,
        borderRadius: '50%',
        border: `1px solid ${theme.accent}44`,
        background: `${theme.accent}11`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size === 'hero' ? 18 : 13,
        color: theme.accent,
      }}>
        {theme.icon}
      </div>

      {/* Category badge */}
      <div style={{
        position: 'absolute', top: size === 'hero' ? 20 : 12, left: size === 'hero' ? 24 : 14,
        fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
        color: theme.accent, background: `${theme.accent}18`,
        border: `1px solid ${theme.accent}30`,
        borderRadius: 100, padding: '3px 9px',
      }}>
        {theme.label}
      </div>

      {/* Scan lines */}
      {[0.35, 0.55, 0.72].map((y, i) => (
        <div key={i} style={{
          position: 'absolute', left: 0, right: 0,
          top: `${y * 100}%`, height: 1,
          background: `linear-gradient(90deg, transparent, ${theme.accent}15, transparent)`,
        }} />
      ))}

      {/* Title */}
      <div style={{
        position: 'relative', zIndex: 2,
        fontSize: titleSize, fontWeight: 700,
        color: '#F0F0FF', lineHeight: 1.3,
        letterSpacing: '-0.3px',
        textShadow: '0 2px 8px rgba(0,0,0,0.6)',
        maxWidth: '85%',
      }}>
        {title.length > 60 ? title.slice(0, 57) + '…' : title}
      </div>

      {/* Bottom gradient */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.5))',
      }} />
    </div>
  )
}
