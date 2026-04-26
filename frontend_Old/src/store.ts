import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { IdeaItem, Scene, RenderRequest } from '../lib/api'

export type AppStep = 'setup' | 'ideas' | 'script' | 'scenes' | 'voice' | 'export'

export interface ProjectConfig {
  niche: string
  style: string
  platform: string
  tone: string
  audience: string
  context: string
}

export interface VoiceConfig {
  voice_name: string
  voice_speed: number
  voice_stability: string
  visual_source: 'pexels_video' | 'pexels_photo' | 'dalle' | 'mixed'
  subtitle_style: 'viral' | 'minimal' | 'karaoke' | 'none'
  music: string
}

interface AppState {
  // Navigation
  currentStep: AppStep
  completedSteps: Set<AppStep>

  // Project config
  config: ProjectConfig

  // Ideas
  ideas: IdeaItem[]
  selectedIdea: IdeaItem | null

  // Script
  script: string
  wordCount: number
  estimatedDuration: number

  // Scenes
  scenes: Scene[]
  activeSceneIndex: number

  // Voice / Visuals
  voiceConfig: VoiceConfig

  // Render
  jobId: string | null
  renderProgress: number
  renderStage: string
  renderStatus: 'idle' | 'queued' | 'processing' | 'complete' | 'failed'
  videoUrl: string | null

  // Actions
  setStep: (step: AppStep) => void
  markStepComplete: (step: AppStep) => void
  setConfig: (config: Partial<ProjectConfig>) => void
  setIdeas: (ideas: IdeaItem[]) => void
  setSelectedIdea: (idea: IdeaItem) => void
  setScript: (script: string, wordCount: number, estimatedDuration: number) => void
  setScenes: (scenes: Scene[]) => void
  updateScene: (index: number, patch: Partial<Scene>) => void
  moveScene: (from: number, to: number) => void
  deleteScene: (index: number) => void
  addScene: () => void
  setActiveSceneIndex: (i: number) => void
  setVoiceConfig: (cfg: Partial<VoiceConfig>) => void
  setJobId: (id: string) => void
  setRenderProgress: (progress: number, stage: string, status: AppState['renderStatus']) => void
  setVideoUrl: (url: string) => void
  getRenderRequest: () => RenderRequest
}

const DEFAULT_CONFIG: ProjectConfig = {
  niche: '',
  style: '',
  platform: 'TikTok (9:16, 60s)',
  tone: 'Energetic & punchy',
  audience: '',
  context: '',
}

const DEFAULT_VOICE: VoiceConfig = {
  voice_name: 'Marcus',
  voice_speed: 1.0,
  voice_stability: 'medium',
  visual_source: 'mixed',
  subtitle_style: 'viral',
  music: 'none',
}

export const useStore = create<AppState>()(
  devtools(
    (set, get) => ({
      currentStep: 'setup',
      completedSteps: new Set(),
      config: DEFAULT_CONFIG,
      ideas: [],
      selectedIdea: null,
      script: '',
      wordCount: 0,
      estimatedDuration: 0,
      scenes: [],
      activeSceneIndex: 0,
      voiceConfig: DEFAULT_VOICE,
      jobId: null,
      renderProgress: 0,
      renderStage: '',
      renderStatus: 'idle',
      videoUrl: null,

      setStep: (step) => set({ currentStep: step }),

      markStepComplete: (step) =>
        set((s) => ({ completedSteps: new Set([...s.completedSteps, step]) })),

      setConfig: (config) =>
        set((s) => ({ config: { ...s.config, ...config } })),

      setIdeas: (ideas) => set({ ideas }),

      setSelectedIdea: (idea) => set({ selectedIdea: idea }),

      setScript: (script, wordCount, estimatedDuration) =>
        set({ script, wordCount, estimatedDuration }),

      setScenes: (scenes) => set({ scenes, activeSceneIndex: 0 }),

      updateScene: (index, patch) =>
        set((s) => {
          const scenes = [...s.scenes]
          scenes[index] = { ...scenes[index], ...patch }
          return { scenes }
        }),

      moveScene: (from, to) =>
        set((s) => {
          if (to < 0 || to >= s.scenes.length) return s
          const scenes = [...s.scenes]
          const [item] = scenes.splice(from, 1)
          scenes.splice(to, 0, item)
          return { scenes, activeSceneIndex: to }
        }),

      deleteScene: (index) =>
        set((s) => {
          if (s.scenes.length <= 1) return s
          const scenes = s.scenes.filter((_, i) => i !== index)
          const activeSceneIndex = Math.min(s.activeSceneIndex, scenes.length - 1)
          return { scenes, activeSceneIndex }
        }),

      addScene: () =>
        set((s) => {
          const newScene: Scene = {
            id: Date.now(),
            text: 'New scene — write the voiceover text here.',
            visual: 'Describe what should appear on screen.',
            duration: 5,
            type: 'main',
            visual_keyword: s.config.niche || 'business',
          }
          return {
            scenes: [...s.scenes, newScene],
            activeSceneIndex: s.scenes.length,
          }
        }),

      setActiveSceneIndex: (i) => set({ activeSceneIndex: i }),

      setVoiceConfig: (cfg) =>
        set((s) => ({ voiceConfig: { ...s.voiceConfig, ...cfg } })),

      setJobId: (id) => set({ jobId: id }),

      setRenderProgress: (progress, stage, status) =>
        set({ renderProgress: progress, renderStage: stage, renderStatus: status }),

      setVideoUrl: (url) => set({ videoUrl: url }),

      getRenderRequest: (): RenderRequest => {
        const { scenes, voiceConfig, config, selectedIdea } = get()
        return {
          scenes,
          voice_name: voiceConfig.voice_name,
          voice_speed: voiceConfig.voice_speed,
          visual_source: voiceConfig.visual_source,
          subtitle_style: voiceConfig.subtitle_style,
          music: voiceConfig.music,
          project_title: selectedIdea?.title ?? 'Untitled',
          platform: config.platform,
        }
      },
    }),
    { name: 'sceneforge' }
  )
)
