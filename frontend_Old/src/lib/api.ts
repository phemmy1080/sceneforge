import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export const api = axios.create({ baseURL: BASE })

// Attach token from localStorage on every request
api.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem('sceneforge-auth')
    if (raw) {
      const { state } = JSON.parse(raw)
      if (state?.token) {
        config.headers.Authorization = `Bearer ${state.token}`
      }
    }
  } catch {}
  return config
})

// Redirect to login on 401
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('sceneforge-auth')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ─── Types (mirrors backend Pydantic schemas) ─────────────────────────────────

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
}

export interface GenerateIdeasRequest {
  niche: string
  style: string
  platform: string
  tone: string
  audience: string
  context: string
}

export interface GenerateScriptRequest {
  idea: IdeaItem
  niche: string
  style: string
  platform: string
  tone: string
  audience: string
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
}

export interface JobStatus {
  job_id: string
  status: 'queued' | 'processing' | 'complete' | 'failed'
  progress: number
  stage: string
  result?: Record<string, unknown>
  error?: string
}

export interface VisualResult {
  id: string
  thumbnail_url: string
  preview_url: string
  source: string
  width: number
  height: number
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const generateIdeas = async (req: GenerateIdeasRequest): Promise<IdeaItem[]> => {
  const { data } = await api.post('/api/generate/ideas', req)
  return data.ideas
}

export const generateScript = async (req: GenerateScriptRequest): Promise<{
  script: string
  word_count: number
  estimated_duration_seconds: number
}> => {
  const { data } = await api.post('/api/generate/script', req)
  return data
}

export const generateScenes = async (script: string, platform: string): Promise<{
  scenes: Scene[]
  total_duration: number
}> => {
  const { data } = await api.post('/api/generate/scenes', { script, platform })
  return data
}

export const searchVisuals = async (keyword: string, scene_id: number): Promise<VisualResult[]> => {
  const { data } = await api.post('/api/generate/visuals/search', { keyword, scene_id })
  return data.results
}

export const startRender = async (req: RenderRequest): Promise<string> => {
  const { data } = await api.post('/api/render/start', req)
  return data.job_id
}

export const getJobStatus = async (jobId: string): Promise<JobStatus> => {
  const { data } = await api.get(`/api/render/status/${jobId}`)
  return data
}

export const getManifest = async (jobId: string) => {
  const { data } = await api.get(`/api/export/manifest/${jobId}`)
  return data
}

export const exportUrl = (jobId: string, type: 'full' | 'scenes' | 'capcut') =>
  `${BASE}/api/export/${type}/${jobId}`

// ─── SSE streaming script ─────────────────────────────────────────────────────

export function streamScript(
  req: GenerateScriptRequest,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): () => void {
  const controller = new AbortController()

  fetch(`${BASE}/api/generate/script/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: controller.signal,
  }).then(async (res) => {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value)
      const lines = text.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') { onDone(); return }
          try {
            const parsed = JSON.parse(payload)
            if (parsed.chunk) onChunk(parsed.chunk)
            if (parsed.error) onError(parsed.error)
          } catch {}
        }
      }
    }
    onDone()
  }).catch((err) => {
    if (err.name !== 'AbortError') onError(String(err))
  })

  return () => controller.abort()
}

// ─── Auth API calls ───────────────────────────────────────────────────────────

export interface User {
  id: string
  full_name: string
  email: string
  avatar_initials: string
  plan: string
  videos_created: number
  created_at: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: User
}

export const signup = async (
  full_name: string,
  email: string,
  password: string
): Promise<AuthResponse> => {
  const { data } = await api.post('/api/auth/signup', { full_name, email, password })
  return data
}

export const login = async (
  email: string,
  password: string
): Promise<AuthResponse> => {
  const { data } = await api.post('/api/auth/login', { email, password })
  return data
}

export const getMe = async (): Promise<User> => {
  const { data } = await api.get('/api/auth/me')
  return data
}

export const updateMe = async (
  full_name?: string,
  email?: string
): Promise<User> => {
  const { data } = await api.patch('/api/auth/me', { full_name, email })
  return data
}