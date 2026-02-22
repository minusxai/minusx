import type { PivotConfig, PivotFormula, AggregationFunction, FormulaOperator } from '@/lib/types'

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
        const aggValue = applyAggregation(buckets[vi], valueConfigs[vi].aggFunction ?? 'SUM')
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

// --- Formula computation ---

export interface FormulaRowResult {
  name: string
  cells: number[]                // Same width as PivotData cells columns
  rowTotal: number
  insertAfterRowIndex: number    // Last row index of the last-appearing operand group
}

export interface FormulaColumnResult {
  name: string
  rowValues: number[][]          // [dataRowIndex] → number[] of length numValues
  subtotalValues: Map<string, number[]>  // groupKey → values for subtotal rows
  insertAfterColKeyIndex: number // Last colKey index of the last-appearing operand group
}

export interface FormulaResults {
  rowFormulas: FormulaRowResult[]
  columnFormulas: FormulaColumnResult[]
}

export function applyOperator(a: number, b: number, op: FormulaOperator): number {
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/': return b === 0 ? 0 : a / b
  }
}

function computeSingleRowFormula(
  pivotData: PivotData,
  formula: PivotFormula,
): FormulaRowResult | null {
  const { rowHeaders, cells } = pivotData
  if (rowHeaders.length === 0) return null

  // Find row indices belonging to each operand (top-level dimension match)
  const indicesA: number[] = []
  const indicesB: number[] = []
  for (let i = 0; i < rowHeaders.length; i++) {
    if (rowHeaders[i][0] === formula.operandA) indicesA.push(i)
    if (rowHeaders[i][0] === formula.operandB) indicesB.push(i)
  }
  if (indicesA.length === 0 || indicesB.length === 0) return null

  const numCols = cells.length > 0 ? cells[0].length : 0

  // Sum cells across all rows in each operand group
  const sumA = new Array(numCols).fill(0)
  const sumB = new Array(numCols).fill(0)
  for (const i of indicesA) {
    for (let c = 0; c < numCols; c++) sumA[c] += cells[i][c]
  }
  for (const i of indicesB) {
    for (let c = 0; c < numCols; c++) sumB[c] += cells[i][c]
  }

  // Apply operator element-wise
  const resultCells = sumA.map((a, c) => applyOperator(a, sumB[c], formula.operator))
  const rowTotal = resultCells.reduce((acc, v) => acc + v, 0)

  // Insertion point: after whichever operand group appears later
  const lastA = indicesA[indicesA.length - 1]
  const lastB = indicesB[indicesB.length - 1]
  const insertAfterRowIndex = Math.max(lastA, lastB)

  return { name: formula.name, cells: resultCells, rowTotal, insertAfterRowIndex }
}

function computeSingleColumnFormula(
  pivotData: PivotData,
  formula: PivotFormula,
  numValues: number,
): FormulaColumnResult | null {
  const { columnHeaders, cells, rowHeaders } = pivotData
  if (columnHeaders.length === 0) return null

  // Find column-key indices (groups of numValues) matching each operand
  const colKeyIndicesA: number[] = []
  const colKeyIndicesB: number[] = []
  for (let c = 0; c < columnHeaders.length; c++) {
    if (columnHeaders[c][0] === formula.operandA) colKeyIndicesA.push(c)
    if (columnHeaders[c][0] === formula.operandB) colKeyIndicesB.push(c)
  }
  if (colKeyIndicesA.length === 0 || colKeyIndicesB.length === 0) return null

  // For each data row, for each value index: sum across operand's colKeys, then apply operator
  const rowValues: number[][] = []
  for (let r = 0; r < cells.length; r++) {
    const vals: number[] = []
    for (let vi = 0; vi < numValues; vi++) {
      let sumA = 0
      let sumB = 0
      for (const ck of colKeyIndicesA) sumA += cells[r][ck * numValues + vi]
      for (const ck of colKeyIndicesB) sumB += cells[r][ck * numValues + vi]
      vals.push(applyOperator(sumA, sumB, formula.operator))
    }
    rowValues.push(vals)
  }

  // Compute subtotal values keyed by group
  const subtotalValues = new Map<string, number[]>()
  if (rowHeaders.length > 0 && rowHeaders[0].length >= 2) {
    // Group rows by top-level row dimension values at each level
    const numRowDims = rowHeaders[0].length
    for (let level = 0; level < numRowDims - 1; level++) {
      let groupStart = 0
      while (groupStart < rowHeaders.length) {
        let groupEnd = groupStart
        while (
          groupEnd + 1 < rowHeaders.length &&
          rowHeaders[groupEnd + 1].slice(0, level + 1).join('\0') === rowHeaders[groupStart].slice(0, level + 1).join('\0')
        ) {
          groupEnd++
        }

        const key = rowHeaders[groupStart].slice(0, level + 1).join('|||')
        const subtotalVals: number[] = new Array(numValues).fill(0)
        for (let r = groupStart; r <= groupEnd; r++) {
          for (let vi = 0; vi < numValues; vi++) {
            subtotalVals[vi] += rowValues[r][vi]
          }
        }
        subtotalValues.set(key, subtotalVals)

        groupStart = groupEnd + 1
      }
    }
  }

  // Insertion point: after the last colKey of whichever operand group appears later
  const lastA = colKeyIndicesA[colKeyIndicesA.length - 1]
  const lastB = colKeyIndicesB[colKeyIndicesB.length - 1]
  const insertAfterColKeyIndex = Math.max(lastA, lastB)

  return { name: formula.name, rowValues, subtotalValues, insertAfterColKeyIndex }
}

export function computeFormulas(
  pivotData: PivotData,
  config: PivotConfig,
): FormulaResults {
  const rowFormulas: FormulaRowResult[] = []
  const columnFormulas: FormulaColumnResult[] = []
  const numValues = config.values.length || 1

  if (config.rowFormulas) {
    for (const f of config.rowFormulas) {
      const result = computeSingleRowFormula(pivotData, f)
      if (result) rowFormulas.push(result)
    }
  }

  if (config.columnFormulas) {
    for (const f of config.columnFormulas) {
      const result = computeSingleColumnFormula(pivotData, f, numValues)
      if (result) columnFormulas.push(result)
    }
  }

  return { rowFormulas, columnFormulas }
}

export function getUniqueTopLevelRowValues(pivotData: PivotData): string[] {
  if (pivotData.rowHeaders.length === 0) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const header of pivotData.rowHeaders) {
    if (!seen.has(header[0])) {
      seen.add(header[0])
      result.push(header[0])
    }
  }
  return result
}

export function getUniqueTopLevelColumnValues(pivotData: PivotData): string[] {
  if (pivotData.columnHeaders.length === 0) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const header of pivotData.columnHeaders) {
    if (!seen.has(header[0])) {
      seen.add(header[0])
      result.push(header[0])
    }
  }
  return result
}
