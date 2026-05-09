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
  const [show, setShow]       = useState(false)
  const [trigger, setTrigger] = useState<Trigger>('time_on_screen')
  const timerRef              = useRef<ReturnType<typeof setTimeout>>()
  const autoShownRef          = useRef(false)
  // Track whether we already fired the render-complete trigger this session
  const renderFiredRef        = useRef(false)

  function openFeedback(t: Trigger) {
    if (t !== 'manual') {
      if (autoShownRef.current || !shouldShow()) return
      autoShownRef.current = true
      markShown()
    }
    setTrigger(t)
    setShow(true)
  }

  // Manual trigger — always works regardless of cooldown
  function openManual() {
    setTrigger('manual')
    setShow(true)
  }

  // Trigger 1: render complete
  // Fires when renderComplete becomes true OR if it's already true on mount
  useEffect(() => {
    if (renderComplete && !renderFiredRef.current) {
      renderFiredRef.current = true
      const t = setTimeout(() => openFeedback('video_complete'), 2000)
      return () => clearTimeout(t)
    }
    if (!renderComplete) {
      renderFiredRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderComplete])

  // Trigger 2: time on screen
  useEffect(() => {
    clearTimeout(timerRef.current)
    if (!isActive) return
    timerRef.current = setTimeout(() => openFeedback('time_on_screen'), TIME_TRIGGER_MS)
    return () => clearTimeout(timerRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  function closeFeedback() { setShow(false) }

  return { show, trigger, closeFeedback, openManual }
}
