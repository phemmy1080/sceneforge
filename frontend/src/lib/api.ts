import axios from 'axios'
import { useAuthStore } from '../authStore'

export const BASE = 'https://sceneforge-production-8d19.up.railway.app'

export const api = axios.create({ baseURL: BASE })

// Attach auth token to every request
// ── Friendly error messages ──────────────────────────────────────────────────
const ERROR_MESSAGES: Record<number, string> = {
  400: 'Something went wrong with your request. Please check your input and try again.',
  401: "Your session has expired. Please log in again.",
  403: "You don't have permission to do that. Upgrade your plan to unlock this feature.",
  404: 'The requested resource was not found.',
  408: 'The request timed out. Please check your connection and try again.',
  409: 'A conflict occurred. This item may already exist.',
  413: 'The file or request is too large.',
  422: 'The information provided is invalid. Please check and try again.',
  429: "You're going too fast! Please wait a moment before trying again.",
  500: 'Our servers hit an unexpected error. Please try again in a moment.',
  502: 'SceneForge is temporarily unavailable. Please try again shortly.',
  503: 'The service is temporarily down for maintenance. Please check back soon.',
  504: 'The server took too long to respond. Please try again.',
}

const NETWORK_MESSAGES: Record<string, string> = {
  'Network Error':       'Unable to connect to SceneForge. Please check your internet connection.',
  'timeout of':         'The request timed out. Please try again.',
  'ECONNABORTED':       'Connection was aborted. Please try again.',
}

function getFriendlyError(error: any): string {
  // Server returned a structured error
  const serverMsg = error?.response?.data?.detail || error?.response?.data?.message
  if (serverMsg && typeof serverMsg === 'string' && serverMsg.length < 200) {
    // Don't show raw Python tracebacks
    if (!serverMsg.includes('Traceback') && !serverMsg.includes('  File "')) {
      return serverMsg
    }
  }

  // Known HTTP status
  const status = error?.response?.status
  if (status && ERROR_MESSAGES[status]) return ERROR_MESSAGES[status]

  // Network-level errors
  const errMsg = error?.message || ''
  for (const [key, msg] of Object.entries(NETWORK_MESSAGES)) {
    if (errMsg.includes(key)) return msg
  }

  // Fallback
  return 'Something went wrong. Please try again.'
}

api.interceptors.response.use(
  (r) => r,
  (error) => {
    const status  = error?.response?.status
    const friendly = getFriendlyError(error)

    // Rate limit — existing event
    if (status === 429) {
      document.dispatchEvent(new CustomEvent('api-rate-limited', { detail: friendly }))
    }

    // Auth expired — redirect to login
    if (status === 401) {
      document.dispatchEvent(new CustomEvent('api-auth-expired', { detail: friendly }))
    }

    // All other errors — show toast
    // Skip toast for: render status 404s (expired jobs), and requests marked silent
    const url = error?.config?.url || ''
    const isSilent = error?.config?.silent === true
    const isExpiredJob = status === 404 && url.includes('/render/status/')
    // Suppress 403 on token-usage — editors don't have access and that's expected
    const isExpected403 = status === 403 && url.includes('/token-usage')
    if (status !== 401 && !isSilent && !isExpiredJob && !isExpected403) {
      document.dispatchEvent(new CustomEvent('api-error', {
        detail: { message: friendly, status, raw: error?.response?.data }
      }))
    }

    // Attach friendly message to error so callers can use it
    if (error) error.friendlyMessage = friendly
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
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
    }
    return Promise.reject(err)
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
  custom_voice_url?: string
  custom_voice_duration?: number
}

export interface GenerateIdeasRequest {
  niche: string
  style: string
  platform: string
  tone: string
  audience: string
  context: string
  idea_tags?: string[]
  objective?: string
  duration_hint?: number
  scene_count_hint?: number
  client_brief?: string
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
  project_id?: string | null    // active project ID
  motion?: string               // "auto" | "kenburns_in" | "kenburns_out" | "pan_left" | "pan_right" | "none"
  transition?: string           // "fade" | "blur" | "none"
  transition_duration?: number
  agency_project_id?: string  // set when rendering for an agency project
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
  tokens_per_scene?: number
  renders_today?: number
  daily_limit?: number
  renders_remaining?: number
  is_agency?: boolean
  ws_id?: string
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

export const generateIdeas = async (req: GenerateIdeasRequest, agencyProjectId?: string): Promise<IdeaItem[]> => {
  const { data } = await api.post('/api/generate/ideas', {
    ...req,
    ...(agencyProjectId ? { agency_project_id: agencyProjectId } : {}),
  })
  return data.ideas
}

export const generateScript = async (req: GenerateScriptRequest): Promise<{ script: string; word_count: number; estimated_duration_seconds: number }> => {
  const { data } = await api.post('/api/generate/script', req)
  return data
}

export const generateScriptForAgency = async (req: GenerateScriptRequest, agencyProjectId: string): Promise<{ script: string; word_count: number; estimated_duration_seconds: number }> => {
  const { data } = await api.post('/api/generate/script', { ...req, agency_project_id: agencyProjectId })
  return data
}

export const generateScenes = async (script: string, platform: string, agencyProjectId?: string): Promise<{ scenes: Scene[]; total_duration: number }> => {
  const { data } = await api.post('/api/generate/scenes', {
    script,
    platform,
    ...(agencyProjectId ? { agency_project_id: agencyProjectId } : {}),
  })
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


export async function uploadVoiceClip(
  file: File | Blob,
  sceneId: number,
  onProgress?: (pct: number) => void,
): Promise<{ voice_url: string; duration: number; steps: string[] }> {
  const form = new FormData()
  form.append('file', file, file instanceof File ? file.name : `scene_${sceneId}_voice.webm`)
  form.append('scene_id', String(sceneId))
  const res = await api.post('/api/render/voice/process-upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e: any) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
    },
  })
  return res.data
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
