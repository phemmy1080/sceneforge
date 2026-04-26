import { useEffect, useState } from 'react'
import { useAuthStore } from '../authStore'
import { api } from '../lib/api'

export interface PlanLimits {
  max_scenes: number           // -1 = unlimited
  max_renders_per_day: number  // -1 = unlimited
  max_resolution: string
  ai_voices: boolean
  upload_footage: boolean
  label: string
}

export interface PlanFeatures {
  plan: string
  limits: PlanLimits
}

const FREE_LIMITS: PlanLimits = {
  max_scenes: 8,
  max_renders_per_day: 3,
  max_resolution: '720p',
  ai_voices: false,
  upload_footage: false,
  label: 'Free',
}

export function usePlanLimits() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  const [features, setFeatures] = useState<PlanFeatures>({
    plan: user?.plan ?? 'free',
    limits: FREE_LIMITS,
  })

  useEffect(() => {
    if (!isAuthenticated) return
    api.get('/api/auth/plan-features')
      .then(({ data }) => setFeatures(data))
      .catch(() => {}) // silent — use defaults
  }, [isAuthenticated, user?.plan])

  const { plan, limits } = features

  return {
    plan,
    limits,
    isFree: plan === 'free',
    isPaid: plan !== 'free',
    // Convenience checks
    canAddScene: (currentCount: number) =>
      limits.max_scenes === -1 || currentCount < limits.max_scenes,
    scenesRemaining: (currentCount: number) =>
      limits.max_scenes === -1 ? Infinity : Math.max(0, limits.max_scenes - currentCount),
    hasAiVoices: limits.ai_voices,
    canUploadFootage: limits.upload_footage,
    maxScenes: limits.max_scenes,
  }
}
