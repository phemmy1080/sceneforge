import { useEffect, useRef } from 'react'
import { getJobStatus } from '../lib/api'
import { useStore } from '../store'

export function useJobPoller(jobId: string | null) {
  const setRenderProgress = useStore((s) => s.setRenderProgress)
  const setVideoUrl       = useStore((s) => s.setVideoUrl)
  const renderStatus      = useStore((s) => s.renderStatus)
  const updateProject     = useStore((s) => s.updateProject)
  const activeProjectId   = useStore((s) => s.activeProjectId)
  const scenes            = useStore((s) => s.scenes)
  const markStepComplete  = useStore((s) => s.markStepComplete)
  const intervalRef       = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!jobId || renderStatus === 'complete' || renderStatus === 'failed') return

    const poll = async () => {
      try {
        const status = await getJobStatus(jobId)
        setRenderProgress(status.progress, status.stage, status.status)

        if (status.status === 'complete') {
          const url = (status.result?.video_url as string) ?? ''
          setVideoUrl(url)

          // ── Update the project in the sidebar and project grid ──────────
          if (activeProjectId) {
            const totalDuration = scenes.reduce((s, sc) => s + sc.duration, 0)
            updateProject(activeProjectId, {
              status:     'exported',
              sceneCount: scenes.length,
              duration:   totalDuration,
              step:       'export',
            })
          }
          markStepComplete('export')

          // ── Trigger feedback modal after 10 seconds ──────────────────────
          setTimeout(() => {
            try {
              document.dispatchEvent(new CustomEvent('sceneforge:video-complete'))
            } catch {}
          }, 10000)

          if (intervalRef.current) clearInterval(intervalRef.current)
        }

        if (status.status === 'failed') {
          // Store error message for display
          const errMsg = status.error || status.stage || 'Render failed'
          setRenderProgress(status.progress, errMsg, 'failed')
          if (intervalRef.current) clearInterval(intervalRef.current)
        }
      } catch {
        // Network blip — keep polling
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 3000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [jobId, renderStatus])
}
