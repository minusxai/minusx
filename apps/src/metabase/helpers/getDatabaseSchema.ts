import { memoize, RPCs } from 'web'
import { FormattedTable, SearchApiResponse } from './types';
import { getTablesFromSqlRegex, TableAndSchema } from './parseSql';
import _, { get, isEmpty } from 'lodash';
import { getSelectedDbId, getUserTableMap, getUserTables, searchUserQueries } from './getUserInfo';
import { applyTableDiffs, handlePromise } from '../../common/utils';
import { TableDiff } from 'web/types';
import { extractTableInfo, fetchTableData } from './parseTables';

const { fetchData } = RPCs;

// this is a subset
interface DatabaseResponse {
  total: number;
  data: {
    name: string;
    id: number;
  }[]
}
async function getDatabases() {
  const resp = await fetchData('/api/database', 'GET') as DatabaseResponse
  return resp;
}
export const memoizedGetDatabases = memoize(getDatabases);

export async function getDatabaseIds(): Promise<number[]> {
  const resp = await memoizedGetDatabases();
  if (!resp || !resp.data) {
    console.error('Failed to get database ids', resp);
    return [];
  }
  return _.map(resp.data, (db: any) => db.id);
}

export interface DatabaseInfo {
  name: string;
  description: string;
  id: number;
  dialect: string;
  default_schema?: string;
  dbms_version: {
    flavor: string;
    version: string;
    semantic_version: number[];
  }
}

export interface DatabaseInfoWithTables extends DatabaseInfo {
  tables: FormattedTable[];
}

export const extractDbInfo = (db: any, default_schema: string): DatabaseInfo => ({
  name: _.get(db, 'name', ''),
  description: _.get(db, 'description', ''),
  id: _.get(db, 'id', 0),
  dialect: _.get(db, 'engine', ''),
  default_schema,
  dbms_version: {
    flavor: _.get(db, 'dbms_version.flavor', ''),
    version: _.get(db, 'dbms_version.version', ''),
    semantic_version: _.get(db, 'dbms_version.semantic-version', [])
  },
});

function getDefaultSchema(databaseInfo) {
  const engine = databaseInfo?.engine;
  const details = databaseInfo?.details || {};
  
  // If schema is explicitly set, always respect it
  if (details.schema) {
    return details.schema;
  }

  // Mapping of default schemas
  const DEFAULT_SCHEMAS = {
    postgres: "public",
    redshift: "public",
    sqlserver: "dbo",
    duckdb: "main",
    sqlite: "main",
    h2: "PUBLIC"
  };

  if (engine in DEFAULT_SCHEMAS) {
    return DEFAULT_SCHEMAS[engine];
  }

  // Engines where schema = database name
  if (["mysql", "mariadb", "clickhouse"].includes(engine)) {
    return details.dbname || null;
  }

  // BigQuery case: dataset_id behaves like schema
  if (engine === "bigquery") {
    return details.dataset_id || null;
  }

  // Snowflake: no reliable way unless explicitly set
  if (engine === "snowflake") {
    return null;
  }

  // MongoDB: no schema concept
  if (engine === "mongo") {
    return null;
  }

  // Presto/Trino: no real default schema, needs explicit context
  if (["presto", "trino", "starburst"].includes(engine)) {
    return null;
  }

  // Default fallback
  return null;
}

/**
 * Get the database tables without their fields
 * @param dbId id of the database
 * @returns tables without their fields
 */
async function getDatabaseTablesWithoutFields(dbId: number): Promise<DatabaseInfoWithTables> {
  const jsonResponse = await fetchData(`/api/database/${dbId}?include=tables`, 'GET');
  const defaultSchema = getDefaultSchema(jsonResponse);
  const tables = await Promise.all(
      _.map(_.get(jsonResponse, 'tables', []), (table: any) => extractTableInfo(table, false))
  );

  return {
      ...extractDbInfo(jsonResponse, defaultSchema),
      tables: tables || []
  };
}
export const memoizedGetDatabaseTablesWithoutFields = memoize(getDatabaseTablesWithoutFields);

// only database info, no table info at all
const getDatabaseInfo = async (dbId: number) => {
  const jsonResponse = await fetchData(`/api/database/${dbId}`, 'GET');
  const defaultSchema = getDefaultSchema(jsonResponse);
  return {
    ...extractDbInfo(jsonResponse, defaultSchema),
  }
};

export const memoizedGetDatabaseInfo = memoize(getDatabaseInfo);

export const getDatabaseInfoForSelectedDb = async () => {
  const dbId = await getSelectedDbId();
  return dbId? await memoizedGetDatabaseInfo(dbId) : undefined;
}

export async function logMetabaseVersion() {
  const response: any = await fetchData("/api/session/properties", "GET"); 
  const apiVersion = response?.version;
  if (!apiVersion) {
    console.error("Failed to parse metabase version", response);
    return;
  }
  console.log("Metabase version", apiVersion);
}

function getTableKey<T extends TableAndSchema>(tableInfo: T): string {
  return `${tableInfo.schema?.toLowerCase()}.${tableInfo.name.toLowerCase()}`;
}

function dedupeAndCountTables<T extends TableAndSchema>(tables: T[]): T[] {
  const counts: Record<string, T> = {}
  tables.forEach(tableInfo => {
    const key = getTableKey(tableInfo);
    const existingCount = tableInfo.count || 1;
    const totalCounts = counts[key]?.count || 0;
    counts[key] = {
      ...tableInfo,
      count: totalCounts + existingCount
    }
  })
  return _.chain(counts).toArray().orderBy(['count'], ['desc']).value();
}

function lowerAndDefaultSchemaAndDedupe(tables: TableAndSchema[]): TableAndSchema[] {
  let lowered = tables.map(tableInfo => ({
    name: tableInfo.name.toLowerCase(),
    schema: tableInfo.schema?.toLowerCase() || 'public',
    count: tableInfo.count
  }));
  return dedupeAndCountTables(lowered);
}

const validateTablesInDB = (tables: TableAndSchema[], allDBTables: FormattedTable[], default_schema?: string) => {
  const allTablesAsMap = _.fromPairs(allDBTables.map(tableInfo => [getTableKey(tableInfo), tableInfo]));
  if (default_schema) {
    tables = tables.map(tableInfo => {
      return {
        ...tableInfo,
        schema: tableInfo.schema?.toLowerCase() || default_schema.toLowerCase()
      }
    })
  }
  return tables.filter(
    tableInfo => getTableKey(tableInfo) in allTablesAsMap
  ).map(tableInfo => ({
    ...tableInfo,
    ...allTablesAsMap[getTableKey(tableInfo)]
  }))
}

const addTableJoins = (tables: FormattedTable[], tableMap: Record<number, number[][]>) => {
  return tables.map(tableInfo => {
    return ({
      ...tableInfo,
      ...(tableInfo.id in tableMap ? {
        related_tables_freq: tableMap[tableInfo.id]
      } : {}),
    })
  })
}

const getAllRelevantTablesForSelectedDb = async (dbId: number, sql: string): Promise<FormattedTable[]> => {
  const tablesFromSql = lowerAndDefaultSchemaAndDedupe(getTablesFromSqlRegex(sql));
  const [userTables, {tables: allDBTables, default_schema}, tableMap] = await Promise.all([
    getUserTables(),
    handlePromise(memoizedGetDatabaseTablesWithoutFields(dbId), "Failed to get database tables", {
      ...extractDbInfo({}, ''),
      tables: []
    }),
    getUserTableMap()
  ]);
  const allUserTables = dedupeAndCountTables([...tablesFromSql, ...userTables]);
  const validTables = validateTablesInDB(allUserTables, allDBTables, default_schema);
  const dedupedTables = dedupeAndCountTables([...validTables, ...allDBTables]);
  dedupedTables.forEach(tableInfo => {
    tableInfo.count = tableInfo.count || 1;
    tableInfo.count = tableInfo.count - 1
  })
  const fullTableInfo = addTableJoins(dedupedTables, tableMap);
  return fullTableInfo
}

export const searchTables = async (userId: number, dbId: number, query: string): Promise<FormattedTable[]> => {
  const [userTables, {tables: allDBTables, default_schema}] = await Promise.all([
    searchUserQueries(userId, dbId, query),
    memoizedGetDatabaseTablesWithoutFields(dbId),
  ]).catch(err => {
    console.warn("[minusx] Error getting search tables", err);
    throw err;
  });
  const allUserTables = dedupeAndCountTables(userTables);
  const validTables = validateTablesInDB(allUserTables, allDBTables, default_schema);
  const dedupedTables = dedupeAndCountTables(validTables)
  return dedupedTables
}

export const getTablesWithFields = async (tableDiff?: TableDiff, drMode = false, isCatalogSelected: boolean = false, sqlTables: TableAndSchema[] = []) => {
  const dbId = await getSelectedDbId();
  if (!dbId) {
    console.warn("[minusx] No database selected when getting tables with fields");
    return [];
  }
  let tables = await getAllRelevantTablesForSelectedDb(dbId, '');
  // Don't apply a table diff if a catalog is selected in dr mode. We need all tables.
  if (tableDiff && !(isCatalogSelected && drMode)) {
    tables = applyTableDiffs(tables, tableDiff, dbId, sqlTables);
  }
  if (!drMode) {
    return tables;
  }
  // if in deep research mode and a non-default catalog is selected, we don't need
  // table fields since we'll be using the catalog instead
  if (isCatalogSelected) {
    return tables;
  }
  const tableIds = tables.map((table) => table.id);
  let tableInfos = await Promise.all(tableIds.map(id => fetchTableData(id)));
  return tableInfos.filter(tableInfo => tableInfo != "missing")
}

export const getRelevantTablesForSelectedDb = async (sql: string): Promise<FormattedTable[]> => {
  const dbId = await getSelectedDbId();
  if (!dbId) {
    console.warn("[minusx] No database selected when getting relevant tables");
    return [];
  }
  const relevantTables = await getAllRelevantTablesForSelectedDb(dbId, sql);
  
  // Filter out tables with > 100 columns to reduce context size
  // Fetch all table data in parallel for better performance
  const tableDataPromises = relevantTables.slice(0, 30).map(async (table) => {
    try {
      const tableWithFields = await fetchTableData(table.id, false);
      if (tableWithFields !== "missing") {
        const columnCount = Object.keys(tableWithFields.columns || {}).length;
        return { table, columnCount, valid: columnCount <= 100 };
      }
    } catch (error) {
      // If we can't fetch table data, include it anyway to be safe
      return { table, columnCount: 0, valid: true };
    }
    return { table, columnCount: 0, valid: false };
  });

  const tableResults = await Promise.all(tableDataPromises);
  
  // Filter and limit to 20 tables
  const filteredTables = tableResults
    .filter(result => result.valid)
    .slice(0, 20)
    .map(result => result.table);
  
  return filteredTables;
}

// Empty Placeholder
export const getTopSchemasForSelectedDb = async () => {
  return []
}
// this is a subset
interface MetabaseCard {
  query_type: "query" | "native" | string;
}
export const getCardsCountSplitByType = async () => {
  const allCards = await fetchData(`/api/card?f=mine`, 'GET') as MetabaseCard[];
  const queryCards = allCards.filter(card => card.query_type === "query");
  const nativeCards = allCards.filter(card => card.query_type === "native");
  return {
    query: queryCards.length,
    native: nativeCards.length
  }
}
