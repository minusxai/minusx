import { RPCs } from 'web'
import { getTop200TablesWithoutFieldsForSelectedDb, getDatabaseInfoForSelectedDb, extractTableInfo } from './getDatabaseSchema';
import { getAndFormatOutputTable, getSqlErrorMessage } from './operations';
import { isDashboardPage } from './dashboard/util';
import { DashboardInfo } from './dashboard/types';
import { getDashboardAppState } from './dashboard/appState';

const { getMetabaseState, queryURL } = RPCs;
interface ExtractedTable {
  name: string;
  description?: string;
  schema?: string;
  id: number;
}

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

export interface MetabaseAppStateSQLEditor {
  databaseInfo?: ExtractedDataBase;
  relevantTables: ExtractedTable[];
  sqlQuery: string;
  sqlErrorMessage?: string;
  queryExecuted: boolean;
  sqlEditorState: 'open' | 'closed' | 'unknown';
  visualizationType: string;
  visualizationSettingsStatus: 'open' | 'closed';
  outputTableMarkdown: string
}

// make this DashboardInfo
export interface MetabaseAppStateDashboard extends DashboardInfo {}

export type MetabaseAppState = MetabaseAppStateSQLEditor | MetabaseAppStateDashboard

export async function convertDOMtoStateSQLQuery() {
  // CAUTION: This one does not update when changed via ui for some reason
  // const dbId = _.get(hashMetadata, 'dataset_query.database');
  const databaseInfo = await getDatabaseInfoForSelectedDb();
  const selectedDatabaseSchema = await getTop200TablesWithoutFieldsForSelectedDb();
  const tables = selectedDatabaseSchema? selectedDatabaseSchema.tables.map(table => extractTableInfo(table)) : [];

  const queryExecuted = await getMetabaseState('qb.queryResults') !== null;
  const isNativeEditorOpen = await getMetabaseState('qb.uiControls.isNativeEditorOpen')
  const sqlErrorMessage = await getSqlErrorMessage();
  const outputTableMarkdown = await getAndFormatOutputTable();
  const sqlQuery = await getMetabaseState('qb.card.dataset_query.native.query')
  const isShowingRawTable = await getMetabaseState('qb.uiControls.isShowingRawTable')
  const isShowingChartTypeSidebar = await getMetabaseState('qb.uiControls.isShowingChartTypeSidebar')
  const vizType = await getMetabaseState('qb.card.display')
  const metabaseAppStateSQLEditor: MetabaseAppStateSQLEditor = {
    databaseInfo,
    relevantTables: tables,
    sqlQuery,
    queryExecuted,
    sqlEditorState: isNativeEditorOpen ? 'open' : 'closed',
    visualizationType: isShowingRawTable ? 'table' : vizType,
    visualizationSettingsStatus: isShowingChartTypeSidebar ? 'open' : 'closed',
    outputTableMarkdown,
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

export async function convertDOMtoState() {
  const url = await queryURL();
  if (isDashboardPage(url)) {
    return await convertDOMtoStateDashboard();
  } else {
    return await convertDOMtoStateSQLQuery();
  }
}