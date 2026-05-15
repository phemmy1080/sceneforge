// Inline UI mockups for the step-by-step blog post
// Each component renders a realistic screenshot of that SceneForge step

const SF_BG   = '#07070E'
const SF_CARD = '#111118'
const SF_BRD  = 'rgba(255,255,255,0.08)'
const SF_PUR  = '#7C5CFF'
const SF_TEAL = '#2DD4BF'
const SF_TXT  = '#F0F0FF'
const SF_MUT  = 'rgba(255,255,255,0.45)'
const SF_DIM  = 'rgba(255,255,255,0.2)'

const shell: React.CSSProperties = {
  background: SF_BG, borderRadius: 16, overflow: 'hidden',
  border: `1px solid ${SF_BRD}`, fontFamily: 'system-ui, sans-serif',
  marginBottom: 8,
}
const topbar: React.CSSProperties = {
  background: SF_CARD, borderBottom: `1px solid ${SF_BRD}`,
  padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6,
}
const dot = (c: string) => ({ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 as const })
const layout: React.CSSProperties = { display: 'flex', minHeight: 280 }
const sidebar: React.CSSProperties = {
  width: 140, background: SF_CARD, borderRight: `1px solid ${SF_BRD}`,
  padding: '12px 0', flexShrink: 0,
}
const main: React.CSSProperties = { flex: 1, padding: '16px 20px', overflow: 'hidden' }
const card = (extra?: React.CSSProperties): React.CSSProperties => ({
  background: SF_CARD, border: `1px solid ${SF_BRD}`, borderRadius: 12, padding: '12px 14px', ...extra
})
const chip = (active?: boolean, c?: string): React.CSSProperties => ({
  display: 'inline-block', padding: '4px 10px', borderRadius: 100, fontSize: 11,
  background: active ? (c || SF_PUR) + '22' : 'rgba(255,255,255,0.05)',
  border: `1px solid ${active ? (c || SF_PUR) + '44' : SF_BRD}`,
  color: active ? (c || SF_PUR) : SF_MUT, marginRight: 5, marginBottom: 5,
})
const btn = (primary?: boolean): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  background: primary ? SF_PUR : 'rgba(255,255,255,0.06)',
  border: `1px solid ${primary ? SF_PUR + '60' : SF_BRD}`,
  color: primary ? '#fff' : SF_MUT,
})
const label: React.CSSProperties = { fontSize: 10, color: SF_DIM, textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 5, fontWeight: 600 }
const inp: React.CSSProperties = { background: 'rgba(255,255,255,0.05)', border: `1px solid ${SF_BRD}`, borderRadius: 8, padding: '7px 10px', color: SF_TXT, fontSize: 12, width: '100%' }

function SidebarNav({ active }: { active: string }) {
  const steps = ['Setup','Ideas','Script','Scenes','Voice','Export']
  return (
    <div style={sidebar}>
      <div style={{ padding: '4px 12px 12px', fontSize: 14, fontWeight: 800, color: SF_TXT }}>
        Scene<span style={{ color: SF_PUR }}>Forge</span>
      </div>
      <div style={{ padding: '4px 8px', fontSize: 9, color: SF_DIM, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Workflow</div>
      {steps.map(s => (
        <div key={s} style={{
          padding: '6px 12px', fontSize: 12, cursor: 'pointer',
          color: s === active ? SF_PUR : SF_MUT,
          background: s === active ? SF_PUR + '15' : 'transparent',
          borderLeft: `2px solid ${s === active ? SF_PUR : 'transparent'}`,
        }}>{s}</div>
      ))}
    </div>
  )
}

function TopBar() {
  return (
    <div style={topbar}>
      <span style={dot('#FF5F57')} /><span style={dot('#FFBD2E')} /><span style={dot('#28CA41')} />
      <span style={{ fontSize: 11, color: SF_DIM, marginLeft: 6 }}>sceneraforge.com</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: SF_TEAL }} />
        <span style={{ fontSize: 11, color: SF_TEAL }}>Connected</span>
      </div>
    </div>
  )
}

export function Step1Setup() {
  return (
    <div style={shell}>
      <TopBar />
      <div style={layout}>
        <SidebarNav active="Setup" />
        <div style={main}>
          <div style={{ fontSize: 18, fontWeight: 800, color: SF_TXT, marginBottom: 4 }}>New project</div>
          <div style={{ fontSize: 12, color: SF_MUT, marginBottom: 16 }}>Configure your content — SceneForge generates everything from here</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: SF_PUR + '12', border: `1px solid ${SF_PUR}40`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: SF_PUR, animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 12, color: SF_PUR, fontWeight: 600 }}>No active project — click below to start</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={{ ...btn(true), flex: 1, textAlign: 'center' }}>+ New project</button>
            <button style={{ ...btn(), flex: 1, textAlign: 'center' }}>Open existing</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Step2Config() {
  return (
    <div style={shell}>
      <TopBar />
      <div style={layout}>
        <SidebarNav active="Setup" />
        <div style={{ ...main, overflowY: 'auto' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: SF_TXT, marginBottom: 14 }}>Configure your project</div>
          <div style={{ ...card(), marginBottom: 12 }}>
            <div style={label}>Content niche</div>
            <div>
              {['Finance','Fitness','Tech','Lifestyle','Business','Education'].map((n,i) => (
                <span key={n} style={chip(i===0)}>{n}</span>
              ))}
            </div>
          </div>
          <div style={{ ...card(), marginBottom: 12 }}>
            <div style={label}>Video style</div>
            <div>
              {['Educational','Viral / Hook-first','Storytelling','Listicle'].map((s,i) => (
                <span key={s} style={chip(i===1, SF_TEAL)}>{s}</span>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div style={card()}>
              <div style={label}>Platform</div>
              <div style={{ fontSize: 12, color: SF_PUR, fontWeight: 600 }}>TikTok (9:16, 60s)</div>
            </div>
            <div style={card()}>
              <div style={label}>Tone</div>
              <div style={{ fontSize: 12, color: SF_TEAL, fontWeight: 600 }}>Energetic & punchy</div>
            </div>
          </div>
          <button style={{ ...btn(true), width: '100%', textAlign: 'center' }}>Generate ideas →</button>
        </div>
      </div>
    </div>
  )
}

export function Step3Ideas() {
  const ideas = [
    { title: '5 investing mistakes costing you millions', hook: 'You\'re making this mistake right now...' },
    { title: 'Start investing with ₦5,000 today', hook: 'Most people think they need thousands. They\'re wrong.' },
    { title: 'The investment app no one talks about', hook: 'Nigerian banks don\'t want you to know this.' },
  ]
  return (
    <div style={shell}>
      <TopBar />
      <div style={layout}>
        <SidebarNav active="Ideas" />
        <div style={main}>
          <div style={{ fontSize: 16, fontWeight: 700, color: SF_TXT, marginBottom: 4 }}>Choose your idea</div>
          <div style={{ fontSize: 11, color: SF_MUT, marginBottom: 14 }}>6 viral ideas generated for Finance · Viral/Hook-first · TikTok</div>
          {ideas.map((idea, i) => (
            <div key={i} style={{ ...card({ marginBottom: 8, cursor: 'pointer', borderColor: i === 1 ? SF_PUR + '60' : SF_BRD, background: i === 1 ? SF_PUR + '08' : SF_CARD }) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: i === 1 ? SF_PUR : 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: i === 1 ? '#fff' : SF_DIM }}>
                  {i === 1 ? '✓' : i + 1}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: i === 1 ? SF_TXT : SF_MUT }}>{idea.title}</div>
              </div>
              <div style={{ fontSize: 11, color: SF_DIM, paddingLeft: 28 }}>Hook: "{idea.hook}"</div>
            </div>
          ))}
          <div style={{ fontSize: 11, color: SF_DIM, textAlign: 'center', marginBottom: 10 }}>+ 3 more ideas</div>
          <button style={{ ...btn(true), width: '100%', textAlign: 'center' }}>Write script →</button>
        </div>
      </div>
    </div>
  )
}

export function Step4Script() {
  return (
    <div style={shell}>
      <TopBar />
      <div style={layout}>
        <SidebarNav active="Script" />
        <div style={main}>
          <div style={{ fontSize: 16, fontWeight: 700, color: SF_TXT, marginBottom: 14 }}>Your AI script</div>
          <div style={{ ...card(), marginBottom: 12, position: 'relative' }}>
            <div style={{ fontSize: 12, color: SF_TXT, lineHeight: 1.7 }}>
              <span style={{ color: SF_PUR, fontWeight: 600 }}>Hook: </span>
              Most people think investing requires thousands of naira. They're completely wrong — and that belief is costing them years of wealth.<br /><br />
              <span style={{ color: SF_TEAL, fontWeight: 600 }}>Body: </span>
              With just ₦5,000 you can start building real wealth today. Here are three moves that actually work for Nigerian investors right now...<br /><br />
              <span style={{ color: '#F59E0B', fontWeight: 600 }}>CTA: </span>
              Save this video. Follow for daily money moves that work.
            </div>
            <div style={{ position: 'absolute', bottom: 12, right: 12, width: 8, height: 16, background: SF_TXT, borderRadius: 1, animation: 'blink 1s infinite' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ fontSize: 11, color: SF_MUT, background: 'rgba(255,255,255,0.04)', border: `1px solid ${SF_BRD}`, borderRadius: 8, padding: '5px 10px' }}>4 scenes · ~55s</div>
            <div style={{ fontSize: 11, color: SF_MUT, background: 'rgba(255,255,255,0.04)', border: `1px solid ${SF_BRD}`, borderRadius: 8, padding: '5px 10px' }}>Finance · TikTok</div>
            <button style={{ ...btn(true), marginLeft: 'auto' }}>Continue to scenes →</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Step5Scenes() {
  const scenes = [
    { n: 1, text: 'Most people think investing requires thousands...', dur: '8s', visual: 'Close-up of Nigerian naira notes on desk' },
    { n: 2, text: 'With just ₦5,000 you can start today...', dur: '14s', visual: 'Young professional using finance app on phone' },
    { n: 3, text: 'Here are 3 moves that work right now...', dur: '22s', visual: 'Stock market chart on laptop screen' },
    { n: 4, text: 'Save this. Follow for daily money tips.', dur: '8s', visual: 'Person celebrating financial success' },
  ]
  return (
    <div style={shell}>
      <TopBar />
      <div style={layout}>
        <SidebarNav active="Scenes" />
        <div style={main}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: SF_TXT }}>Scene editor</div>
            <div style={{ fontSize: 11, color: SF_TEAL }}>4 scenes · 52s total</div>
          </div>
          {scenes.map(sc => (
            <div key={sc.n} style={{ ...card({ marginBottom: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }) }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: SF_PUR + '22', border: `1px solid ${SF_PUR}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: SF_PUR, flexShrink: 0 }}>{sc.n}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: SF_TXT, marginBottom: 4 }}>{sc.text}</div>
                <div style={{ fontSize: 11, color: SF_DIM }}>🎬 {sc.visual}</div>
              </div>
              <div style={{ fontSize: 11, color: SF_MUT, background: 'rgba(255,255,255,0.05)', padding: '3px 8px', borderRadius: 6 }}>{sc.dur}</div>
            </div>
          ))}
          <button style={{ ...btn(true), width: '100%', textAlign: 'center', marginTop: 4 }}>Voice & visuals →</button>
        </div>
      </div>
    </div>
  )
}

export function Step6Voice() {
  return (
    <div style={shell}>
      <TopBar />
      <div style={layout}>
        <SidebarNav active="Voice" />
        <div style={main}>
          <div style={{ fontSize: 16, fontWeight: 700, color: SF_TXT, marginBottom: 14 }}>Voice & visuals</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div style={card()}>
              <div style={label}>Neural voice</div>
              {['Marcus','David','Amara','Zara'].map((v,i) => (
                <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < 3 ? `1px solid ${SF_BRD}` : 'none' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: i === 0 ? SF_PUR : SF_DIM }} />
                  <span style={{ fontSize: 12, color: i === 0 ? SF_TXT : SF_MUT }}>{v}</span>
                  {i === 0 && <span style={{ fontSize: 10, color: SF_PUR, marginLeft: 'auto' }}>▶ Playing</span>}
                </div>
              ))}
            </div>
            <div style={card()}>
              <div style={label}>Visual source</div>
              {['Mixed (Pexels + AI)','Stock video','Stock photos','AI images 🔒'].map((v,i) => (
                <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < 3 ? `1px solid ${SF_BRD}` : 'none' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: i === 0 ? SF_TEAL : SF_DIM }} />
                  <span style={{ fontSize: 11, color: i === 0 ? SF_TXT : SF_MUT }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div style={card()}>
              <div style={label}>Cinematic motion</div>
              <div style={{ fontSize: 12, color: SF_PUR }}>✦ Auto (Ken Burns + Pan)</div>
            </div>
            <div style={card()}>
              <div style={label}>Background music</div>
              <div style={{ fontSize: 12, color: SF_TEAL }}>♪ Corporate</div>
            </div>
          </div>
          <button style={{ ...btn(true), width: '100%', textAlign: 'center', fontSize: 13 }}>Render video →</button>
        </div>
      </div>
    </div>
  )
}

export function Step7Export() {
  return (
    <div style={shell}>
      <TopBar />
      <div style={layout}>
        <SidebarNav active="Export" />
        <div style={main}>
          <div style={{ fontSize: 16, fontWeight: 700, color: SF_TXT, marginBottom: 14 }}>Export</div>
          <div style={{ ...card({ marginBottom: 14 }) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12 }}>
              <span style={{ color: SF_TEAL, fontWeight: 600 }}>✓ Render complete</span>
              <span style={{ color: SF_MUT }}>52s · TikTok 9:16</span>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, aspectRatio: '9/16', maxHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${SF_BRD}`, marginBottom: 10 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>▶</div>
                <div style={{ fontSize: 11, color: SF_MUT }}>Your video is ready</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...btn(true), flex: 1, textAlign: 'center', fontSize: 12 }}>⬇ Download MP4</button>
              <button style={{ ...btn(), flex: 1, textAlign: 'center', fontSize: 12 }}>CapCut bundle</button>
            </div>
          </div>
          <div style={{ ...card() }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: SF_TXT, marginBottom: 8 }}>Render stages completed</div>
            {['Voice synthesis','Visual matching','Scene compositing','Music mixing','Final export'].map(s => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: SF_TEAL + '22', border: `1px solid ${SF_TEAL}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: SF_TEAL }}>✓</div>
                <span style={{ fontSize: 11, color: SF_MUT }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function Step8Share() {
  return (
    <div style={shell}>
      <TopBar />
      <div style={layout}>
        <SidebarNav active="Export" />
        <div style={main}>
          <div style={{ fontSize: 16, fontWeight: 700, color: SF_TXT, marginBottom: 4 }}>Share your video</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {['TikTok','YouTube','Instagram','LinkedIn'].map((p,i) => (
              <div key={p} style={{ padding: '5px 10px', borderRadius: 8, fontSize: 11, background: i === 0 ? SF_PUR + '15' : 'rgba(255,255,255,0.04)', border: `1px solid ${i === 0 ? SF_PUR + '40' : SF_BRD}`, color: i === 0 ? SF_PUR : SF_MUT, cursor: 'pointer' }}>{p}</div>
            ))}
          </div>
          <div style={{ ...card({ marginBottom: 10 }) }}>
            <div style={{ fontSize: 11, color: SF_DIM, marginBottom: 6 }}>AI-generated caption · TikTok</div>
            <div style={{ fontSize: 12, color: SF_TXT, lineHeight: 1.6, marginBottom: 8 }}>
              Most people think investing requires thousands. They're WRONG. 💰<br />
              Here's how to start with ₦5,000 today 👇<br />
              Save this if you want financial freedom.
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
              {['#investing','#naira','#moneytips','#nigerianfinance','#wealthbuilding'].map(t => (
                <span key={t} style={{ fontSize: 10, color: SF_PUR, background: SF_PUR + '10', border: `1px solid ${SF_PUR}20`, padding: '2px 8px', borderRadius: 100 }}>{t}</span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={{ ...btn(), fontSize: 11, flex: 1, textAlign: 'center' }}>Copy caption</button>
              <button style={{ ...btn(), fontSize: 11, flex: 1, textAlign: 'center' }}>Copy hashtags</button>
            </div>
          </div>
          <button style={{ ...btn(true), width: '100%', textAlign: 'center' }}>Open TikTok upload ↗</button>
        </div>
      </div>
    </div>
  )
}

import React from 'react'

export function StepCopilot() {
  const messages = [
    { role: 'bot', text: "6 ideas generated! I've read them all. Idea 2 will perform best for Finance on TikTok — the hook uses a bold myth-bust pattern that gets strong retention in your niche." },
    { role: 'user', text: 'Can you improve the hook on my script?' },
    { role: 'bot', text: 'Rewritten hook: "97% of Nigerians leave money on the table every single month — here is the exact move that fixes it." Much stronger pattern interrupt. Want me to adjust the CTA too?' },
  ]
  return (
    <div style={shell}>
      <TopBar />
      <div style={layout}>
        <SidebarNav active="Script" />
        <div style={{ ...main, display: 'flex', gap: 12 }}>
          {/* Main content area */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: SF_TXT, marginBottom: 10 }}>Your script</div>
            <div style={{ ...card({ opacity: 0.5 }) }}>
              <div style={{ fontSize: 11, color: SF_MUT, lineHeight: 1.6 }}>
                Most people think investing requires thousands of naira. They're wrong...<br/><br/>
                With ₦5,000 you can start today. Here are 3 moves that work...
              </div>
            </div>
          </div>
          {/* Co-pilot panel */}
          <div style={{ width: 200, background: '#111118', border: `1px solid ${SF_BRD}`, borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ background: SF_PUR + '18', padding: '10px 12px', borderBottom: `1px solid ${SF_BRD}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: `linear-gradient(135deg,${SF_PUR},${SF_TEAL})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, position: 'relative' }}>
                ✦
                <div style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: `1.5px solid ${SF_PUR}40`, animation: 'pulse 2s infinite' }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: SF_TXT }}>Co-pilot</div>
                <div style={{ fontSize: 9, color: SF_TEAL, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: SF_TEAL, display: 'inline-block' }} />
                  On Script step
                </div>
              </div>
            </div>
            {/* Context strip */}
            <div style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderBottom: `1px solid ${SF_BRD}`, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, color: SF_PUR, background: SF_PUR + '12', border: `1px solid ${SF_PUR}20`, borderRadius: 100, padding: '1px 6px' }}>Finance</span>
              <span style={{ fontSize: 9, color: SF_TEAL, background: SF_TEAL + '12', border: `1px solid ${SF_TEAL}20`, borderRadius: 100, padding: '1px 6px' }}>TikTok</span>
            </div>
            {/* Messages */}
            <div style={{ flex: 1, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7, overflowY: 'auto' }}>
              {messages.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {m.role === 'bot' && (
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: `linear-gradient(135deg,${SF_PUR},${SF_TEAL})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, marginRight: 5, flexShrink: 0, marginTop: 2 }}>✦</div>
                  )}
                  <div style={{ maxWidth: '85%', padding: '6px 8px', borderRadius: m.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px', background: m.role === 'user' ? SF_PUR : 'rgba(255,255,255,0.06)', border: m.role === 'bot' ? `1px solid ${SF_BRD}` : 'none', fontSize: 10, color: SF_TXT, lineHeight: 1.5 }}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
            {/* Quick actions */}
            <div style={{ padding: '6px 8px', borderTop: `1px solid ${SF_BRD}`, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {['Improve hook','Shorten','Add CTA'].map(a => (
                <div key={a} style={{ fontSize: 9, padding: '3px 7px', borderRadius: 100, background: 'rgba(255,255,255,0.05)', border: `1px solid ${SF_BRD}`, color: SF_MUT }}>⚡ {a}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const STEP_IMAGES: Record<string, React.FC> = {
  'step1-setup':  Step1Setup,
  'step2-config': Step2Config,
  'step3-ideas':  Step3Ideas,
  'step4-script': Step4Script,
  'step5-scenes': Step5Scenes,
  'step6-voice':  Step6Voice,
  'step7-export': Step7Export,
  'step8-share':  Step8Share,
    'step-copilot': StepCopilot,
}
