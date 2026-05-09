/**
 * frontend/src/hooks/useFeedback.ts
 */
import { useState, useEffect, useRef } from 'react'

type Trigger = 'video_complete' | 'time_on_screen' | 'manual'

const FEEDBACK_KEY    = 'sceneforge:feedback_shown'
const TIME_TRIGGER_MS = 3 * 60 * 1000  // 3 minutes
const COOLDOWN_DAYS   = 14

function shouldShow(): boolean {
  try {
    const last = localStorage.getItem(FEEDBACK_KEY)
    if (!last) return true
    const daysSince = (Date.now() - parseInt(last)) / (1000 * 60 * 60 * 24)
    return daysSince >= COOLDOWN_DAYS
  } catch { return true }
}

function markShown() {
  try { localStorage.setItem(FEEDBACK_KEY, Date.now().toString()) } catch {}
}

export function useFeedback(isActive: boolean, renderComplete: boolean) {
  const [show, setShow]         = useState(false)
  const [trigger, setTrigger]   = useState<Trigger>('time_on_screen')
  const timerRef                = useRef<ReturnType<typeof setTimeout>>()
  // Track whether auto-triggers have fired this session
  // (manual trigger always works regardless)
  const autoShownRef            = useRef(false)

  function openFeedback(t: Trigger) {
    if (t !== 'manual') {
      // Auto triggers: respect cooldown and only fire once per session
      if (autoShownRef.current || !shouldShow()) return
      autoShownRef.current = true
      markShown()
    }
    setTrigger(t)
    setShow(true)
  }

  // Manually open — always works, no cooldown
  function openManual() { openFeedback('manual') }

  // Trigger 1: render complete — watch for transition to true
  const prevCompleteRef = useRef(false)
  useEffect(() => {
    if (renderComplete && !prevCompleteRef.current) {
      // Fired the moment renderComplete flips to true
      const t = setTimeout(() => openFeedback('video_complete'), 2000)
      prevCompleteRef.current = true
      return () => clearTimeout(t)
    }
    if (!renderComplete) {
      prevCompleteRef.current = false
    }
  }, [renderComplete])

  // Trigger 2: time on screen
  useEffect(() => {
    clearTimeout(timerRef.current)
    if (!isActive) return
    timerRef.current = setTimeout(() => openFeedback('time_on_screen'), TIME_TRIGGER_MS)
    return () => clearTimeout(timerRef.current)
  }, [isActive])

  function closeFeedback() { setShow(false) }

  return { show, trigger, closeFeedback, openManual }
}
