import { RPCs } from 'web'
import { getRelevantTablesForSelectedDb, getDatabaseInfoForSelectedDb, extractTableInfo, memoizedGetDatabases, memoizedGetDatabaseTablesWithoutFields, extractDbInfo } from './getDatabaseSchema';
import { getAndFormatOutputTable, getSqlErrorMessage } from './operations';
import { isDashboardPage } from './dashboard/util';
import { DashboardInfo } from './dashboard/types';
import { getDashboardAppState } from './dashboard/appState';
import { visualizationSettings, Card, ParameterValues, FormattedTable } from './types';
const { getMetabaseState, queryURL } = RPCs;
import { Measure, Dimension, SemanticQuery } from "web/types";
import { applyTableDiffs, handlePromise } from '../../common/utils';
import { getSelectedDbId } from './getUserInfo';

interface ExtractedDataBase {
  name: string;
  description?: string;
  id: number;
  dialect: string;
  dbms_version: {
    flavor: string;
    version: string;
    semantic_version: number[];
  }
}

interface ExtractedTable {
  name: string;
  description?: string;
  schema?: string;
  id: number;
}


export interface MetabaseAppStateSQLEditor {
  availableDatabases?: string[];
  selectedDatabaseInfo?: ExtractedDataBase;
  relevantTables: ExtractedTable[];
  sqlQuery: string;
  sqlVariables: {
    [key: string]: {
      value: string,
      type: string,
      displayName: string
    }
  }
  sqlErrorMessage?: string;
  queryExecuted: boolean;
  sqlEditorState: 'open' | 'closed' | 'unknown';
  visualizationType: string;
  visualizationSettingsStatus: 'open' | 'closed';
  outputTableMarkdown: string
  visualizationSettings: visualizationSettings,
}

// make this DashboardInfo
export interface MetabaseAppStateDashboard extends DashboardInfo {}

export interface MetabaseSemanticQueryAppState {
  availableMeasures: Measure[];
  availableDimensions: Dimension[];
  currentSemanticQuery: SemanticQuery;
  dialect?: string;
  outputTableMarkdown?: string;
  currentSemanticLayer?: string;
}

export type MetabaseAppState = MetabaseAppStateSQLEditor | MetabaseAppStateDashboard | MetabaseSemanticQueryAppState;

export async function convertDOMtoStateSQLQuery() {
  // CAUTION: This one does not update when changed via ui for some reason
  // const dbId = _.get(hashMetadata, 'dataset_query.database');
  const availableDatabases = (await memoizedGetDatabases())?.data?.map(({ name }) => name);
  const selectedDatabaseInfo = await getDatabaseInfoForSelectedDb();
  const sqlQuery = await getMetabaseState('qb.card.dataset_query.native.query') as string
  const tables = (await getRelevantTablesForSelectedDb(sqlQuery)).map(table => extractTableInfo(table));
  const dbId = await getSelectedDbId()
  const relevantTables = await (async () => {
    if (!dbId) {
      return []
    }
    const appSettings = RPCs.getAppSettings()
    console.log('App settings are', appSettings)
    const dbTables = await handlePromise(memoizedGetDatabaseTablesWithoutFields(dbId), "Failed to get database tables", {
      ...extractDbInfo({}),
      tables: []
    })
    return applyTableDiffs(tables, dbTables.tables, appSettings.tableDiff, dbId)
  })()
  

  const queryExecuted = await getMetabaseState('qb.queryResults') !== null;
  const isNativeEditorOpen = await getMetabaseState('qb.uiControls.isNativeEditorOpen')
  const sqlErrorMessage = await getSqlErrorMessage();
  const outputTableMarkdown = await getAndFormatOutputTable();
  const isShowingRawTable = await getMetabaseState('qb.uiControls.isShowingRawTable')
  const isShowingChartTypeSidebar = await getMetabaseState('qb.uiControls.isShowingChartTypeSidebar')
  const vizType = await getMetabaseState('qb.card.display') as string
  const visualizationSettings = await getMetabaseState('qb.card.visualization_settings') as visualizationSettings
  const sqlVariables = await getSqlVariables();
  const metabaseAppStateSQLEditor: MetabaseAppStateSQLEditor = {
    availableDatabases,
    selectedDatabaseInfo,
    relevantTables,
    sqlQuery,
    queryExecuted,
    sqlEditorState: isNativeEditorOpen ? 'open' : 'closed',
    visualizationType: isShowingRawTable ? 'table' : vizType,
    visualizationSettingsStatus: isShowingChartTypeSidebar ? 'open' : 'closed',
    outputTableMarkdown,
    visualizationSettings,
    sqlVariables,
  };
  if (sqlErrorMessage) {
    metabaseAppStateSQLEditor.sqlErrorMessage = sqlErrorMessage;
  }
  return metabaseAppStateSQLEditor;
}

// check if on dashboard page
export async function convertDOMtoStateDashboard(): Promise<MetabaseAppStateDashboard> {
    const dashboardInfo = await getDashboardAppState();
    return dashboardInfo as MetabaseAppStateDashboard;
};

export async function semanticQueryState() {
  const { semanticLayer, semanticQuery, currentSemanticLayer } = RPCs.getSemanticInfo()
  const { availableMeasures, availableDimensions } = semanticLayer
  const selectedDatabaseInfo = await getDatabaseInfoForSelectedDb();
  const outputTableMarkdown = await getAndFormatOutputTable();
  
  const metabaseSemanticQueryAppState: MetabaseSemanticQueryAppState = {
    availableMeasures,
    availableDimensions,
    currentSemanticQuery: semanticQuery,
    dialect: selectedDatabaseInfo?.dialect,
    outputTableMarkdown,
    currentSemanticLayer
  }
  return metabaseSemanticQueryAppState;
}

export async function convertDOMtoState() {
  const url = await queryURL();
  if (isDashboardPage(url)) {
    return await convertDOMtoStateDashboard();
  }
  const appSettings = RPCs.getAppSettings()
  if(appSettings.semanticPlanner) {
    return await semanticQueryState();
  }
  return await convertDOMtoStateSQLQuery();
}
async function getSqlVariables() {
  const currentCard = await RPCs.getMetabaseState("qb.card") as Card;
  if (!currentCard) {
    return {};
  }
  const currentParameterValues = await RPCs.getMetabaseState("qb.parameterValues") as ParameterValues;
  const parameters = currentCard.dataset_query.native['template-tags'];
  const sqlVariables: Record<string, {
    value: string,
    type: string,
    displayName: string
  }> = {};
  for (const [key, value] of Object.entries(parameters)) {
    const parameterId = value.id;
    const parameterValue = currentParameterValues[parameterId];
    sqlVariables[key] = {
      value: parameterValue,
      type: value.type,
      displayName: value['display-name']
    };
  }
  return sqlVariables; 
}
