import type { PivotConfig, AggregationFunction } from '@/lib/types'

export interface PivotData {
  rowHeaders: string[][]      // Each row's dimension values (for nested grouping)
  columnHeaders: string[][]   // Each column's dimension values (for nested grouping)
  cells: number[][]           // [rowIndex][colIndex] aggregated values
  rowTotals: number[]         // Sum per row
  columnTotals: number[]      // Sum per column
  grandTotal: number
  valueLabels: string[]       // e.g. ["SUM(revenue)"] - used when multiple values
}

export function applyAggregation(values: number[], fn: AggregationFunction): number {
  if (values.length === 0) return 0

  switch (fn) {
    case 'SUM':
      return values.reduce((a, b) => a + b, 0)
    case 'AVG':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'COUNT':
      return values.length
    case 'MIN':
      return Math.min(...values)
    case 'MAX':
      return Math.max(...values)
  }
}

export function aggregatePivotData(
  rows: Record<string, any>[],
  config: PivotConfig
): PivotData {
  const { rows: rowDims, columns: colDims, values: valueConfigs } = config

  if (valueConfigs.length === 0) {
    return {
      rowHeaders: [],
      columnHeaders: [],
      cells: [],
      rowTotals: [],
      columnTotals: [],
      grandTotal: 0,
      valueLabels: [],
    }
  }

  // Build unique row keys and column keys (preserving insertion order)
  const rowKeyMap = new Map<string, string[]>()
  const colKeyMap = new Map<string, string[]>()

  // Accumulator: rowKey -> colKey -> valueIndex -> raw numeric values
  const accumulator = new Map<string, Map<string, number[][]>>()

  for (const row of rows) {
    const rowVals = rowDims.map(d => String(row[d] ?? ''))
    const colVals = colDims.map(d => String(row[d] ?? ''))
    const rowKey = rowVals.join('\0')
    const colKey = colVals.join('\0')

    if (!rowKeyMap.has(rowKey)) rowKeyMap.set(rowKey, rowVals)
    if (!colKeyMap.has(colKey)) colKeyMap.set(colKey, colVals)

    if (!accumulator.has(rowKey)) accumulator.set(rowKey, new Map())
    const rowAcc = accumulator.get(rowKey)!

    if (!rowAcc.has(colKey)) {
      rowAcc.set(colKey, valueConfigs.map(() => []))
    }
    const cellBuckets = rowAcc.get(colKey)!

    for (let vi = 0; vi < valueConfigs.length; vi++) {
      const val = row[valueConfigs[vi].column]
      if (val !== null && val !== undefined && !isNaN(Number(val))) {
        cellBuckets[vi].push(Number(val))
      }
    }
  }

  const rowKeys = Array.from(rowKeyMap.keys())
  const colKeys = Array.from(colKeyMap.keys())
  const rowHeaders = rowKeys.map(k => rowKeyMap.get(k)!)
  const columnHeaders = colKeys.map(k => colKeyMap.get(k)!)

  // Value labels
  const valueLabels = valueConfigs.map(vc => `${vc.aggFunction}(${vc.column})`)

  // If multiple values, each column-key gets expanded by value count
  // Total columns = colKeys.length * valueConfigs.length
  const numValueCols = colKeys.length * valueConfigs.length

  // Build cells
  const cells: number[][] = []
  const rowTotals: number[] = []
  const columnTotals: number[] = new Array(numValueCols).fill(0)
  let grandTotal = 0

  for (const rowKey of rowKeys) {
    const rowAcc = accumulator.get(rowKey)!
    const cellRow: number[] = []
    let rowSum = 0

    for (const colKey of colKeys) {
      const buckets = rowAcc.get(colKey) || valueConfigs.map(() => [])
      for (let vi = 0; vi < valueConfigs.length; vi++) {
        const aggValue = applyAggregation(buckets[vi], valueConfigs[vi].aggFunction)
        cellRow.push(aggValue)
      }
    }

    // Row total: sum of all cell values in the row
    for (let ci = 0; ci < cellRow.length; ci++) {
      rowSum += cellRow[ci]
      columnTotals[ci] += cellRow[ci]
    }

    cells.push(cellRow)
    rowTotals.push(rowSum)
    grandTotal += rowSum
  }

  return {
    rowHeaders,
    columnHeaders,
    cells,
    rowTotals,
    columnTotals,
    grandTotal,
    valueLabels,
  }
}
