/**
 * frontend/src/components/ErrorBoundary.tsx
 * Catches unhandled React render errors — shows friendly UI instead of blank screen.
 */
import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: any) {
    console.error('[SceneForge] Unhandled error:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#080810', fontFamily: 'system-ui, sans-serif', padding: 24,
      }}>
        <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 20 }}>⚠️</div>
          <h2 style={{ color: '#F0F0FF', fontSize: 20, fontWeight: 700, margin: '0 0 12px' }}>
            Something went wrong
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: '0 0 8px', lineHeight: 1.6 }}>
            An unexpected error occurred. Your projects are safe — refresh to continue.
          </p>
          <p style={{
            color: 'rgba(255,255,255,0.2)', fontSize: 11, fontFamily: 'monospace',
            background: 'rgba(255,255,255,0.04)', padding: '8px 12px', borderRadius: 8,
            margin: '0 0 24px', wordBreak: 'break-all',
          }}>
            {this.state.error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#7C5CFF', color: '#fff', border: 'none',
              padding: '12px 32px', borderRadius: 10, fontSize: 14,
              fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Reload page
          </button>
        </div>
      </div>
    )
  }
}
