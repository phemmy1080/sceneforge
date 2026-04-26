import { useEffect, useRef } from 'react'
import { getJobStatus } from '../lib/api'
import { useStore } from '../store'

export function useJobPoller(jobId: string | null) {
  const setRenderProgress = useStore((s) => s.setRenderProgress)
  const setVideoUrl = useStore((s) => s.setVideoUrl)
  const renderStatus = useStore((s) => s.renderStatus)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!jobId || renderStatus === 'complete' || renderStatus === 'failed') return

    const poll = async () => {
      try {
        const status = await getJobStatus(jobId)
        setRenderProgress(status.progress, status.stage, status.status)

        if (status.status === 'complete') {
          const url = (status.result?.video_url as string) ?? ''
          setVideoUrl(url)
          if (intervalRef.current) clearInterval(intervalRef.current)
        }

        if (status.status === 'failed') {
          if (intervalRef.current) clearInterval(intervalRef.current)
        }
      } catch {
        // Network blip — keep polling
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 1500)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [jobId, renderStatus])
}
