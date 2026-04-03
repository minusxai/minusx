import { buildDrillDownSql } from '@/components/plotx/drilldown-utils'

describe('buildDrillDownSql', () => {
  const baseSql = 'SELECT * FROM orders'

  it('wraps column names in double quotes, not backticks', () => {
    const result = buildDrillDownSql(baseSql, { org: 'OpenAI' }, { org: 'text' })
    expect(result).toContain('"org"')
    expect(result).not.toContain('`org`')
  })

  it('builds a CTE with WHERE clause for text filters', () => {
    const result = buildDrillDownSql(baseSql, { org: 'OpenAI' }, { org: 'text' })
    expect(result).toBe(
      `WITH base AS (\n${baseSql}\n)\nSELECT * FROM base\nWHERE "org" = 'OpenAI'`
    )
  })

  it('builds a WHERE clause for number filters without quotes around value', () => {
    const result = buildDrillDownSql(baseSql, { rank: '42' }, { rank: 'number' })
    expect(result).toBe(
      `WITH base AS (\n${baseSql}\n)\nSELECT * FROM base\nWHERE "rank" = 42`
    )
  })

  it('escapes single quotes in text values', () => {
    const result = buildDrillDownSql(baseSql, { name: "O'Brien" }, { name: 'text' })
    expect(result).toContain(`"name" = 'O''Brien'`)
  })

  it('combines multiple filters with AND', () => {
    const result = buildDrillDownSql(
      baseSql,
      { org: 'OpenAI', rank: '1' },
      { org: 'text', rank: 'number' }
    )
    expect(result).toContain(`"org" = 'OpenAI'`)
    expect(result).toContain(`"rank" = 1`)
    expect(result).toContain('AND')
  })

  it('returns bare CTE when filters are empty', () => {
    const result = buildDrillDownSql(baseSql, {}, {})
    expect(result).toBe(`WITH base AS (\n${baseSql}\n)\nSELECT * FROM base`)
  })

  it('handles columns with spaces or special chars via double quotes', () => {
    const result = buildDrillDownSql(baseSql, { 'total revenue': '100' }, { 'total revenue': 'number' })
    expect(result).toContain('"total revenue" = 100')
  })
})
