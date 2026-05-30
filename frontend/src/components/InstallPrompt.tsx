import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [show, setShow] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Don't show if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return
    // Don't show if dismissed in this session
    if (sessionStorage.getItem('pwa-prompt-dismissed')) return

    const ios = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())
    setIsIOS(ios)

    if (ios) {
      // Show iOS install instructions after a short delay
      const t = setTimeout(() => setShow(true), 3000)
      return () => clearTimeout(t)
    }

    // Chrome/Android: capture the native install prompt
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function dismiss() {
    setShow(false)
    setDismissed(true)
    sessionStorage.setItem('pwa-prompt-dismissed', '1')
  }

  async function install() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setShow(false)
    }
    setDeferredPrompt(null)
  }

  if (!show || dismissed) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden">
      <div className="bg-[#1a1a2e] border border-violet-500/25 rounded-2xl p-4 shadow-2xl shadow-black/60">
        <div className="flex items-start gap-3">
          {/* App icon */}
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-teal-500 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-lg font-display">S</span>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] font-semibold text-white/90 mb-0.5">Add SceneForge to Home Screen</p>
            {isIOS ? (
              <p className="text-[11.5px] text-white/45 leading-relaxed">
                Tap <span className="inline-block text-white/70">⬆ Share</span> then <strong className="text-white/70">"Add to Home Screen"</strong> for the full app experience
              </p>
            ) : (
              <p className="text-[11.5px] text-white/45">
                Create videos offline-ready, faster load, no browser bar
              </p>
            )}
          </div>

          <button
            onClick={dismiss}
            className="w-6 h-6 flex items-center justify-center text-white/30 hover:text-white/60 flex-shrink-0 transition-colors"
            aria-label="Dismiss"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 1l10 10M11 1L1 11"/>
            </svg>
          </button>
        </div>

        {!isIOS && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={install}
              className="flex-1 py-2.5 bg-violet-500 hover:bg-violet-600 text-white text-[13px] font-semibold rounded-xl transition-colors"
            >
              Install app
            </button>
            <button
              onClick={dismiss}
              className="px-4 py-2.5 bg-white/6 hover:bg-white/10 text-white/60 text-[13px] rounded-xl transition-colors"
            >
              Not now
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
