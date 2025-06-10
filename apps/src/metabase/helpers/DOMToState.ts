import { RPCs } from 'web'
import { getRelevantTablesForSelectedDb, getTablesWithFields } from './getDatabaseSchema';
import { getDatabaseInfo, getDatabases, getDatabaseTablesWithoutFields } from './metabaseAPIHelpers';
import { getAndFormatOutputTable, getSqlErrorMessage } from './operations';
import { isDashboardPageUrl } from './dashboard/util';
import { DashboardInfo } from './dashboard/types';
import { getDashboardAppState } from './dashboard/appState';
import { visualizationSettings, Card, ParameterValues, FormattedTable } from './types';
const { queryURL } = RPCs;
import { Measure, Dimension, SemanticQuery, TableInfo } from "web/types";
import { applyTableDiffs, handlePromise } from '../../common/utils';
import { getSelectedDbId, getCurrentQuery, hasQueryResults, isNativeEditorOpen, isShowingRawTable, isShowingChartTypeSidebar, getVisualizationType, getVisualizationSettings, getCurrentCard, getParameterValues } from './metabaseStateAPI';
import { add, assignIn, find, get, keyBy, map } from 'lodash';
import { getTablesFromSqlRegex } from './parseSql';
import { getTableContextYAML } from './catalog';
import { catalogAsModels } from 'web';
import { canUseModelsModeForCatalog } from '../../../../web/src/helpers/catalogAsModels';

const {modifySqlForMxModels} = catalogAsModels

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

export enum MetabaseAppStateType {
    SQLEditor = 'metabaseSQLEditor',
    Dashboard = 'metabaseDashboard',
    SemanticQuery = 'metabaseSemanticQuery'
}
export interface MetabaseAppStateSQLEditor {
  type: MetabaseAppStateType.SQLEditor;
  availableDatabases?: string[];
  selectedDatabaseInfo?: ExtractedDataBase;
  relevantTables: ExtractedTable[];
  tableContextYAML?: Record<string, any>;
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
  metabaseOrigin?: string;
}

// make this DashboardInfo
export interface MetabaseAppStateDashboard extends DashboardInfo {
  type: MetabaseAppStateType.Dashboard;
  tableContextYAML?: Record<string, any>;
  selectedDatabaseInfo?: ExtractedDataBase;
  metabaseOrigin?: string;
}

export interface MetabaseSemanticQueryAppState {
  type: MetabaseAppStateType.SemanticQuery;
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
  const url = new URL(await RPCs.queryURL()).origin;
  const availableDatabases = (await getDatabases())?.data?.map(({ name }) => name);
  const dbId = await getSelectedDbId();
  const selectedDatabaseInfo = dbId ? await getDatabaseInfo(dbId) : undefined;
  const defaultSchema = selectedDatabaseInfo?.default_schema;
  const sqlQuery = await getCurrentQuery()
  const appSettings = RPCs.getAppSettings()
  const cache = RPCs.getCache()
  const sqlTables = getTablesFromSqlRegex(sqlQuery)
  const selectedCatalogObj = find(appSettings.availableCatalogs, { name: appSettings.selectedCatalog })
  const selectedCatalog = get(selectedCatalogObj, 'content')
  if (defaultSchema) {
    sqlTables.forEach((table) => {
      if (table.schema === undefined || table.schema === '') {
        table.schema = defaultSchema
      }
    })
  }
  let relevantTablesWithFields = await getTablesWithFields(appSettings.tableDiff, appSettings.drMode, !!selectedCatalog, sqlTables)
  // add defaultSchema back to relevantTablesWithFields. kind of hacky but whatever
  relevantTablesWithFields = relevantTablesWithFields.map(table => {
    if (table.schema === undefined || table.schema === '') {
      table.schema = defaultSchema || 'unknown'
    }
    return table
  })
  const tableContextYAML = getTableContextYAML(relevantTablesWithFields, selectedCatalog, appSettings.drMode);
  
  const queryExecuted = await hasQueryResults();
  const nativeEditorOpen = await isNativeEditorOpen()
  const sqlErrorMessage = await getSqlErrorMessage();
  const outputTableMarkdown = await getAndFormatOutputTable();
  const showingRawTable = await isShowingRawTable()
  const showingChartTypeSidebar = await isShowingChartTypeSidebar()
  const vizType = await getVisualizationType()
  const visualizationSettings = await getVisualizationSettings() as visualizationSettings
  const sqlVariables = await getSqlVariables();
  const metabaseAppStateSQLEditor: MetabaseAppStateSQLEditor = {
    type: MetabaseAppStateType.SQLEditor,
    availableDatabases,
    selectedDatabaseInfo,
    relevantTables: relevantTablesWithFields,
    sqlQuery,
    queryExecuted,
    sqlEditorState: nativeEditorOpen ? 'open' : 'closed',
    visualizationType: showingRawTable ? 'table' : vizType,
    visualizationSettingsStatus: showingChartTypeSidebar ? 'open' : 'closed',
    outputTableMarkdown,
    visualizationSettings,
    sqlVariables,
    metabaseOrigin: url
  };
  if (appSettings.drMode) {
    metabaseAppStateSQLEditor.tableContextYAML = tableContextYAML;
    metabaseAppStateSQLEditor.relevantTables = []
    if (appSettings.modelsMode && selectedCatalogObj && canUseModelsModeForCatalog(selectedCatalogObj, cache.mxModels)) {
      metabaseAppStateSQLEditor.sqlQuery = modifySqlForMxModels(metabaseAppStateSQLEditor.sqlQuery, get(selectedCatalog, 'entities', []), appSettings.selectedCatalog, cache.mxModels)
    }
  }
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
  const dbId = await getSelectedDbId();
  const selectedDatabaseInfo = dbId ? await getDatabaseInfo(dbId) : undefined;
  const outputTableMarkdown = await getAndFormatOutputTable();
  
  const metabaseSemanticQueryAppState: MetabaseSemanticQueryAppState = {
    type: MetabaseAppStateType.SemanticQuery,
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
  if (isDashboardPageUrl(url)) {
    return await convertDOMtoStateDashboard();
  }
  const appSettings = RPCs.getAppSettings()
  if(appSettings.semanticPlanner) {
    return await semanticQueryState();
  }
  return await convertDOMtoStateSQLQuery();
}
async function getSqlVariables() {
  const currentCard = await getCurrentCard() as Card;
  if (!currentCard) {
    return {};
  }
  const currentParameterValues = await getParameterValues() as ParameterValues;
  const parameters = currentCard.dataset_query.native['template-tags'];
  const sqlVariables: Record<string, {
    value: string,
    type: string,
    displayName: string
  }> = {};
  // ignore snippets and models
  // snippets are parameters that start with snippet:
  // models are parameters that start with #modelNumber-modelSlug
  // keep in mind leading spaces
  for (const [key, value] of Object.entries(parameters)) {
    const parameterId = value.id;
    const parameterValue = currentParameterValues[parameterId];
    const snippetsRegex = /^\s*snippet:/g;
    const modelsRegex = /^\s*#(\d+)/g;
    if (!snippetsRegex.test(key) && !modelsRegex.test(key)) {
      sqlVariables[key] = {
        value: parameterValue,
        type: value.type,
        displayName: value['display-name']
      };
    }
  }
  return sqlVariables; 
}
