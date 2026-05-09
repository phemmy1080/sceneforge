import { useState, useEffect } from 'react'
import { api } from '../lib/api'

interface Props {
  trigger: 'video_complete' | 'time_on_screen' | 'manual'
  onClose: () => void
}

const LABELS = ['Poor', 'Fair', 'Okay', 'Good', 'Excellent']
const EMOJIS = ['😞', '😕', '😐', '😊', '🤩']
const COLORS = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#2dd4bf']

const TAGS = [
  'Easy to use', 'Fast renders', 'Neural voices',
  'Great visuals', 'Script quality', 'Would recommend',
  'Needs improvement', 'Missing features',
]

export default function FeedbackModal({ trigger, onClose }: Props) {
  const [step, setStep]       = useState<'rating' | 'details' | 'done'>('rating')
  const [rating, setRating]   = useState(0)
  const [tags, setTags]       = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [submitting, setSub]  = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => { setTimeout(() => setVisible(true), 50) }, [])

  function handleClose() {
    setVisible(false)
    setTimeout(onClose, 350)
  }

  function selectRating(v: number) { setRating(v) }

  function toggleTag(tag: string) {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  function goDetails() { if (rating) setStep('details') }

  async function submit() {
    setSub(true)
    try {
      await api.post('/api/feedback', {
        rating, tags, comment: comment.trim(), trigger, page: 'setup',
      })
    } catch { /* silent */ }
    setStep('done')
    setSub(false)
    setTimeout(handleClose, 3000)
  }

  const glowColor = rating ? COLORS[rating - 1] : 'transparent'

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && handleClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.70)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.35s ease',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 400,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.97)',
        transition: 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)',
      }}>

        {/* ── STEP 1: RATING ── */}
        {step === 'rating' && (
          <div style={{
            background: 'linear-gradient(180deg,#16141f 0%,#111118 100%)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 24,
            overflow: 'hidden',
            boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,92,255,0.08)',
          }}>
            {/* Header */}
            <div style={{
              background: 'linear-gradient(135deg,rgba(124,92,255,0.18) 0%,rgba(45,212,191,0.08) 100%)',
              padding: '28px 28px 24px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              position: 'relative',
            }}>
              {/* Top shine line */}
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 1,
                background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.5),transparent)',
              }} />
              <button
                onClick={handleClose}
                aria-label="Close"
                style={{
                  position: 'absolute', top: 16, right: 16,
                  width: 30, height: 30, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(255,255,255,0.4)', fontSize: 15,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >×</button>

              {(trigger === 'video_complete' || trigger === 'manual') && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  background: 'rgba(45,212,191,0.12)', border: '1px solid rgba(45,212,191,0.25)',
                  borderRadius: 100, padding: '5px 13px', marginBottom: 16,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: '#2DD4BF',
                    display: 'inline-block', boxShadow: '0 0 6px #2DD4BF',
                  }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#2DD4BF', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Video rendered
                  </span>
                </div>
              )}

              {trigger === 'time_on_screen' && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)',
                  borderRadius: 100, padding: '5px 13px', marginBottom: 16,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: '#A78BFA',
                    display: 'inline-block', boxShadow: '0 0 6px #A78BFA',
                  }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#C4B5FD', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Quick feedback
                  </span>
                </div>
              )}

              <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.5px', lineHeight: 1.2, fontFamily: 'Syne, system-ui, sans-serif' }}>
                How did we do?
              </h2>
              <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.52)', margin: 0, lineHeight: 1.55 }}>
                Rate your SceneForge experience — takes under 30 seconds.
              </p>
            </div>

            {/* Body */}
            <div style={{ padding: '24px 28px 28px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 2px' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>
                  Your rating
                </span>
                <span style={{
                  fontSize: 12, fontWeight: 700, letterSpacing: '0.03em',
                  color: rating ? COLORS[rating - 1] : 'transparent',
                  transition: 'color 0.2s',
                }}>
                  {rating ? LABELS[rating - 1] : '—'}
                </span>
              </div>

              {/* Emoji tiles */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                {EMOJIS.map((emoji, i) => {
                  const v = i + 1
                  const selected = v <= rating
                  const dimmed = rating > 0 && !selected
                  return (
                    <button
                      key={v}
                      onClick={() => selectRating(v)}
                      aria-label={LABELS[i]}
                      style={{
                        flex: 1, aspectRatio: '1', borderRadius: 14,
                        background: selected ? 'rgba(124,92,255,0.18)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${selected ? 'rgba(167,139,250,0.35)' : 'rgba(255,255,255,0.08)'}`,
                        fontSize: 26, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transform: selected ? 'scale(1.12)' : 'scale(1)',
                        filter: dimmed ? 'grayscale(0.7) opacity(0.4)' : 'none',
                        transition: 'all 0.2s',
                      }}
                    >{emoji}</button>
                  )
                })}
              </div>

              {/* Scale labels */}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 2px', marginBottom: 20 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>Very poor</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>Excellent</span>
              </div>

              {/* Progress bar */}
              <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 100, marginBottom: 24, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 100,
                  width: `${rating / 5 * 100}%`,
                  background: 'linear-gradient(90deg,#7C5CFF,#2DD4BF)',
                  transition: 'width 0.4s cubic-bezier(0.34,1.56,0.64,1)',
                }} />
              </div>

              <button
                onClick={goDetails}
                disabled={!rating}
                style={{
                  width: '100%', padding: '13px', borderRadius: 12,
                  background: rating ? 'linear-gradient(135deg,#7C5CFF,#5B3FE0)' : 'rgba(255,255,255,0.06)',
                  color: rating ? '#fff' : 'rgba(255,255,255,0.25)',
                  border: rating ? 'none' : '1px solid rgba(255,255,255,0.07)',
                  fontSize: 14, fontWeight: 700, cursor: rating ? 'pointer' : 'not-allowed',
                  letterSpacing: '0.02em', minHeight: 44,
                  boxShadow: rating ? '0 8px 24px rgba(124,92,255,0.25)' : 'none',
                  transition: 'all 0.2s',
                }}
              >
                Continue →
              </button>
              <button
                onClick={handleClose}
                style={{
                  width: '100%', marginTop: 10, padding: '9px',
                  background: 'none', border: 'none',
                  color: 'rgba(255,255,255,0.28)', fontSize: 12.5, cursor: 'pointer', minHeight: 36,
                }}
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: DETAILS ── */}
        {step === 'details' && (
          <div style={{
            background: 'linear-gradient(180deg,#16141f 0%,#111118 100%)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 24, overflow: 'hidden',
            boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,92,255,0.08)',
          }}>
            <div style={{
              background: 'linear-gradient(135deg,rgba(124,92,255,0.12) 0%,rgba(45,212,191,0.06) 100%)',
              padding: '24px 28px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              position: 'relative',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 1,
                background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.5),transparent)',
              }} />
              <button
                onClick={() => setStep('rating')}
                aria-label="Back"
                style={{
                  position: 'absolute', top: 16, right: 16,
                  width: 30, height: 30, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(255,255,255,0.4)', fontSize: 13, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >←</button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[1,2,3,4,5].map(n => (
                    <span key={n} style={{ fontSize: 14, color: n <= rating ? '#F59E0B' : 'rgba(255,255,255,0.15)' }}>★</span>
                  ))}
                </div>
                <span style={{ fontSize: 22 }}>{EMOJIS[rating - 1]}</span>
              </div>
              <h2 style={{ fontSize: 19, fontWeight: 800, color: '#fff', margin: '0 0 4px', letterSpacing: '-0.4px', fontFamily: 'Syne, system-ui, sans-serif' }}>
                Tell us more
              </h2>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.50)', margin: 0 }}>
                What made your experience stand out?
              </p>
            </div>

            <div style={{ padding: '22px 28px 28px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 12px' }}>
                Select all that apply
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                {TAGS.map((tag) => {
                  const active = tags.includes(tag)
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      style={{
                        padding: '7px 14px', borderRadius: 100,
                        fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                        border: `1px solid ${active ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.09)'}`,
                        background: active ? 'rgba(167,139,250,0.14)' : 'rgba(255,255,255,0.04)',
                        color: active ? '#C4B5FD' : 'rgba(255,255,255,0.60)',
                        minHeight: 34, transition: 'all 0.15s',
                      }}
                    >
                      {active ? '✓ ' : ''}{tag}
                    </button>
                  )
                })}
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 14, overflow: 'hidden', marginBottom: 20,
              }}>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="What can we improve? What did you love? (optional)"
                  rows={3}
                  style={{
                    width: '100%', background: 'transparent', border: 'none',
                    color: 'rgba(255,255,255,0.85)', fontSize: 13.5,
                    padding: '14px 16px', outline: 'none', resize: 'none',
                    lineHeight: 1.65, boxSizing: 'border-box', fontFamily: 'inherit',
                  }}
                />
              </div>

              <button
                onClick={submit}
                disabled={submitting}
                style={{
                  width: '100%', padding: '13px',
                  background: 'linear-gradient(135deg,#7C5CFF,#5B3FE0)',
                  color: '#fff', border: 'none', borderRadius: 12,
                  fontSize: 14, fontWeight: 700,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  letterSpacing: '0.02em', minHeight: 44,
                  boxShadow: '0 8px 24px rgba(124,92,255,0.25)',
                  opacity: submitting ? 0.7 : 1, transition: 'all 0.2s',
                }}
              >
                {submitting ? 'Sending…' : 'Submit feedback'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: DONE ── */}
        {step === 'done' && (
          <div style={{
            background: 'linear-gradient(180deg,#16141f 0%,#111118 100%)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 24, overflow: 'hidden',
            boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,92,255,0.08)',
            textAlign: 'center', padding: '48px 28px',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 1,
              background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.5),transparent)',
            }} />
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 20 }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: 'linear-gradient(135deg,rgba(124,92,255,0.2),rgba(45,212,191,0.15))',
                border: '1px solid rgba(167,139,250,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 36, margin: '0 auto',
              }}>🙏</div>
              <div style={{
                position: 'absolute', inset: -8, borderRadius: '50%',
                border: '1px solid rgba(167,139,250,0.12)',
              }} />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 10px', letterSpacing: '-0.5px', fontFamily: 'Syne, system-ui, sans-serif' }}>
              Thank you!
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65, margin: '0 0 28px', maxWidth: 280, marginLeft: 'auto', marginRight: 'auto' }}>
              Your feedback helps us make SceneForge better for every creator.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 6 }}>
              {['#7C5CFF','#A78BFA','#2DD4BF'].map((c, i) => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: '50%', background: c,
                  display: 'inline-block',
                  animation: `sfpulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.25)', margin: 0 }}>Closing automatically…</p>
            <style>{`
              @keyframes sfpulse {
                0%,100% { opacity:0.3; transform:scale(0.8); }
                50% { opacity:1; transform:scale(1.2); }
              }
            `}</style>
          </div>
        )}
      </div>
    </div>
  )
}
