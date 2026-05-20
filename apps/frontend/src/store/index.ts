import { create } from 'zustand'

interface AppStore {
  activeProjectId: string | null
  liveLogsPaused: boolean
  setActiveProject: (id: string | null) => void
  setLiveLogsPaused: (paused: boolean) => void
}

export const useAppStore = create<AppStore>((set) => ({
  activeProjectId: null,
  liveLogsPaused: false,
  setActiveProject: (id) => set({ activeProjectId: id }),
  setLiveLogsPaused: (paused) => set({ liveLogsPaused: paused }),
}))
