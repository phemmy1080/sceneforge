import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { IdeaItem, Scene, RenderRequest } from './lib/api'
import { projectsApi } from './lib/api'

export type AppStep = 'projects' | 'my-videos' | 'setup' | 'ideas' | 'script' | 'scenes' | 'voice' | 'export' | 'profile' | 'upload' | 'upgrade' | 'plans' | 'agency' | 'agency-projects' | 'agency-new' | 'agency-detail' | 'agency-team' | 'agency-kits' | 'agency-workflow'

export interface ProjectConfig {
  niche: string; style: string; platform: string
  tone: string; audience: string; context: string
  ideaHints: string; ideaTags: string[]
  // Agency / premium fields
  objective?: string
  duration_hint?: number
  scene_count_hint?: number
  client_brief?: string
}

export interface VoiceConfig {
  voice_name: string; voice_speed: number; voice_stability: string
  visual_source: 'pexels_video' | 'pexels_photo' | 'dalle' | 'mixed'
  subtitle_style: 'viral' | 'minimal' | 'karaoke' | 'none'
  music: string
  motion: string
  transition: string
}

export interface Project {
  id: string; name: string; niche: string; style: string
  platform: string; folder: string; status: 'draft' | 'active' | 'exported'
  sceneCount: number; duration: number; createdAt: string
  step: AppStep; voice?: string
  synced?: boolean
  job_id?: string     // restored from backend after render
  video_url?: string  // restored from backend after render
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
      name: project.name, niche: project.niche, style: project.style,
      platform: project.platform, folder: project.folder, status: project.status,
      step: project.step as string, scene_count: project.sceneCount,
      duration: project.duration, ...extra,
    })
  } catch { /* silent */ }
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
  sceneHistory: Scene[][]   // undo stack — array of past scenes arrays
  sceneHistoryIndex: number // pointer into the stack
  voiceConfig: VoiceConfig
  uploadedVoicePath: string | null
  jobId: string | null
  prevJobId: string | null       // set before navigating to voice for re-renders
  renderProgress: number
  renderStage: string
  renderStatus: 'idle' | 'queued' | 'processing' | 'complete' | 'failed'
  videoUrl: string | null
  backendSynced: boolean

  agencyProjectId: string
  viewMode: 'agency' | 'personal'
  agencyProjectMeta: { title: string; client_name: string } | null
  setAgencyProjectMeta: (meta: { title: string; client_name: string } | null) => void
  setAgencyProjectId: (id: string) => void
  setViewMode: (mode: 'agency' | 'personal') => void
  startAgencyVideo: (projectId: string, subStep?: string, sceneIndex?: number) => void
  startAgencyExport: (projectId: string, jobId: string, videoUrl: string) => void
  agencyWorkflowStep: string
  setAgencyWorkflowStep: (step: string) => void
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
  duplicateScene: (index: number) => void
  undoScenes: () => void
  redoScenes: () => void
  pushSceneHistory: (scenes: Scene[]) => void
  setActiveSceneIndex: (i: number) => void
  setVoiceConfig: (cfg: Partial<VoiceConfig>) => void
  setUploadedVoicePath: (path: string | null) => void
  setJobId: (id: string) => void
  setPrevJobId: (id: string | null) => void
  setRenderProgress: (progress: number, stage: string, status: AppState['renderStatus']) => void
  setVideoUrl: (url: string) => void
  getIdeasRequest: () => Record<string, any>
  getRenderRequest: () => RenderRequest
  loadProjectsFromBackend: () => Promise<void>
  syncLocalProjectsToBackend: () => Promise<void>
}

const DEFAULT_CONFIG: ProjectConfig = {
  niche: '', style: 'Educational', platform: 'TikTok',
  tone: 'Energetic & punchy', audience: '', context: '', ideaHints: '', ideaTags: [],
}

const DEFAULT_VOICE: VoiceConfig = {
  voice_name: 'Marcus', voice_speed: 1.0, voice_stability: 'medium',
  visual_source: 'mixed', subtitle_style: 'viral', music: 'none',
  motion: 'auto', transition: 'fade',
}

// Shared workflow reset — used by addProject and openProject
const CLEAR_WORKFLOW = {
  ideas: [] as IdeaItem[], selectedIdea: null, script: '', wordCount: 0,
  estimatedDuration: 0, scenes: [] as Scene[], activeSceneIndex: 0,
        sceneHistory: [], sceneHistoryIndex: -1,
  jobId: null, prevJobId: null, videoUrl: null, renderProgress: 0, renderStage: '',
  renderStatus: 'idle' as const, uploadedVoicePath: null,
  voiceConfig: DEFAULT_VOICE,
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
        ...CLEAR_WORKFLOW,
        backendSynced: false,

        agencyProjectId: '',
        viewMode: 'personal',
        agencyProjectMeta: null as { title: string; client_name: string } | null,
        setAgencyProjectId: (id) => set({ agencyProjectId: id }),
        setViewMode: (mode) => set({ viewMode: mode }),
        setAgencyProjectMeta: (meta: { title: string; client_name: string } | null) => set({ agencyProjectMeta: meta }),

        // Atomic: sets agencyProjectId + currentStep in a single update
        // so Layout never sees a partial state (step changed, id not yet set)
        startAgencyVideo: (projectId: string, subStep?: string, sceneIndex?: number) => set({
          agencyProjectId: projectId,
          currentStep: 'agency-workflow' as AppStep,
          agencyWorkflowStep: subStep || 'setup',
          ...(sceneIndex !== undefined ? { activeSceneIndex: sceneIndex } : {}),
          // Reset workflow + config when starting fresh so personal settings don't bleed in
          ...(!subStep || subStep === 'setup' ? {
            ...CLEAR_WORKFLOW,
            config: DEFAULT_CONFIG,   // clear any personal/stale niche & config
          } : {}),
        }),

        // Jump directly to Export with an existing completed render — no setup needed
        startAgencyExport: (projectId: string, jobId: string, videoUrl: string) => set({
          agencyProjectId: projectId,
          currentStep:       'agency-workflow' as AppStep,
          agencyWorkflowStep: 'export',
          jobId,
          videoUrl,
          renderProgress: 100,
          renderStage:    'Done',
          renderStatus:   'complete' as const,
        }),

        // Within agency-workflow, track which sub-step we're on
        agencyWorkflowStep: 'setup' as string,
        setAgencyWorkflowStep: (step: string) => set({ agencyWorkflowStep: step }),

        setStep: (step) => {
          const current = get().currentStep
          const agencyProjId = get().agencyProjectId
          const personalSteps = ['projects', 'landing', 'login', 'upgrade', 'plans']
          const workflowSteps = ['setup','ideas','script','scenes','voice','export','upload']

          // If we're in agency-workflow mode and the step is a workflow sub-step,
          // redirect to agencyWorkflowStep instead of changing currentStep
          if (current === 'agency-workflow' && agencyProjId &&
              workflowSteps.includes(step as string)) {
            set({ agencyWorkflowStep: step as string })
            return
          }

          // Clear agency context when going to personal steps
          if (personalSteps.includes(step as string)) {
            set({ currentStep: step, agencyProjectId: '', agencyWorkflowStep: 'setup', agencyProjectMeta: null, config: DEFAULT_CONFIG })
          } else {
            set({ currentStep: step })
          }
        },
        markStepComplete: (step) => set((s) => ({
          completedSteps: new Set([...s.completedSteps, step])
        })),

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
              currentStep: 'setup',
              config: { ...DEFAULT_CONFIG, niche, style, platform },
              ...CLEAR_WORKFLOW,
            }
          })
          projectsApi.create({ id, name, niche, style, platform, folder })
            .then(() => set((s) => ({
              projects: s.projects.map((p) => p.id === id ? { ...p, synced: true } : p)
            })))
            .catch(() => {})
        },

        openProject: (id) => {
          const proj = get().projects.find((p) => p.id === id)
          if (!proj) return

          // If exported and has job_id — go straight to export with video ready
          if (proj.status === 'exported' && proj.job_id) {
            set({
              activeProjectId: id,
              currentStep: 'export',
              config: { ...DEFAULT_CONFIG, niche: proj.niche, style: proj.style, platform: proj.platform },
              ...CLEAR_WORKFLOW,
              jobId: proj.job_id,
              videoUrl: proj.video_url || null,
              renderStatus: 'complete',
              renderProgress: 100,
              renderStage: 'Done',
            })
            return
          }

          // Otherwise go to the step the project was last on
          set({
            activeProjectId: id,
            currentStep: (proj.step as AppStep) || 'setup',
            config: { ...DEFAULT_CONFIG, niche: proj.niche, style: proj.style, platform: proj.platform },
            ...CLEAR_WORKFLOW,
          })
        },

        updateProject: (id, patch) => {
          set((s) => ({
            projects: s.projects.map((p) => p.id === id ? { ...p, ...patch } : p),
          }))
          const project = get().projects.find((p) => p.id === id)
          if (project) {
            debounce(`project-${id}`, () => saveProjectToBackend({ ...project, ...patch }), 2000)
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
            ...proj, id: newId, name: proj.name + ' (copy)',
            createdAt: 'Just now', status: 'draft', synced: false,
            job_id: undefined, video_url: undefined,
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
          const { activeProjectId } = get()
          if (activeProjectId) {
            debounce(`idea-${activeProjectId}`, () => {
              projectsApi.update(activeProjectId, { selected_idea: idea as any }).catch(() => {})
            }, 1000)
          }
        },

        setScript: (script, wordCount, estimatedDuration) => {
          set({ script, wordCount, estimatedDuration })
          const { activeProjectId } = get()
          if (activeProjectId) {
            debounce(`script-${activeProjectId}`, () => {
              projectsApi.update(activeProjectId, { script } as any).catch(() => {})
            }, 3000)
          }
        },

        setScenes: (scenes) => {
          // Don't push history for setScenes — it's called on load, not user edits
          set({ scenes, activeSceneIndex: 0, sceneHistory: [scenes], sceneHistoryIndex: 0 })
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


        pushSceneHistory: (scenes) => set((s) => {
          // Truncate any redo states above current pointer
          const base = s.sceneHistory.slice(0, s.sceneHistoryIndex + 1)
          const next = [...base, scenes].slice(-30) // keep max 30
          return { sceneHistory: next, sceneHistoryIndex: next.length - 1 }
        }),

        undoScenes: () => set((s) => {
          const idx = s.sceneHistoryIndex - 1
          if (idx < 0) return s
          return { scenes: s.sceneHistory[idx], sceneHistoryIndex: idx }
        }),

        redoScenes: () => set((s) => {
          const idx = s.sceneHistoryIndex + 1
          if (idx >= s.sceneHistory.length) return s
          return { scenes: s.sceneHistory[idx], sceneHistoryIndex: idx }
        }),

        updateScene: (index, patch) => {
          set((s) => {
            const scenes = [...s.scenes]
            scenes[index] = { ...scenes[index], ...patch }
            // Push current scenes to history before applying
            const base = s.sceneHistory.slice(0, s.sceneHistoryIndex + 1)
            const history = [...base, s.scenes].slice(-30)
            return { scenes, sceneHistory: history, sceneHistoryIndex: history.length - 1 }
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
          const base = s.sceneHistory.slice(0, s.sceneHistoryIndex + 1)
          const history = [...base, s.scenes].slice(-30)
          return { scenes, activeSceneIndex: to, sceneHistory: history, sceneHistoryIndex: history.length - 1 }
        }),

        deleteScene: (index) => set((s) => {
          if (s.scenes.length <= 1) return s
          const scenes = s.scenes.filter((_, i) => i !== index)
          const base = s.sceneHistory.slice(0, s.sceneHistoryIndex + 1)
          const history = [...base, s.scenes].slice(-30)
          return { scenes, activeSceneIndex: Math.min(s.activeSceneIndex, scenes.length - 1), sceneHistory: history, sceneHistoryIndex: history.length - 1 }
        }),

        addScene: () => set((s) => {
          const newScene: Scene = {
            id: Date.now(), text: 'New scene — write the voiceover here.',
            visual: 'Describe what appears on screen.', duration: 5,
            type: 'main', visual_keyword: s.config.niche || 'business',
          }
          const base = s.sceneHistory.slice(0, s.sceneHistoryIndex + 1)
          const history = [...base, s.scenes].slice(-30)
          return { scenes: [...s.scenes, newScene], activeSceneIndex: s.scenes.length, sceneHistory: history, sceneHistoryIndex: history.length - 1 }
        }),

        duplicateScene: (index) => set((s) => {
          const original = s.scenes[index]
          const dupe = { ...original, id: Date.now() }
          const scenes = [...s.scenes]
          scenes.splice(index + 1, 0, dupe)
          const base = s.sceneHistory.slice(0, s.sceneHistoryIndex + 1)
          const history = [...base, s.scenes].slice(-30)
          return { scenes, activeSceneIndex: index + 1, sceneHistory: history, sceneHistoryIndex: history.length - 1 }
        }),

        setActiveSceneIndex: (i) => set({ activeSceneIndex: i }),
        setVoiceConfig: (cfg) => set((s) => ({ voiceConfig: { ...s.voiceConfig, ...cfg } })),
        setUploadedVoicePath: (path) => set({ uploadedVoicePath: path }),
        setJobId: (id) => set({ jobId: id }),
        setPrevJobId: (id) => set({ prevJobId: id }),
        setRenderProgress: (progress, stage, status) => set({
          renderProgress: progress, renderStage: stage, renderStatus: status
        }),

        setVideoUrl: (url) => {
          const { activeProjectId, jobId, agencyProjectId } = get()
          set({ videoUrl: url, renderStatus: 'complete' })
          // Notify UI to refresh video count and token balance
          try { document.dispatchEvent(new CustomEvent('sceneforge:render-complete')) } catch {}

          // Link job ID back to the agency project so scene review works
          if (agencyProjectId && jobId) {
            try {
              // Use fetch directly — no import needed, always available
              const token = (get() as any).token ||
                JSON.parse(localStorage.getItem('sceneforge-auth') || '{}')
                  ?.state?.token || '';
              if (token) {
                const base = (import.meta as any).env?.VITE_API_URL ||
                  'https://sceneforge-production-8d19.up.railway.app';
                fetch(`${base}/api/agency/projects/${agencyProjectId}`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    render_job_ids: [jobId],
                  }),
                }).catch(() => {});
              }
            } catch {}
          }

          if (activeProjectId) {
            // Save job_id + video_url on the project so openProject can restore it
            set((s) => ({
              projects: s.projects.map((p) =>
                p.id === activeProjectId
                  ? { ...p, status: 'exported', job_id: jobId || p.job_id, video_url: url, step: 'export' }
                  : p
              )
            }))
            projectsApi.update(activeProjectId, {
              status: 'exported' as any,
              video_url: url,
              job_id: jobId || undefined,
              step: 'export',
            }).catch(() => {})
          }
        },

        getIdeasRequest: () => {
          const { config } = get()
          return {
            niche:            config.niche,
            style:            config.style,
            platform:         config.platform,
            tone:             config.tone || '',
            audience:         config.audience || '',
            context:          config.context || '',
            idea_tags:        config.ideaTags || [],
            objective:        config.objective || '',
            duration_hint:    config.duration_hint ?? 60,
            scene_count_hint: config.scene_count_hint ?? 8,
            client_brief:     config.client_brief || '',
          }
        },

        getRenderRequest: (): RenderRequest => {
          const { scenes, voiceConfig, config, selectedIdea, uploadedVoicePath, projects, activeProjectId, agencyProjectId } = get()
          const activeProject = projects.find(p => p.id === activeProjectId)
          return {
            scenes,
            voice_name: voiceConfig.voice_name,
            voice_speed: voiceConfig.voice_speed,
            visual_source: voiceConfig.visual_source,
            subtitle_style: voiceConfig.subtitle_style,
            music: voiceConfig.music,
            project_title: selectedIdea?.title ?? activeProject?.name ?? 'Untitled',
            // Use config.platform, fall back to active project's platform, then TikTok
            platform: config.platform || activeProject?.platform || 'TikTok',
            uploaded_voice_path: uploadedVoicePath ?? null,
            project_id: activeProjectId ?? undefined,
            // Pass agency project ID so worker can load brand kit
            agency_project_id: agencyProjectId || undefined,
            motion:     voiceConfig.motion      ?? 'auto',
            transition: voiceConfig.transition  ?? 'fade',
            transition_duration: 0.4,
            prev_job_id: get().prevJobId ?? undefined,
          }
        },

        loadProjectsFromBackend: async () => {
          try {
            const serverProjects = await projectsApi.list()
            // Always update store — even empty array clears stale agency projects
            // from the sidebar when switching to personal view
            const converted: Project[] = serverProjects.map((sp) => ({
              id: sp.id, name: sp.name, niche: sp.niche, style: sp.style,
              platform: sp.platform, folder: sp.folder,
              status: (sp.status as any) || 'draft',
              sceneCount: sp.scene_count || 0, duration: sp.duration || 0,
              createdAt: sp.created_at ? new Date(sp.created_at).toLocaleDateString() : 'Unknown',
              step: (sp.step as AppStep) || 'setup',
              synced: true,
              job_id:    (sp as any).job_id    || undefined,
              video_url: (sp as any).video_url || undefined,
            }))
            const folders: Record<string, string[]> = {}
            converted.forEach((p) => {
              if (!folders[p.folder]) folders[p.folder] = []
              folders[p.folder].push(p.id)
            })
            set({ projects: converted, folders, backendSynced: true })
          } catch { /* silent */ }
        },

        syncLocalProjectsToBackend: async () => {
          const { projects } = get()
          const unsynced = projects.filter((p) => !p.synced)
          if (unsynced.length === 0) return
          try {
            await projectsApi.sync(unsynced.map((p) => ({
              id: p.id, name: p.name, niche: p.niche, style: p.style,
              platform: p.platform, folder: p.folder, status: p.status,
              step: p.step, scene_count: p.sceneCount, duration: p.duration,
            })))
            set((s) => ({ projects: s.projects.map((p) => ({ ...p, synced: true })) }))
          } catch { /* silent */ }
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
