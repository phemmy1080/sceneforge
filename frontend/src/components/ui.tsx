import React from 'react'

// ─── Button ───────────────────────────────────────────────────────────────────

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'teal' | 'coral' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
}

export function Button({
  variant = 'ghost',
  size = 'md',
  loading,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center gap-2 font-medium rounded-lg transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed'

  const sizes = {
    sm: 'px-3 py-1.5 text-[12px]',
    md: 'px-4 py-2.5 text-[13.5px]',
  }

  const variants = {
    primary:
      'bg-violet-600 text-white hover:bg-violet-500 active:scale-[0.98] shadow-[0_0_0_0] hover:shadow-[0_4px_20px_rgba(124,92,255,0.35)]',
    ghost:
      'bg-transparent text-white/60 border border-white/15 hover:bg-white/5 hover:text-white/90',
    teal:
      'bg-teal-500/12 text-teal-400 border border-teal-500/25 hover:bg-teal-500/20',
    coral:
      'bg-orange-500/12 text-orange-400 border border-orange-500/25 hover:bg-orange-500/20',
    danger:
      'bg-red-500/12 text-red-400 border border-red-500/25 hover:bg-red-500/20',
  }

  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
          <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`bg-[#111118] border border-white/[0.07] rounded-xl p-5 ${className}`}
    >
      {children}
    </div>
  )
}

// ─── CardTitle ────────────────────────────────────────────────────────────────

export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-white/40 uppercase tracking-widest mb-3.5">
      {children}
    </p>
  )
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

export function Chip({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`
        px-3.5 py-1.5 rounded-full text-[12.5px] font-medium border transition-all duration-150
        ${selected
          ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
          : 'bg-[#1A1A24] border-white/10 text-white/50 hover:border-white/25 hover:text-white/80'}
      `}
    >
      {label}
    </button>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeColor = 'purple' | 'teal' | 'coral' | 'amber' | 'gray'

const badgeStyles: Record<BadgeColor, string> = {
  purple: 'bg-violet-500/15 text-violet-300',
  teal: 'bg-teal-500/15 text-teal-400',
  coral: 'bg-orange-500/15 text-orange-400',
  amber: 'bg-amber-500/15 text-amber-400',
  gray: 'bg-white/8 text-white/50',
}

export function Badge({
  children,
  color = 'gray',
}: {
  children: React.ReactNode
  color?: BadgeColor
}) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${badgeStyles[color]}`}>
      {children}
    </span>
  )
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-[3px] bg-white/8 rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full bg-gradient-to-r from-violet-500 to-teal-400 rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

// ─── PageHeader ───────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}) {
  return (
    <div className="mb-7">
      <h1 className="font-display text-[26px] font-bold tracking-tight text-white mb-1">
        {title}
      </h1>
      {subtitle && <p className="text-[14px] text-white/50">{subtitle}</p>}
    </div>
  )
}

// ─── LoadingState ─────────────────────────────────────────────────────────────

export function LoadingState({
  label,
  progress,
}: {
  label: string
  progress?: number
}) {
  return (
    <div className="py-10 text-center">
      <p className="text-[13px] text-white/40 mb-3 animate-pulse">{label}</p>
      {progress !== undefined && <ProgressBar value={progress} className="max-w-xs mx-auto" />}
    </div>
  )
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-14 text-center">
      <p className="text-[13px] text-white/30">{label}</p>
    </div>
  )
}

// ─── Select ───────────────────────────────────────────────────────────────────

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-white/50 mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#1A1A24] border border-white/12 rounded-lg text-[13.5px] text-white/90 px-3 py-2.5 outline-none focus:border-violet-500/60 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-[#1A1A24]">
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── TextInput ────────────────────────────────────────────────────────────────

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-white/50 mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#1A1A24] border border-white/12 rounded-lg text-[13.5px] text-white/90 px-3 py-2.5 outline-none focus:border-violet-500/60 placeholder-white/20"
      />
    </div>
  )
}
