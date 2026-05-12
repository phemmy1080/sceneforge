import { useState, useRef, useEffect } from 'react'
import { api } from '../lib/api'

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  loading?: boolean
}

const SUGGESTIONS = [
  'How do I create my first video?',
  'What does each plan include?',
  'Why did my render fail?',
  'How do I use CapCut export?',
  'What are topic hints?',
]

let msgId = 0

export default function ChatBot() {
  const [open, setOpen]       = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: ++msgId,
      role: 'assistant',
      content: "Hi! I'm your SceneForge assistant 👋\n\nAsk me anything about creating videos, your plan, or how features work.",
    },
  ])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const [unread, setUnread]   = useState(0)
  const bottomRef             = useRef<HTMLDivElement>(null)
  const inputRef              = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setUnread(0)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(text?: string) {
    const content = (text || input).trim()
    if (!content || loading) return
    setInput('')

    const userMsg: Message = { id: ++msgId, role: 'user', content }
    const loadingMsg: Message = { id: ++msgId, role: 'assistant', content: '', loading: true }

    setMessages(prev => [...prev, userMsg, loadingMsg])
    setLoading(true)

    try {
      const history = [...messages, userMsg]
        .filter(m => !m.loading)
        .map(m => ({ role: m.role, content: m.content }))

      const { data } = await api.post('/api/chat/message', { messages: history })
      const reply = data.reply || 'Sorry, I could not get a response.'

      setMessages(prev => prev.map(m =>
        m.loading ? { ...m, loading: false, content: reply } : m
      ))
      if (!open) setUnread(n => n + 1)
    } catch {
      setMessages(prev => prev.map(m =>
        m.loading ? { ...m, loading: false, content: 'Something went wrong. Please try again.' } : m
      ))
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function formatContent(text: string) {
    // Convert markdown-style bullets and bold to JSX
    return text.split('\n').map((line, i) => {
      const trimmed = line.trim()
      if (!trimmed) return <div key={i} style={{ height: 6 }} />
      if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
        return (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
            <span style={{ color: '#A78BFA', flexShrink: 0, marginTop: 1 }}>•</span>
            <span dangerouslySetInnerHTML={{ __html: trimmed.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
          </div>
        )
      }
      return (
        <div key={i} style={{ marginBottom: 3 }}
          dangerouslySetInnerHTML={{ __html: trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }}
        />
      )
    })
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Open SceneForge assistant"
        style={{
          position: 'fixed', bottom: 24, right: 16, zIndex: 9990,
          width: 52, height: 52, borderRadius: '50%',
          background: open ? '#5B3FE0' : 'linear-gradient(135deg,#7C5CFF,#5B3FE0)',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(124,92,255,0.45)',
          transition: 'all 0.2s',
        }}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <path d="M3 3l10 10M13 3L3 13"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5">
            <path d="M14 2H2a1 1 0 00-1 1v8a1 1 0 001 1h3l3 3 3-3h3a1 1 0 001-1V3a1 1 0 00-1-1z"/>
            <path d="M5 7h6M5 5h4"/>
          </svg>
        )}
        {unread > 0 && !open && (
          <div style={{
            position: 'absolute', top: -3, right: -3,
            width: 18, height: 18, borderRadius: '50%',
            background: '#F87171', color: '#fff',
            fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #07070E',
          }}>{unread}</div>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 86, right: 16, zIndex: 9989,
          width: 'min(360px, calc(100vw - 32px))', maxHeight: '70vh',
          background: 'linear-gradient(180deg,#16141f 0%,#111118 100%)',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 20,
          boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,92,255,0.1)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'sfChatIn 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        }}>

          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg,rgba(124,92,255,0.18),rgba(45,212,191,0.08))',
            padding: '14px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', gap: 10,
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 1,
              background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.5),transparent)',
            }} />
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'linear-gradient(135deg,#7C5CFF,#2DD4BF)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, flexShrink: 0,
            }}>✦</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>SceneForge Assistant</div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#34D399', display: 'inline-block' }} />
                Online
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                marginLeft: 'auto', background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '50%',
                width: 26, height: 26, cursor: 'pointer', color: 'rgba(255,255,255,0.5)',
                fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              aria-label="Close"
            >×</button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '14px 14px 6px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            {messages.map(msg => (
              <div key={msg.id} style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                {msg.role === 'assistant' && (
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg,#7C5CFF,#2DD4BF)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, marginRight: 7, marginTop: 2, color: '#fff',
                  }}>✦</div>
                )}
                <div style={{
                  maxWidth: '82%',
                  padding: '9px 12px',
                  borderRadius: msg.role === 'user'
                    ? '14px 14px 4px 14px'
                    : '14px 14px 14px 4px',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg,#7C5CFF,#5B3FE0)'
                    : 'rgba(255,255,255,0.06)',
                  border: msg.role === 'assistant'
                    ? '1px solid rgba(255,255,255,0.08)' : 'none',
                  fontSize: 13, color: '#F0F0FF', lineHeight: 1.55,
                }}>
                  {msg.loading ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 0' }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: 'rgba(167,139,250,0.7)',
                          animation: `sfDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                        }} />
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13 }}>{formatContent(msg.content)}</div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Suggestions — only show when just the welcome message */}
          {messages.length === 1 && (
            <div style={{ padding: '4px 14px 8px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  style={{
                    fontSize: 11, padding: '5px 10px', borderRadius: 100,
                    background: 'rgba(167,139,250,0.1)',
                    border: '1px solid rgba(167,139,250,0.25)',
                    color: '#C4B5FD', cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >{s}</button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{
            padding: '10px 12px',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask anything about SceneForge..."
              disabled={loading}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 10, color: '#F0F0FF', fontSize: 13,
                padding: '9px 12px', outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              aria-label="Send message"
              style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: input.trim() && !loading
                  ? 'linear-gradient(135deg,#7C5CFF,#5B3FE0)'
                  : 'rgba(255,255,255,0.07)',
                border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
                stroke={input.trim() && !loading ? '#fff' : 'rgba(255,255,255,0.3)'}
                strokeWidth="2" strokeLinecap="round">
                <path d="M14 8H2M9 3l5 5-5 5"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes sfChatIn {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes sfDot {
          0%,100% { opacity: 0.3; transform: scale(0.8); }
          50%      { opacity: 1;   transform: scale(1.2); }
        }
      `}</style>
    </>
  )
}
