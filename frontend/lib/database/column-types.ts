export type ColumnType = 'number' | 'date' | 'text' | 'json'

export function getColumnType(sqlType: string): ColumnType {
  const type = sqlType.toUpperCase()

  if (
    type.includes('INT') ||
    type.includes('FLOAT') ||
    type.includes('DOUBLE') ||
    type.includes('DECIMAL') ||
    type.includes('NUMERIC') ||
    type.includes('REAL') ||
    type.includes('SERIAL')
  ) {
    return 'number'
  }

  if (type.includes('DATE') || type.includes('TIME') || type.includes('TIMESTAMP')) {
    return 'date'
  }

  if (
    type.includes('JSON') ||
    type.includes('STRUCT') ||
    type.includes('MAP') ||
    type.includes('LIST') ||
    type.includes('ARRAY')
  ) {
    return 'json'
  }

  return 'text'
}

export function buildColumnTypesMap(columns: string[], types: string[]): Record<string, ColumnType> {
  return Object.fromEntries(
    columns.map((column, index) => [column, types[index] ? getColumnType(types[index]) : 'text'])
  )
}
