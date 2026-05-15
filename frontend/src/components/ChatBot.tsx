import { useState, useRef, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  loading?: boolean
}

const STEP_GREETINGS: Record<string, { title: string; sub: string }> = {
  setup:  { title: "Let's set up your video!",        sub: "I can suggest niches, styles, and platforms that perform well right now." },
  ideas:  { title: "Ideas are ready!",                  sub: "I can analyse each idea and tell you which one will perform best for your niche and platform." },
  script: { title: "Your script is looking good!",    sub: "Want me to sharpen the hook, shorten it, or make it more emotional?" },
  scenes: { title: "Scenes are ready to edit.",       sub: "I can spot pacing issues and suggest stronger visual prompts per scene." },
  voice:  { title: "Almost ready to render!",         sub: "I can recommend the best voice and music combo for your niche and platform." },
  export: { title: "Ready to render!",                sub: "I can help you improve retention or make the edit more cinematic." },
  upload: { title: "Uploading your own content.",     sub: "Ask me anything about the upload workflow or how to improve your footage." },
  plans:  { title: "Exploring plans?",                sub: "I can help you pick the right plan for how many videos you create per day." },
}

const STEP_ACTIONS: Record<string, Array<{ label: string; prompt: string; icon: string }>> = {
  setup: [
    { label: 'Best niche right now',     prompt: 'What content niche is performing best on TikTok and YouTube Shorts right now?', icon: '📈' },
    { label: 'Platform advice',          prompt: 'Which platform should I choose for my niche and why?', icon: '📱' },
    { label: 'Style for my niche',       prompt: 'What video style works best for my chosen niche?', icon: '🎬' },
  ],
  ideas: [
    { label: 'Pick the best idea',       prompt: 'Based on the ideas I generated, which one will perform best on my platform and niche? Be specific about why.', icon: '🏆' },
    { label: 'Compare all ideas',        prompt: 'Compare all the ideas I generated. Give each a score out of 10 for viral potential and explain your reasoning.', icon: '📊' },
    { label: 'Improve the hooks',        prompt: 'For each of my generated ideas, suggest a stronger hook that stops the scroll in 3 seconds.', icon: '⚡' },
    { label: 'Which is most unique',     prompt: 'Which of my generated ideas is the most unique and least likely to be duplicated by competitors?', icon: '💎' },
  ],
  script: [
    { label: 'Improve hook',             prompt: 'Rewrite my script hook to be more attention-grabbing in the first 3 seconds.', icon: '⚡' },
    { label: 'Shorten script',           prompt: 'Shorten my script while keeping all the key points. Remove filler words.', icon: '✂️' },
    { label: 'Make emotional',           prompt: 'Add more emotional language to my script to connect with viewers.', icon: '❤️' },
    { label: 'Stronger CTA',             prompt: 'Write a stronger call to action for the end of my script.', icon: '📣' },
    { label: 'Add suspense',             prompt: 'Add a suspense or cliffhanger moment to keep viewers watching to the end.', icon: '😮' },
  ],
  scenes: [
    { label: 'Check pacing',             prompt: 'Review my scene durations. Are any scenes too long or too short for my platform?', icon: '⏱️' },
    { label: 'Better visual prompts',    prompt: 'Suggest more cinematic and engaging visual prompts for each of my scenes.', icon: '🖼️' },
    { label: 'Subtitle tips',            prompt: 'What subtitle style and placement works best for my platform?', icon: '💬' },
    { label: 'Scene order',              prompt: 'Is my scene order optimal for viewer retention? Should I reorder anything?', icon: '🔀' },
  ],
  voice: [
    { label: 'Best voice for niche',     prompt: 'Which voice should I use for my niche and platform to sound most credible?', icon: '🎙️' },
    { label: 'Music recommendation',     prompt: 'What background music style fits my niche and video tone best?', icon: '🎵' },
    { label: 'Motion advice',            prompt: 'Should I use Ken Burns zoom, pan, or static for this type of content?', icon: '🎥' },
    { label: 'Visual source tip',        prompt: 'Should I use stock video, stock photos, or AI images for my niche?', icon: '📸' },
  ],
  export: [
    { label: 'Improve retention',        prompt: 'How can I improve viewer retention in my video before I render it?', icon: '📊' },
    { label: 'More cinematic',           prompt: 'What settings should I use to make my video look more cinematic?', icon: '🎞️' },
    { label: 'Best time to post',        prompt: 'When is the best time to post this type of content on my platform?', icon: '🕐' },
    { label: 'Caption and hashtags',     prompt: 'Write an engaging caption and relevant hashtags for my video.', icon: '#️⃣' },
  ],
}

const DEFAULT_ACTIONS = [
  { label: 'How does SceneForge work', prompt: 'Give me a quick overview of how SceneForge works from start to finish.', icon: '🚀' },
  { label: 'What does my plan include', prompt: 'What features and limits does my current plan include?', icon: '📋' },
  { label: 'Render troubleshooting',   prompt: 'My render failed. What are the most common causes and fixes?', icon: '🔧' },
]

let msgId = 0

export default function ChatBot() {
  const currentStep    = useStore((s) => s.currentStep)
  const config         = useStore((s) => s.config)
  const scenes         = useStore((s) => s.scenes)
  const script         = useStore((s) => s.script)
  const ideas          = useStore((s) => s.ideas)
  const selectedIdea   = useStore((s) => s.selectedIdea)
  const projects       = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)

  const activeProject = projects.find(p => p.id === activeProjectId)
  const stepInfo      = STEP_GREETINGS[currentStep] || STEP_GREETINGS['setup']
  const stepActions   = STEP_ACTIONS[currentStep]   || DEFAULT_ACTIONS

  const getGreeting = useCallback(() => {
    if (currentStep === 'ideas' && ideas.length > 0) {
      return { title: `${ideas.length} ideas generated!`, sub: 'Ask me which one will perform best — I can analyse all of them for you.' }
    }
    if (currentStep === 'script' && config.niche) {
      return { title: `Script ready for ${config.niche}!`, sub: stepInfo.sub }
    }
    if (currentStep === 'scenes' && scenes.length > 0) {
      return { title: `${scenes.length} scenes loaded — looking good!`, sub: stepInfo.sub }
    }
    return stepInfo
  }, [currentStep, config.niche, scenes.length, ideas.length, stepInfo])

  const buildContext = useCallback(() => {
    const parts: string[] = []
    if (activeProject?.name)  parts.push(`Project: "${activeProject.name}"`)
    if (currentStep)           parts.push(`Current step: ${currentStep}`)
    if (config.niche)          parts.push(`Niche: ${config.niche}`)
    if (config.style)          parts.push(`Style: ${config.style}`)
    if (config.platform)       parts.push(`Platform: ${config.platform}`)
    if (config.tone)           parts.push(`Tone: ${config.tone}`)
    if (ideas.length > 0) {
      const ideaList = ideas.map((idea, i) =>
        `${i+1}. "${idea.title}" — Hook: ${idea.hook} | Angle: ${idea.angle}`
      ).join(' || ')
      parts.push(`Generated ideas (${ideas.length} total): ${ideaList}`)
    }
    if (selectedIdea) parts.push(`Selected idea: "${selectedIdea.title}" — ${selectedIdea.hook}`)
    if (scenes.length > 0)     parts.push(`Scenes: ${scenes.length} scenes, est. ${scenes.reduce((s,sc)=>s+(sc.duration||0),0)}s total`)
    if (script?.length > 20)   parts.push(`Script preview: "${script.slice(0,120)}..."`)
    return parts.join(' | ')
  }, [activeProject, currentStep, config, scenes, script, ideas, selectedIdea])

  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [unread, setUnread]     = useState(0)
  const [pulse, setPulse]       = useState(false)
  const bottomRef               = useRef<HTMLDivElement>(null)
  const inputRef                = useRef<HTMLInputElement>(null)
  const prevStepRef             = useRef(currentStep)

  // Initial greeting message
  useEffect(() => {
    const g = getGreeting()
    setMessages([{
      id: ++msgId,
      role: 'assistant',
      content: `${g.title}\n\n${g.sub}`,
    }])
  }, [])

  // Step change — inject a context-aware message
  useEffect(() => {
    if (prevStepRef.current === currentStep) return
    prevStepRef.current = currentStep
    const g = getGreeting()
    const newMsg: Message = {
      id: ++msgId,
      role: 'assistant',
      content: `${g.title}\n\n${g.sub}`,
    }
    setMessages(prev => [...prev, newMsg])
    if (!open) setUnread(n => n + 1)
  }, [currentStep])

  // Pulse every 25 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (!open) {
        setPulse(true)
        setTimeout(() => setPulse(false), 2000)
      }
    }, 25000)
    return () => clearInterval(interval)
  }, [open])

  useEffect(() => {
    if (open) {
      setUnread(0)
      setTimeout(() => {
        inputRef.current?.focus()
        bottomRef.current?.scrollIntoView({ behavior: 'instant' })
      }, 50)
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(text?: string) {
    const content = (text || input).trim()
    if (!content || loading) return
    setInput('')

    const userMsg: Message    = { id: ++msgId, role: 'user', content }
    const loadingMsg: Message = { id: ++msgId, role: 'assistant', content: '', loading: true }
    setMessages(prev => [...prev, userMsg, loadingMsg])
    setLoading(true)

    try {
      const ctx = buildContext()
      const history = [...messages, userMsg]
        .filter(m => !m.loading)
        .map(m => ({ role: m.role, content: m.content }))

      const { data } = await api.post('/api/chat/message', {
        messages: history,
        context: ctx,
      })

      const reply = data.reply || 'Sorry, I could not get a response.'
      setMessages(prev => prev.map(m => m.loading ? { ...m, loading: false, content: reply } : m))
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
    return text.split('\n').map((line, i) => {
      const t = line.trim()
      if (!t) return <div key={i} style={{ height: 6 }} />
      if (t.startsWith('- ') || t.startsWith('• ')) {
        return (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
            <span style={{ color: '#A78BFA', flexShrink: 0 }}>•</span>
            <span dangerouslySetInnerHTML={{ __html: t.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
          </div>
        )
      }
      return <div key={i} style={{ marginBottom: 3 }} dangerouslySetInnerHTML={{ __html: t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
    })
  }

  const greeting = getGreeting()

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Open SceneForge co-pilot"
        style={{
          position: 'fixed', bottom: 24, right: 16, zIndex: 9990,
          width: 52, height: 52, borderRadius: '50%',
          background: open ? '#5B3FE0' : 'linear-gradient(135deg,#7C5CFF,#5B3FE0)',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(124,92,255,0.4)',
          transition: 'transform 0.2s, box-shadow 0.2s',
          transform: pulse ? 'scale(1.1)' : 'scale(1)',
        }}
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round">
            <path d="M3 3l10 10M13 3L3 13"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
            <path d="M12 2C6.48 2 2 5.82 2 10.5c0 2.4 1.14 4.57 3 6.11V21l4.14-2.07A11.3 11.3 0 0012 19c5.52 0 10-3.82 10-8.5S17.52 2 12 2z"/>
            <circle cx="8" cy="10.5" r="1" fill="white"/>
            <circle cx="12" cy="10.5" r="1" fill="white"/>
            <circle cx="16" cy="10.5" r="1" fill="white"/>
          </svg>
        )}
        {/* Pulse ring */}
        {pulse && !open && (
          <div style={{
            position: 'absolute', inset: -5, borderRadius: '50%',
            border: '2px solid rgba(124,92,255,0.5)',
            animation: 'sfPulseRing 1.5s ease-out',
            pointerEvents: 'none',
          }} />
        )}
        {unread > 0 && !open && (
          <div style={{
            position: 'absolute', top: -3, right: -3,
            width: 18, height: 18, borderRadius: '50%',
            background: '#F87171', color: '#fff',
            fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #07070E',
          }}>{unread > 9 ? '9+' : unread}</div>
        )}
      </button>

      {/* Co-pilot panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 86, right: 16, zIndex: 9989,
          width: 'min(380px, calc(100vw - 32px))',
          maxHeight: '80vh',
          background: '#111118',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'sfChatIn 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        }}>

          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg,rgba(124,92,255,0.15),rgba(45,212,191,0.06))',
            padding: '13px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', gap: 10,
            position: 'relative', flexShrink: 0,
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.4),transparent)' }} />
            {/* Avatar with pulse ring */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: 'linear-gradient(135deg,#7C5CFF,#2DD4BF)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15,
              }}>✦</div>
              <div style={{
                position: 'absolute', inset: -3, borderRadius: '50%',
                border: '1.5px solid rgba(167,139,250,0.4)',
                animation: 'sfAvatarPulse 2.5s ease-in-out infinite',
              }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>SceneForge Co-pilot</div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#34D399', display: 'inline-block' }} />
                {currentStep ? `On ${currentStep} step` : 'Ready to help'}
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '50%', width: 26, height: 26, cursor: 'pointer', color: 'rgba(255,255,255,0.5)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Close">×</button>
          </div>

          {/* Context strip */}
          {(config.niche || activeProject?.name) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px',
              background: 'rgba(255,255,255,0.03)',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              flexWrap: 'wrap', flexShrink: 0,
            }}>
              {activeProject?.name && (
                <span style={{ fontSize: 10.5, color: 'rgba(167,139,250,0.8)', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 100, padding: '2px 8px' }}>
                  📁 {activeProject.name.slice(0, 24)}{activeProject.name.length > 24 ? '…' : ''}
                </span>
              )}
              {config.niche && (
                <span style={{ fontSize: 10.5, color: 'rgba(45,212,191,0.8)', background: 'rgba(45,212,191,0.08)', border: '1px solid rgba(45,212,191,0.2)', borderRadius: 100, padding: '2px 8px' }}>
                  {config.niche}
                </span>
              )}
              {config.platform && (
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', padding: '2px 4px' }}>
                  {config.platform.split(' ')[0]}
                </span>
              )}
            </div>
          )}

          {/* Step greeting */}
          <div style={{ padding: '12px 14px 6px', flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 3 }}>{greeting.title}</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{greeting.sub}</div>
          </div>

          {/* Quick actions */}
          <div style={{ padding: '6px 14px 10px', display: 'flex', flexWrap: 'wrap', gap: 5, flexShrink: 0 }}>
            {stepActions.map(a => (
              <button
                key={a.label}
                onClick={() => send(a.prompt)}
                disabled={loading}
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 100,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
                  transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <span>{a.icon}</span>{a.label}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '10px 14px 6px',
            display: 'flex', flexDirection: 'column', gap: 10,
            minHeight: 120,
          }}>
            {messages.map(msg => (
              <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {msg.role === 'assistant' && (
                  <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg,#7C5CFF,#2DD4BF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, marginRight: 7, marginTop: 2 }}>✦</div>
                )}
                <div style={{
                  maxWidth: '82%', padding: '8px 11px',
                  borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: msg.role === 'user' ? 'linear-gradient(135deg,#7C5CFF,#5B3FE0)' : 'rgba(255,255,255,0.06)',
                  border: msg.role === 'assistant' ? '1px solid rgba(255,255,255,0.07)' : 'none',
                  fontSize: 12.5, color: '#F0F0FF', lineHeight: 1.55,
                }}>
                  {msg.loading ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 0' }}>
                      {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(167,139,250,0.7)', animation: `sfDot 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5 }}>{formatContent(msg.content)}</div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '9px 12px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask anything — I know your current step..."
              disabled={loading}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 10, color: '#F0F0FF', fontSize: 12.5,
                padding: '9px 12px', outline: 'none', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              aria-label="Send"
              style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: input.trim() && !loading ? 'linear-gradient(135deg,#7C5CFF,#5B3FE0)' : 'rgba(255,255,255,0.07)',
                border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={input.trim() && !loading ? '#fff' : 'rgba(255,255,255,0.3)'} strokeWidth="2" strokeLinecap="round">
                <path d="M14 8H2M9 3l5 5-5 5"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes sfChatIn { from { opacity:0; transform:translateY(12px) scale(0.97); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes sfDot { 0%,100% { opacity:.3; transform:scale(.8); } 50% { opacity:1; transform:scale(1.2); } }
        @keyframes sfPulseRing { 0% { transform:scale(1); opacity:.6; } 100% { transform:scale(1.8); opacity:0; } }
        @keyframes sfAvatarPulse { 0%,100% { opacity:.3; transform:scale(1); } 50% { opacity:.7; transform:scale(1.1); } }
      `}</style>
    </>
  )
}
