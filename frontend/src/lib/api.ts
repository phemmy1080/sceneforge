import axios from 'axios'
import { useAuthStore } from '../authStore'
import { showError, showWarning } from '../hooks/useErrorToast'

export const BASE = 'https://sceneforge-production-8d19.up.railway.app'

export const api = axios.create({ baseURL: BASE })

// Attach auth token to every request
api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error?.response?.status === 429) {
      const msg = error.response.data?.message || 'Too many requests. Please slow down.'
      document.dispatchEvent(new CustomEvent('api-rate-limited', { detail: msg }))
    }
    return Promise.reject(error)
  }
)

api.interceptors.request.use((config) => {
  const state = useAuthStore.getState()
  if (state?.token) {
    config.headers.Authorization = `Bearer ${state.token}`
  }
  return config
})

// Redirect on 401


api.interceptors.response.use(
  (r) => r,
  (error) => {
    const status  = error?.response?.status
    const detail  = error?.response?.data?.detail
    const message = typeof detail === 'string' ? detail
                  : detail?.message || error.message || 'Something went wrong'

    // 429 Rate limit
    if (status === 429) {
      const msg = error.response.data?.message || 'Too many requests. Please slow down.'
      document.dispatchEvent(new CustomEvent('api-rate-limited', { detail: msg }))
      // Also show toast
      showWarning('Rate limit reached', msg)
    }

    // 500 Server error — always show toast
    else if (status >= 500) {
      showError('Server error', 'Something went wrong on our end. Please try again.')
    }

    // 503 Service unavailable
    else if (status === 503) {
      showError('Service unavailable', 'SceneForge is temporarily unavailable. Try again shortly.')
    }

    // Network error (no response at all)
    else if (!error.response) {
      showError('Connection error', 'Check your internet connection and try again.')
    }

    // 401 — handled separately (logout), don't show toast
    // 403 — handled in Login.tsx (redirect to verify screen), don't show generic toast
    // 400/404 — handled inline in each page component, don't show generic toast

    return Promise.reject(error)
  }
)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IdeaItem {
  title: string
  hook: string
  angle: string
}

export interface Scene {
  id: number
  text: string
  visual: string
  duration: number
  type: 'hook' | 'intro' | 'main' | 'cta'
  visual_keyword: string
  emotion?: string
  b_roll_note?: string
}

export interface GenerateIdeasRequest {
  niche: string
  style: string
  platform: string
  tone: string
  audience: string
  context: string
  idea_tags?: string[]
}

export interface GenerateScriptRequest {
  niche: string
  style: string
  platform: string
  tone: string
  audience: string
  idea: IdeaItem
}

export interface GenerateScenesRequest {
  script: string
  platform: string
}

export interface RenderRequest {
  scenes: Scene[]
  voice_name: string
  voice_speed: number
  visual_source: 'pexels_video' | 'pexels_photo' | 'dalle' | 'mixed'
  subtitle_style: 'viral' | 'minimal' | 'karaoke' | 'none'
  music: string
  project_title: string
  platform: string
  uploaded_voice_path?: string | null
  prev_job_id?: string | null   // for free re-renders
}

export interface JobStatus {
  job_id: string
  status: 'queued' | 'processing' | 'complete' | 'failed'
  progress: number
  stage: string
  result?: Record<string, unknown>
  error?: string
}

export interface TokenBalance {
  tokens_remaining: number
  tokens_total: number
  videos_created: number
  can_render: boolean
  cost_per_video: number
}

export interface User {
  id: string
  full_name: string
  email: string
  avatar_initials: string
  plan: string
  videos_created: number
  tokens_remaining: number
  tokens_total: number
  created_at: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: User
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const signup = async (
  full_name: string,
  email: string,
  password: string,
  coupon_code?: string,
): Promise<AuthResponse> => {
  const { data } = await api.post('/api/auth/signup', {
    full_name, email, password,
    ...(coupon_code ? { coupon_code } : {}),
  })
  return data
}

export const validateCoupon = async (code: string): Promise<{ valid: boolean; tokens: number; message: string }> => {
  try {
    const { data } = await api.post('/api/auth/validate-coupon', { code })
    return data
  } catch {
    return { valid: false, tokens: 0, message: 'Invalid or expired coupon code' }
  }
}

export const login = async (email: string, password: string): Promise<AuthResponse> => {
  const { data } = await api.post('/api/auth/login', { email, password })
  return data
}

export const getMe = async (): Promise<User> => {
  const { data } = await api.get('/api/auth/me')
  return data
}

export const updateMe = async (full_name?: string, email?: string): Promise<User> => {
  const { data } = await api.patch('/api/auth/me', { full_name, email })
  return data
}

export const getTokenBalance = async (): Promise<TokenBalance> => {
  const { data } = await api.get('/api/auth/tokens')
  return data
}

// ─── Generate ─────────────────────────────────────────────────────────────────

export const generateIdeas = async (req: GenerateIdeasRequest): Promise<IdeaItem[]> => {
  const { data } = await api.post('/api/generate/ideas', req)
  return data.ideas
}

export const generateScript = async (req: GenerateScriptRequest): Promise<{ script: string; word_count: number; estimated_duration_seconds: number }> => {
  const { data } = await api.post('/api/generate/script', req)
  return data
}

export const generateScenes = async (script: string, platform: string): Promise<{ scenes: Scene[]; total_duration: number }> => {
  const { data } = await api.post('/api/generate/scenes', { script, platform })
  return data
}

export const streamScript = (
  req: GenerateScriptRequest,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
): (() => void) => {
  const url = `${BASE}/api/generate/script/stream`
  const token = (() => {
    try {
      const s = JSON.parse(localStorage.getItem('sceneforge-auth') || '{}')
      return s?.state?.token || ''
    } catch { return '' }
  })()

  let aborted = false
  const controller = new AbortController()

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(req),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) { onError(`HTTP ${res.status}`); return }
      const reader = res.body?.getReader()
      if (!reader) { onError('No stream body'); return }
      const decoder = new TextDecoder()
      while (!aborted) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        for (const line of text.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (payload === '[DONE]') { onDone(); return }
          try {
            const parsed = JSON.parse(payload)
            if (parsed.chunk) onChunk(parsed.chunk)
            if (parsed.error) { onError(parsed.error); return }
          } catch {}
        }
      }
      onDone()
    })
    .catch((err) => {
      if (!aborted) onError(err.message)
    })

  return () => { aborted = true; controller.abort() }
}


// ─── Render ───────────────────────────────────────────────────────────────────

export interface VisualResult {
  id: string
  thumbnail_url: string
  preview_url: string
  full_url: string
  duration: number
  width: number
  height: number
  provider: 'pexels' | 'dalle'
}

export const searchVisuals = async (
  keyword: string,
  sceneId?: number,
): Promise<VisualResult[]> => {
  const { data } = await api.post('/api/generate/visuals/search', {
    keyword,
    scene_id: sceneId,
  })
  return data.results ?? []
}

export const startRender = async (req: RenderRequest): Promise<{ job_id: string; status: string }> => {
  const { data } = await api.post('/api/render/start', req)
  return data
}

export const getJobStatus = async (jobId: string): Promise<JobStatus> => {
  const { data } = await api.get(`/api/render/status/${jobId}`)
  return data
}

// ─── Export ───────────────────────────────────────────────────────────────────

export const exportUrl = (
  jobId: string,
  type: 'full' | 'scenes' | 'capcut',
  title?: string,
): string => {
  const base = `${BASE}/api/export/${type}/${jobId}`
  if (!title) return base
  return `${base}?title=${encodeURIComponent(title)}`
}

export const voiceUrl = (
  jobId: string,
  format: 'mp3' | 'wav' = 'mp3',
  title?: string,
): string => {
  const base = `${BASE}/api/export/voice/${jobId}?format=${format}`
  if (!title) return base
  return `${base}&title=${encodeURIComponent(title)}`
}

export const getManifest = async (jobId: string) => {
  const { data } = await api.get(`/api/export/manifest/${jobId}`)
  return data
}

export interface Niche {
  key: string
  label: string
  suggestions: string[]
}

export const getNiches = async (): Promise<Niche[]> => {
  const { data } = await api.get('/api/niches')
  return data.niches || []
}

// ─── Projects API ─────────────────────────────────────────────────────────────

export interface ServerProject {
  id: string
  user_id: string
  name: string
  niche: string
  style: string
  platform: string
  folder: string
  status: string
  step: string
  scene_count: number
  duration: number
  created_at: string
  updated_at: string
  selected_idea?: any
  script?: string
  scenes?: any[]
  voice_config?: any
  job_id?: string
  video_url?: string
}

export const projectsApi = {
  create: async (data: {
    id?: string; name: string; niche: string
    style: string; platform: string; folder: string
  }): Promise<ServerProject> => {
    const { data: res } = await api.post('/api/projects', data)
    return res
  },

  list: async (): Promise<ServerProject[]> => {
    const { data } = await api.get('/api/projects')
    return data.projects || []
  },

  get: async (id: string): Promise<ServerProject> => {
    const { data } = await api.get(`/api/projects/${id}`)
    return data
  },

  update: async (id: string, patch: Partial<ServerProject>): Promise<ServerProject> => {
    const { data } = await api.put(`/api/projects/${id}`, patch)
    return data
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/projects/${id}`)
  },

  sync: async (projects: any[]): Promise<{ synced: number; projects: ServerProject[] }> => {
    const { data } = await api.post('/api/projects/sync', { projects })
    return data
  },
}

export const verifyEmail = async (otp: string): Promise<{ success: boolean }> => {
  const { data } = await api.post('/api/auth/verify-email', { otp })
  return data
}

export const resendOtp = async (): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.post('/api/auth/resend-otp')
  return data
}

export const forgotPassword = async (email: string): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.post('/api/auth/forgot-password', { email })
  return data
}

export const resetPasswordWithToken = async (
  token: string,
  new_password: string,
  confirm_password: string,
): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.post('/api/auth/reset-password', { token, new_password, confirm_password })
  return data
}

export const verifyResetToken = async (token: string): Promise<{ valid: boolean; email: string }> => {
  const { data } = await api.get(`/api/auth/verify-reset-token?token=${token}`)
  return data
}
