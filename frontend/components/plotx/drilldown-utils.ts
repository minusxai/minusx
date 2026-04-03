/**
 * Build a CTE-wrapped SQL query with WHERE clauses from drill-down filters.
 * Column names are double-quoted (SQL standard / DuckDB compatible).
 */
export function buildDrillDownSql(
  sql: string,
  filters: Record<string, string>,
  filterTypes: Record<string, string>
): string {
  const whereClauses = Object.entries(filters).map(([col, val]) => {
    const colType = filterTypes[col]
    if (colType === 'number') {
      return `"${col}" = ${Number(val)}`
    }
    const escapedVal = String(val).replace(/'/g, "''")
    return `"${col}" = '${escapedVal}'`
  })
  const whereClause = whereClauses.length > 0 ? `\nWHERE ${whereClauses.join('\n  AND ')}` : ''
  return `WITH base AS (\n${sql}\n)\nSELECT * FROM base${whereClause}`
}
