import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  workspace_id?: string | null
  workspace_role?: string | null
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean

  setAuth: (user: User, token: string) => void
  updateUser: (user: User) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      setAuth: (user, token) => {
        set({ user, token, isAuthenticated: true })
        import('./store').then(({ useStore }) => {
          const store = useStore.getState()
          // Clear any locally cached projects from a previous user session first
          useStore.setState({
            projects: [],
            folders: {},
            folderOpen: {},
            activeProjectId: null,
            backendSynced: false,
          })
          // Then load this user's projects from the backend
          store.loadProjectsFromBackend()
        }).catch(() => {})
      },

      updateUser: (user) =>
        set({ user }),

      logout: () => {
        set({ user: null, token: null, isAuthenticated: false })
        import('./store').then(({ useStore }) => {
          useStore.setState({
            projects: [],
            folders: {},
            folderOpen: {},
            activeProjectId: null,
            backendSynced: false,
            scenes: [],
            selectedIdea: null,
            script: '',
            jobId: null,
            videoUrl: null,
            renderStatus: 'idle',
          })
        }).catch(() => {})
      },
    }),
    {
      name: 'sceneforge-auth',
      // Only persist token + user — not the whole app state
      partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated }),
    }
  )
)
