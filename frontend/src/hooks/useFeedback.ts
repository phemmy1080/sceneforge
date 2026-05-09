/**
 * frontend/src/hooks/useFeedback.ts
 * Controls when the feedback modal appears:
 * 1. After video render completes
 * 2. After 3 minutes on the setup/voice screen (time-on-screen)
 */
import { useState, useEffect, useRef } from 'react'

type Trigger = 'video_complete' | 'time_on_screen'

const FEEDBACK_KEY     = 'sceneforge:feedback_shown'
const TIME_TRIGGER_MS  = 3 * 60 * 1000  // 3 minutes
const COOLDOWN_DAYS    = 14             // don't show again for 14 days

function shouldShow(): boolean {
  try {
    const last = localStorage.getItem(FEEDBACK_KEY)
    if (!last) return true
    const daysSince = (Date.now() - parseInt(last)) / (1000 * 60 * 60 * 24)
    return daysSince >= COOLDOWN_DAYS
  } catch {
    return true
  }
}

function markShown() {
  try { localStorage.setItem(FEEDBACK_KEY, Date.now().toString()) } catch {}
}

export function useFeedback(isActive: boolean, renderComplete: boolean) {
  const [show, setShow]       = useState(false)
  const [trigger, setTrigger] = useState<Trigger>('time_on_screen')
  const timerRef              = useRef<ReturnType<typeof setTimeout>>()
  const shownRef              = useRef(false)

  function openFeedback(t: Trigger) {
    if (shownRef.current || !shouldShow()) return
    shownRef.current = true
    markShown()
    setTrigger(t)
    setShow(true)
  }

  // Trigger 1: video render just completed
  useEffect(() => {
    if (renderComplete) {
      // Small delay so the export UI settles first
      const t = setTimeout(() => openFeedback('video_complete'), 2000)
      return () => clearTimeout(t)
    }
  }, [renderComplete])

  // Trigger 2: time on screen (3 minutes)
  useEffect(() => {
    if (!isActive) {
      clearTimeout(timerRef.current)
      return
    }
    timerRef.current = setTimeout(() => openFeedback('time_on_screen'), TIME_TRIGGER_MS)
    return () => clearTimeout(timerRef.current)
  }, [isActive])

  function closeFeedback() { setShow(false) }

  return { show, trigger, closeFeedback }
}
