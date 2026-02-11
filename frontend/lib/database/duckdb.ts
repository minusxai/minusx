import * as duckdb from '@duckdb/duckdb-wasm'

let db: duckdb.AsyncDuckDB | null = null
let connection: duckdb.AsyncDuckDBConnection | null = null
let initPromise: Promise<duckdb.AsyncDuckDB> | null = null

// Generate a random table name
export function generateRandomTableName(): string {
  const adjectives = ['swift', 'bright', 'cosmic', 'silent', 'golden', 'frozen', 'crimson', 'velvet', 'lunar', 'stellar']
  const nouns = ['phoenix', 'dragon', 'eagle', 'falcon', 'raven', 'tiger', 'wolf', 'bear', 'lion', 'hawk']
  const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)]
  const randomNum = Math.floor(Math.random() * 9999)
  return `${randomAdj}_${randomNoun}_${randomNum}`
}

export async function initDuckDB() {
  // If already initialized, return existing db
  if (db && connection) return db

  // If initialization is in progress, wait for it
  if (initPromise) return initPromise

  // Start initialization
  initPromise = (async () => {
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles()

    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES)

    const worker_url = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    )

    const worker = new Worker(worker_url)
    const logger = new duckdb.ConsoleLogger()

    db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
    URL.revokeObjectURL(worker_url)

    connection = await db.connect()

    return db
  })()

  try {
    await initPromise
    return db!
  } finally {
    initPromise = null
  }
}

export async function getConnection() {
  if (!connection) {
    await initDuckDB()
  }
  return connection!
}

export interface NumberStats {
  type: 'number'
  min: number
  max: number
  avg: number
  unique: number
}

export interface DateStats {
  type: 'date'
  min: string
  max: string
  unique: number
}

export interface TextStats {
  type: 'text'
  unique: number
  topValues: Array<{ value: string; count: number }>
}

export type ColumnStats = NumberStats | DateStats | TextStats

export async function executeQuery<T = any>(query: string): Promise<T[]> {
  const conn = await getConnection()
  const result = await conn.query(query)
  return result.toArray() as T[]
}

export async function loadDataIntoTable(
  tableName: string,
  data: Record<string, any>[]
): Promise<void> {
  const conn = await getConnection()
  const db = await initDuckDB()

  await conn.query(`DROP TABLE IF EXISTS ${tableName}`)
  await db.registerFileText(`${tableName}.json`, JSON.stringify(data))
  await conn.query(`CREATE TABLE ${tableName} AS SELECT * FROM read_json_auto('${tableName}.json')`)
}

async function calculateNumberStats(tableName: string, column: string): Promise<NumberStats> {
  const query = `
    SELECT
      MIN("${column}") as min_val,
      MAX("${column}") as max_val,
      AVG("${column}") as avg_val,
      COUNT(DISTINCT "${column}") as unique_count
    FROM ${tableName}
    WHERE "${column}" IS NOT NULL
  `
  const rows = await executeQuery<{
    min_val: number
    max_val: number
    avg_val: number
    unique_count: number
  }>(query)

  const row = rows[0]

  return {
    type: 'number',
    min: Number(row.min_val),
    max: Number(row.max_val),
    avg: Number(row.avg_val),
    unique: Number(row.unique_count),
  }
}

async function calculateDateStats(tableName: string, column: string): Promise<DateStats> {
  const query = `
    SELECT
      CAST(MIN("${column}") AS VARCHAR) as min_val,
      CAST(MAX("${column}") AS VARCHAR) as max_val,
      COUNT(DISTINCT "${column}") as unique_count
    FROM ${tableName}
    WHERE "${column}" IS NOT NULL
  `
  const rows = await executeQuery<{
    min_val: string
    max_val: string
    unique_count: number
  }>(query)

  const row = rows[0]

  // Format dates nicely (just take the date part if it includes time)
  const formatDate = (dateStr: string) => {
    if (!dateStr) return dateStr
    // If it's just a date like "2025-01-01", return as is
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dateStr
    // If it has time, extract just the date part
    return dateStr.split(' ')[0] || dateStr
  }

  return {
    type: 'date',
    min: formatDate(String(row.min_val)),
    max: formatDate(String(row.max_val)),
    unique: Number(row.unique_count),
  }
}

async function calculateTextStats(tableName: string, column: string): Promise<TextStats> {
  const uniqueQuery = `
    SELECT COUNT(DISTINCT "${column}") as unique_count
    FROM ${tableName}
    WHERE "${column}" IS NOT NULL
  `
  const uniqueRows = await executeQuery<{ unique_count: number }>(uniqueQuery)

  // Get top 3 values by count
  const topValuesQuery = `
    SELECT
      "${column}" as value,
      COUNT(*) as count
    FROM ${tableName}
    WHERE "${column}" IS NOT NULL
    GROUP BY "${column}"
    ORDER BY count DESC
    LIMIT 4
  `
  const topValueRows = await executeQuery<{ value: string; count: number }>(topValuesQuery)

  return {
    type: 'text',
    unique: Number(uniqueRows[0].unique_count),
    topValues: topValueRows.map(row => ({
      value: String(row.value),
      count: Number(row.count),
    })),
  }
}

export function getColumnType(sqlType: string): 'number' | 'date' | 'text' {
  const type = sqlType.toUpperCase()

  if (
    type.includes('INT') ||
    type.includes('FLOAT') ||
    type.includes('DOUBLE') ||
    type.includes('DECIMAL') ||
    type.includes('NUMERIC') ||
    type.includes('REAL')
  ) {
    return 'number'
  }

  if (type.includes('DATE') || type.includes('TIME') || type.includes('TIMESTAMP')) {
    return 'date'
  }

  return 'text'
}

export async function calculateColumnStats(
  tableName: string,
  columns: string[],
  types: string[]
): Promise<Record<string, ColumnStats>> {
  try {
    const stats: Record<string, ColumnStats> = {}

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      const sqlType = types[i]
      const colType = getColumnType(sqlType)

      try {
        if (colType === 'number') {
          stats[col] = await calculateNumberStats(tableName, col)
        } else if (colType === 'date') {
          stats[col] = await calculateDateStats(tableName, col)
        } else {
          stats[col] = await calculateTextStats(tableName, col)
        }
      } catch (error) {
        console.error(`Error calculating stats for column ${col}:`, error)
      }
    }

    return stats
  } catch (error) {
    console.error('Error in calculateColumnStats:', error)
    return {}
  }
}
