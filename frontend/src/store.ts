import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { IdeaItem, Scene, RenderRequest } from './lib/api'
import { projectsApi } from './lib/api'

export type AppStep = 'projects' | 'setup' | 'ideas' | 'script' | 'scenes' | 'voice' | 'export' | 'profile' | 'upload' | 'upgrade' | 'plans'

export interface ProjectConfig {
  niche: string; style: string; platform: string
  tone: string; audience: string; context: string
  ideaHints: string; ideaTags: string[]
}

export interface VoiceConfig {
  voice_name: string; voice_speed: number; voice_stability: string
  visual_source: 'pexels_video' | 'pexels_photo' | 'dalle' | 'mixed'
  subtitle_style: 'viral' | 'minimal' | 'karaoke' | 'none'
  music: string
}

export interface Project {
  id: string; name: string; niche: string; style: string
  platform: string; folder: string; status: 'draft' | 'active' | 'exported'
  sceneCount: number; duration: number; createdAt: string
  step: AppStep; voice?: string
  synced?: boolean  // true once saved to backend
}

// ─── Debounce helper ──────────────────────────────────────────────────────────
const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}
function debounce(key: string, fn: () => void, ms = 2000) {
  clearTimeout(debounceTimers[key])
  debounceTimers[key] = setTimeout(fn, ms)
}

// ─── Project sync helpers ─────────────────────────────────────────────────────
async function saveProjectToBackend(project: Project, extra?: Record<string, any>) {
  try {
    await projectsApi.update(project.id, {
      name: project.name,
      niche: project.niche,
      style: project.style,
      platform: project.platform,
      folder: project.folder,
      status: project.status,
      step: project.step as string,
      scene_count: project.sceneCount,
      duration: project.duration,
      ...extra,
    })
  } catch {
    // Silent fail — local state is always the source of truth for UX
    // Backend sync failures don't interrupt the user
  }
}

interface AppState {
  currentStep: AppStep
  completedSteps: Set<AppStep>
  projects: Project[]
  folders: Record<string, string[]>
  folderOpen: Record<string, boolean>
  activeProjectId: string | null
  config: ProjectConfig
  ideas: IdeaItem[]
  selectedIdea: IdeaItem | null
  script: string
  wordCount: number
  estimatedDuration: number
  scenes: Scene[]
  activeSceneIndex: number
  voiceConfig: VoiceConfig
  uploadedVoicePath: string | null
  jobId: string | null
  renderProgress: number
  renderStage: string
  renderStatus: 'idle' | 'queued' | 'processing' | 'complete' | 'failed'
  videoUrl: string | null
  // Backend sync state
  backendSynced: boolean

  setStep: (step: AppStep) => void
  markStepComplete: (step: AppStep) => void
  addProject: (args: { name: string; niche: string; style: string; platform: string; folder: string }) => void
  openProject: (id: string) => void
  updateProject: (id: string, patch: Partial<Project>) => void
  deleteProject: (id: string) => void
  duplicateProject: (id: string) => void
  toggleFolder: (folder: string) => void
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
  setUploadedVoicePath: (path: string | null) => void
  setJobId: (id: string) => void
  setRenderProgress: (progress: number, stage: string, status: AppState['renderStatus']) => void
  setVideoUrl: (url: string) => void
  getRenderRequest: () => RenderRequest
  // Backend sync actions
  loadProjectsFromBackend: () => Promise<void>
  syncLocalProjectsToBackend: () => Promise<void>
}

const DEFAULT_CONFIG: ProjectConfig = {
  niche: '', style: 'Educational',
  platform: 'TikTok (9:16, 60s)', tone: 'Energetic & punchy',
  audience: '', context: '', ideaHints: '', ideaTags: [],
}

const DEFAULT_VOICE: VoiceConfig = {
  voice_name: 'Marcus', voice_speed: 1.0, voice_stability: 'medium',
  visual_source: 'mixed', subtitle_style: 'viral', music: 'none',
}

export const useStore = create<AppState>()(
  devtools(
    persist(
      (set, get) => ({
        currentStep: 'projects',
        completedSteps: new Set(),
        projects: [],
        folders: {},
        folderOpen: {},
        activeProjectId: null,
        config: DEFAULT_CONFIG,
        ideas: [],
        selectedIdea: null,
        script: '',
        wordCount: 0,
        estimatedDuration: 0,
        scenes: [],
        activeSceneIndex: 0,
        voiceConfig: DEFAULT_VOICE,
        uploadedVoicePath: null,
        jobId: null,
        renderProgress: 0,
        renderStage: '',
        renderStatus: 'idle',
        videoUrl: null,
        backendSynced: false,

        setStep: (step) => set({ currentStep: step }),
        markStepComplete: (step) => set((s) => ({ completedSteps: new Set([...s.completedSteps, step]) })),

        addProject: ({ name, niche, style, platform, folder: folderArg }) => {
          const folder = folderArg || niche || 'General'
          const id = 'proj_' + Date.now()
          const proj: Project = {
            id, name, niche, style, platform, folder,
            status: 'draft', sceneCount: 0, duration: 0,
            createdAt: 'Just now', step: 'setup', synced: false,
          }

          set((s) => {
            const newFolders = { ...s.folders }
            if (!newFolders[folder]) newFolders[folder] = []
            newFolders[folder] = [id, ...newFolders[folder]]
            return {
              projects: [proj, ...s.projects],
              folders: newFolders,
              folderOpen: { ...s.folderOpen, [folder]: true },
              activeProjectId: id,
              config: { ...s.config, niche, style, platform },
            }
          })

          // Create on backend immediately
          projectsApi.create({ id, name, niche, style, platform, folder })
            .then(() => {
              set((s) => ({
                projects: s.projects.map((p) =>
                  p.id === id ? { ...p, synced: true } : p
                ),
              }))
            })
            .catch(() => {/* silent — local state intact */})
        },

        openProject: (id) => set((s) => {
          const proj = s.projects.find((p) => p.id === id)
          if (!proj) return s
          return {
            activeProjectId: id,
            config: { ...s.config, niche: proj.niche, style: proj.style, platform: proj.platform },
          }
        }),

        updateProject: (id, patch) => {
          set((s) => ({
            projects: s.projects.map((p) => p.id === id ? { ...p, ...patch } : p),
          }))
          // Debounced auto-save to backend
          const project = get().projects.find((p) => p.id === id)
          if (project) {
            debounce(`project-${id}`, () => {
              saveProjectToBackend({ ...project, ...patch })
            }, 2000)
          }
        },

        deleteProject: (id) => {
          set((s) => {
            const newFolders = { ...s.folders }
            Object.keys(newFolders).forEach((f) => {
              newFolders[f] = newFolders[f].filter((pid) => pid !== id)
            })
            return {
              projects: s.projects.filter((p) => p.id !== id),
              folders: newFolders,
              activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
            }
          })
          projectsApi.delete(id).catch(() => {})
        },

        duplicateProject: (id) => {
          const proj = get().projects.find((p) => p.id === id)
          if (!proj) return
          const newId = 'proj_' + Date.now()
          const copy: Project = {
            ...proj, id: newId,
            name: proj.name + ' (copy)',
            createdAt: 'Just now',
            status: 'draft',
            synced: false,
          }
          set((s) => {
            const newFolders = { ...s.folders }
            if (!newFolders[copy.folder]) newFolders[copy.folder] = []
            newFolders[copy.folder] = [newId, ...newFolders[copy.folder]]
            return { projects: [copy, ...s.projects], folders: newFolders }
          })
          projectsApi.create({
            id: newId, name: copy.name, niche: copy.niche,
            style: copy.style, platform: copy.platform, folder: copy.folder,
          }).catch(() => {})
        },

        toggleFolder: (folder) => set((s) => ({
          folderOpen: { ...s.folderOpen, [folder]: !s.folderOpen[folder] },
        })),

        setConfig: (config) => set((s) => ({ config: { ...s.config, ...config } })),
        setIdeas: (ideas) => set({ ideas }),

        setSelectedIdea: (idea) => {
          set({ selectedIdea: idea })
          // Save idea selection to backend
          const { activeProjectId } = get()
          if (activeProjectId) {
            debounce(`idea-${activeProjectId}`, () => {
              projectsApi.update(activeProjectId, { selected_idea: idea as any })
                .catch(() => {})
            }, 1000)
          }
        },

        setScript: (script, wordCount, estimatedDuration) => {
          set({ script, wordCount, estimatedDuration })
          // Save script to backend
          const { activeProjectId } = get()
          if (activeProjectId) {
            debounce(`script-${activeProjectId}`, () => {
              projectsApi.update(activeProjectId, { script } as any)
                .catch(() => {})
            }, 3000) // longer debounce for script — it changes rapidly while typing
          }
        },

        setScenes: (scenes) => {
          set({ scenes, activeSceneIndex: 0 })
          const { activeProjectId } = get()
          if (activeProjectId) {
            debounce(`scenes-${activeProjectId}`, () => {
              projectsApi.update(activeProjectId, {
                scenes: scenes as any,
                scene_count: scenes.length,
                duration: scenes.reduce((sum, s) => sum + (s.duration || 0), 0),
              }).catch(() => {})
            }, 2000)
          }
        },

        updateScene: (index, patch) => {
          set((s) => {
            const scenes = [...s.scenes]
            scenes[index] = { ...scenes[index], ...patch }
            return { scenes }
          })
          const { activeProjectId, scenes } = get()
          if (activeProjectId) {
            debounce(`scenes-${activeProjectId}`, () => {
              projectsApi.update(activeProjectId, { scenes: scenes as any }).catch(() => {})
            }, 3000)
          }
        },

        moveScene: (from, to) => set((s) => {
          if (to < 0 || to >= s.scenes.length) return s
          const scenes = [...s.scenes]
          const [item] = scenes.splice(from, 1)
          scenes.splice(to, 0, item)
          return { scenes, activeSceneIndex: to }
        }),

        deleteScene: (index) => set((s) => {
          if (s.scenes.length <= 1) return s
          const scenes = s.scenes.filter((_, i) => i !== index)
          return { scenes, activeSceneIndex: Math.min(s.activeSceneIndex, scenes.length - 1) }
        }),

        addScene: () => set((s) => {
          const newScene: Scene = {
            id: Date.now(), text: 'New scene — write the voiceover here.',
            visual: 'Describe what appears on screen.', duration: 5,
            type: 'main', visual_keyword: s.config.niche || 'business',
          }
          return { scenes: [...s.scenes, newScene], activeSceneIndex: s.scenes.length }
        }),

        setActiveSceneIndex: (i) => set({ activeSceneIndex: i }),
        setVoiceConfig: (cfg) => set((s) => ({ voiceConfig: { ...s.voiceConfig, ...cfg } })),
        setUploadedVoicePath: (path) => set({ uploadedVoicePath: path }),
        setJobId: (id) => set({ jobId: id }),
        setRenderProgress: (progress, stage, status) => set({ renderProgress: progress, renderStage: stage, renderStatus: status }),

        setVideoUrl: (url) => {
          set({ videoUrl: url })
          // Mark project as exported on backend
          const { activeProjectId } = get()
          if (activeProjectId) {
            projectsApi.update(activeProjectId, {
              status: 'exported' as any,
              video_url: url,
              step: 'export',
            }).catch(() => {})
          }
        },

        getRenderRequest: (): RenderRequest => {
          const { scenes, voiceConfig, config, selectedIdea, uploadedVoicePath, projects, activeProjectId } = get()
          const activeProject = projects.find(p => p.id === activeProjectId)
          return {
            scenes,
            voice_name: voiceConfig.voice_name,
            voice_speed: voiceConfig.voice_speed,
            visual_source: voiceConfig.visual_source,
            subtitle_style: voiceConfig.subtitle_style,
            music: voiceConfig.music,
            project_title: selectedIdea?.title ?? activeProject?.name ?? 'Untitled',
            platform: config.platform,
            uploaded_voice_path: uploadedVoicePath ?? null,
            project_id: activeProjectId ?? undefined,
          }
        },

        // ─── Backend sync ───────────────────────────────────────────────────

        loadProjectsFromBackend: async () => {
          try {
            const serverProjects = await projectsApi.list()
            if (serverProjects.length === 0) return

            // Convert server project shape to local Project shape
            const converted: Project[] = serverProjects.map((sp) => ({
              id: sp.id,
              name: sp.name,
              niche: sp.niche,
              style: sp.style,
              platform: sp.platform,
              folder: sp.folder,
              status: (sp.status as any) || 'draft',
              sceneCount: sp.scene_count || 0,
              duration: sp.duration || 0,
              createdAt: sp.created_at ? new Date(sp.created_at).toLocaleDateString() : 'Unknown',
              step: (sp.step as AppStep) || 'setup',
              synced: true,
            }))

            // Rebuild folders from projects
            const folders: Record<string, string[]> = {}
            converted.forEach((p) => {
              if (!folders[p.folder]) folders[p.folder] = []
              folders[p.folder].push(p.id)
            })

            set({
              projects: converted,
              folders,
              backendSynced: true,
            })
          } catch {
            // Fail silently — local cache remains
          }
        },

        syncLocalProjectsToBackend: async () => {
          const { projects } = get()
          const unsynced = projects.filter((p) => !p.synced)
          if (unsynced.length === 0) return
          try {
            await projectsApi.sync(unsynced.map((p) => ({
              id: p.id, name: p.name, niche: p.niche,
              style: p.style, platform: p.platform, folder: p.folder,
              status: p.status, step: p.step,
              scene_count: p.sceneCount, duration: p.duration,
            })))
            set((s) => ({
              projects: s.projects.map((p) => ({ ...p, synced: true })),
            }))
          } catch {
            // Silent fail
          }
        },
      }),
      {
        name: 'sceneforge-store',
        partialize: (s) => ({
          projects: s.projects,
          folders: s.folders,
          folderOpen: s.folderOpen,
          activeProjectId: s.activeProjectId,
          backendSynced: s.backendSynced,
        }),
      }
    ),
    { name: 'sceneforge' }
  )
)
