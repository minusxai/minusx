import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import { defaultIframeInfoWeb, IframeInfoWeb } from '../../helpers/origin'

export type AppMode = 'sidePanel' | 'selection'
export type SidePanelTabName = 'chat' | 'settings' | 'context'
export type DevToolsTabName = 'Context' | 'Action History' | 'Prompts' | 'Available Actions' | 'Planner Configs' | 'Context History' | 'Testing Tools'


//--isAppOpen
//   |--yes
//   |  |--appMode: sidepanel
//   |  |  |--isDevToolsOpen
//   |  |  |  |--yes
//   |  |  |  |  '-- width: SidePanel + DevTools
//   |  |  |  |--no
//   |  |  |  |  '-- width: SidePanel
//   |  |--appMode: selection
//   |     '-- width: 100%
//   '--no

export interface SemanticMember { 
  name: string
  description: string
}

export interface SemanticFilter {
  or?: SemanticFilter[]
  and?: SemanticFilter[]
  member?: string
  operator?: string
  values?: string[]
}

export interface TimeDimension {
  dimension: string
  granularity?: 'day' | 'week' | 'month' | 'quarter' | 'year'
  dateRange?: string[] // [start, end], YYYY-MM-DD format
}

export type Order = [string, 'asc' | 'desc']

interface Settings {
  isLocal: boolean,
  uploadLogs: boolean,
  isAppOpen: boolean,
  appMode: AppMode,
  isDevToolsOpen: boolean,
  sidePanelTabName: SidePanelTabName,
  devToolsTabName: DevToolsTabName,
  suggestQueries: boolean,
  iframeInfo: IframeInfoWeb,
  confirmChanges: boolean
  demoMode: boolean
  intercomBooted: boolean
  isRecording: boolean
  aiRules: string
  savedQueries: boolean
  newSearch: boolean
  availableMeasures: SemanticMember[]
  availableDimensions: SemanticMember[]
  usedMeasures: string[]
  usedDimensions: string[]
  usedFilters: SemanticFilter[]
  usedTimeDimensions: TimeDimension[]
  usedOrder: Order[]
}

const initialState: Settings = {
  isLocal: false,
  uploadLogs: true,
  isAppOpen: true,
  appMode: 'sidePanel',
  isDevToolsOpen: false,
  sidePanelTabName: 'chat',
  devToolsTabName: 'Context',
  suggestQueries: false,
  iframeInfo: defaultIframeInfoWeb,
  confirmChanges: false,
  demoMode: false,
  intercomBooted: false,
  isRecording: false,
  aiRules: '',
  savedQueries: false,
  newSearch: false,
  availableMeasures: [],
  availableDimensions: [],
  usedMeasures: [],
  usedDimensions: [],
  usedFilters: [],
  usedTimeDimensions: [],
  usedOrder: []
}

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    updateIsLocal: (state, action: PayloadAction<boolean>) => {
      state.isLocal = action.payload
    },
    updateUploadLogs: (state, action: PayloadAction<boolean>) => {
      state.uploadLogs = action.payload
    },
    updateIsAppOpen: (state, action: PayloadAction<boolean>) => {
      state.isAppOpen = action.payload
    },
    updateAppMode: (state, action: PayloadAction<AppMode>) => {
      state.appMode = action.payload
    },
    updateIsDevToolsOpen: (state, action: PayloadAction<boolean>) => {
      state.isDevToolsOpen = action.payload
    },
    updateSidePanelTabName: (state, action: PayloadAction<SidePanelTabName>) => {
      state.sidePanelTabName = action.payload
    },
    updateDevToolsTabName: (state, action: PayloadAction<DevToolsTabName>) => {
      state.devToolsTabName = action.payload
    },
    setSuggestQueries: (state, action: PayloadAction<boolean>) => {
      state.suggestQueries = action.payload
    },
    setIframeInfo: (state, action: PayloadAction<IframeInfoWeb>) => {
      state.iframeInfo = action.payload
    },
    setConfirmChanges: (state, action: PayloadAction<boolean>) => {
      state.confirmChanges = action.payload
    },
    setDemoMode: (state, action: PayloadAction<boolean>) => {
      state.demoMode = action.payload
    },
    setAppRecording: (state, action: PayloadAction<boolean>) => {
      state.isRecording = action.payload
    },
    setAiRules: (state, action: PayloadAction<string>) => {
      state.aiRules = action.payload
    },
    setSavedQueries: (state, action: PayloadAction<boolean>) => {
      state.savedQueries = action.payload
    },
    setNewSearch: (state, action: PayloadAction<boolean>) => {
      state.newSearch = action.payload
    },
    setAvailableMeasures: (state, action: PayloadAction<SemanticMember[]>) => {
      state.availableMeasures = action.payload
    },
    setAvailableDimensions: (state, action: PayloadAction<SemanticMember[]>) => {
      state.availableDimensions = action.payload
    },
    setUsedMeasures: (state, action: PayloadAction<string[]>) => {
      state.usedMeasures = action.payload
    },
    setUsedDimensions: (state, action: PayloadAction<string[]>) => {
      state.usedDimensions = action.payload
    },
    setUsedFilters: (state, action: PayloadAction<SemanticFilter[]>) => {
      state.usedFilters = action.payload
    },
    setUsedTimeDimensions: (state, action: PayloadAction<TimeDimension[]>) => {
      state.usedTimeDimensions = action.payload
    },
    setUsedOrder: (state, action: PayloadAction<Order[]>) => {
      state.usedOrder = action.payload
    }
  }
})

// Action creators are generated for each case reducer function
export const { updateIsLocal, updateUploadLogs,
  updateIsAppOpen, updateAppMode, updateIsDevToolsOpen,
  updateSidePanelTabName, updateDevToolsTabName, setSuggestQueries,
  setIframeInfo, setConfirmChanges, setDemoMode, setAppRecording, setAiRules, setSavedQueries, setNewSearch,
  setAvailableMeasures, setAvailableDimensions, setUsedMeasures, setUsedDimensions, setUsedFilters,
  setUsedTimeDimensions, setUsedOrder
} = settingsSlice.actions

export default settingsSlice.reducer
