import { dispatch } from "../state/dispatch"
import { getState, RootState } from "../state/store"
import { SemanticQuery } from 'web/types'
import { setSemanticQuery } from "../state/thumbnails/reducer"

export const getAppSettings = () => {
  const state: RootState = getState()
  const settings = state.settings
  return {
    savedQueries: settings.savedQueries,
    semanticPlanner: settings.demoMode,
    tableDiff: settings.tableDiff,
    drMode: settings.drMode,
    selectedCatalog: settings.selectedCatalog,
    availableCatalogs: settings.availableCatalogs,
    snippetsMode: settings.snippetsMode,
  }
}

export const getCache = () => {
  const state: RootState = getState()
  return {
    mxCollectionId: state.cache.mxCollectionId,
    mxModels: state.cache.mxModels,
  }
}

export const getSemanticInfo = () => {
  const state: RootState = getState()
  return {
    semanticLayer: state.semanticLayer,
    semanticQuery: state.thumbnails.semanticQuery,
    currentSemanticLayer: state.thumbnails.semanticLayer
  }
}

export const applySemanticQuery = (query: SemanticQuery) => {
  dispatch(setSemanticQuery(query))
}