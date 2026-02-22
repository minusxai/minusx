'use client'

import { useState, useMemo, useCallback } from 'react'
import { Box, Table as ChakraTable, Icon } from '@chakra-ui/react'
import { LuChevronDown, LuChevronRight, LuSquareFunction } from 'react-icons/lu'
import { formatLargeNumber, formatNumber, formatDateValue } from '@/lib/chart/chart-utils'
import type { PivotData, FormulaResults } from '@/lib/chart/pivot-utils'
import type { ColumnFormatConfig } from '@/lib/types'

interface PivotTableProps {
  pivotData: PivotData
  showRowTotals?: boolean
  showColTotals?: boolean
  showHeatmap?: boolean
  emptyMessage?: string
  rowDimNames?: string[]
  colDimNames?: string[]
  formulaResults?: FormulaResults | null
  onCellClick?: (filters: Record<string, string>, valueLabel: string, event: React.MouseEvent) => void
  columnFormats?: Record<string, ColumnFormatConfig>
  valueColumns?: string[]  // Actual column names for each value (maps value index → column name)
}

type DisplayRow =
  | { type: 'data'; rowIndex: number }
  | { type: 'subtotal'; level: number; label: string; cells: number[]; rowTotal: number; groupValues: string[] }
  | { type: 'formula-row'; name: string; cells: number[]; rowTotal: number }

type ColEntry =
  | { type: 'data'; cellIndex: number }
  | { type: 'formula-col'; formulaIdx: number; valueIdx: number }

interface HeaderCell {
  label: string
  colSpan: number
  rowSpan?: number
  isFormula?: boolean
}

const makeGroupKey = (values: string[]) => values.join('|||')

export const PivotTable = ({
  pivotData,
  showRowTotals = true,
  showColTotals = true,
  showHeatmap = true,
  emptyMessage,
  rowDimNames,
  colDimNames,
  formulaResults,
  onCellClick,
  columnFormats,
  valueColumns,
}: PivotTableProps) => {
  const { rowHeaders, columnHeaders, cells, rowTotals, columnTotals, grandTotal, valueLabels } = pivotData

  // Format a numeric cell value using per-value-column decimal config
  const fmt = useCallback((value: number, valueIndex?: number): string => {
    if (columnFormats && valueColumns && valueIndex !== undefined) {
      const colName = valueColumns[valueIndex % (valueColumns.length || 1)]
      const dp = colName ? columnFormats[colName]?.decimalPoints : undefined
      if (dp != null) return formatNumber(value, dp)
    }
    return formatLargeNumber(value)
  }, [columnFormats, valueColumns])

  // Format a header value (row or column) using date format config
  const fmtHeader = useCallback((value: string, dimName?: string): string => {
    if (!dimName || !columnFormats) return value
    const dateFormat = columnFormats[dimName]?.dateFormat
    if (dateFormat) return formatDateValue(value, dateFormat)
    return value
  }, [columnFormats])

  const hasMultipleValues = valueLabels.length > 1
  const numRowDims = rowHeaders.length > 0 ? rowHeaders[0].length : 0
  const numColDims = columnHeaders.length > 0 ? columnHeaders[0].length : 0
  const numDataCols = cells.length > 0 ? cells[0].length : 0
  const numValues = valueLabels.length || 1

  // Collapsed groups state
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])

  // Compute min/max across regular cells only for heatmap (excludes formula cells)
  const { minValue, maxValue } = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const row of cells) {
      for (const val of row) {
        if (val < min) min = val
        if (val > max) max = val
      }
    }
    return { minValue: min, maxValue: max }
  }, [cells])

  const getCellBg = (value: number): string | undefined => {
    if (!showHeatmap) return undefined
    if (maxValue === minValue) return 'accent.teal/75'
    const normalized = (value - minValue) / (maxValue - minValue)
    // Blend from danger (low) to teal (high)
    const dangerOpacity = Math.round(10 + (1 - normalized) * 65)
    const tealOpacity = Math.round(10 + normalized * 65)
    if (normalized < 0.5) return `accent.danger/${dangerOpacity}`
    return `accent.teal/${tealOpacity}`
  }

  // Column entries: interleave regular data columns with formula columns
  const columnEntries = useMemo((): ColEntry[] => {
    const colFormulas = formulaResults?.columnFormulas ?? []
    if (numDataCols === 0) return []
    if (colFormulas.length === 0) {
      return Array.from({ length: numDataCols }, (_, i) => ({ type: 'data' as const, cellIndex: i }))
    }

    const entries: ColEntry[] = []
    const formulasByInsertCK = new Map<number, number[]>()
    for (let fi = 0; fi < colFormulas.length; fi++) {
      const ck = colFormulas[fi].insertAfterColKeyIndex
      if (!formulasByInsertCK.has(ck)) formulasByInsertCK.set(ck, [])
      formulasByInsertCK.get(ck)!.push(fi)
    }

    for (let ck = 0; ck < columnHeaders.length; ck++) {
      for (let vi = 0; vi < numValues; vi++) {
        entries.push({ type: 'data', cellIndex: ck * numValues + vi })
      }
      const formulas = formulasByInsertCK.get(ck)
      if (formulas) {
        for (const fi of formulas) {
          for (let vi = 0; vi < numValues; vi++) {
            entries.push({ type: 'formula-col', formulaIdx: fi, valueIdx: vi })
          }
        }
      }
    }

    return entries
  }, [numDataCols, columnHeaders, numValues, formulaResults])

  // Augmented column header rows with formula column headers
  const augmentedColHeaderRows = useMemo((): HeaderCell[][] => {
    if (columnHeaders.length === 0) return []
    const colFormulas = formulaResults?.columnFormulas ?? []

    // Build base header rows
    const baseRows: Array<Array<{ label: string; colSpan: number }>> = []
    for (let level = 0; level < numColDims; level++) {
      const headerRow: Array<{ label: string; colSpan: number }> = []
      let i = 0
      while (i < columnHeaders.length) {
        const rawLabel = columnHeaders[i][level]
        const currentLabel = fmtHeader(rawLabel, colDimNames?.[level])
        let span = 1
        while (i + span < columnHeaders.length) {
          const matches = columnHeaders[i + span][level] === rawLabel
          let parentsMatch = true
          for (let p = 0; p < level; p++) {
            if (columnHeaders[i + span][p] !== columnHeaders[i][p]) {
              parentsMatch = false
              break
            }
          }
          if (matches && parentsMatch) span++
          else break
        }
        const effectiveSpan = hasMultipleValues ? span * numValues : span
        headerRow.push({ label: currentLabel, colSpan: effectiveSpan })
        i += span
      }
      baseRows.push(headerRow)
    }
    if (hasMultipleValues) {
      const valueRow: Array<{ label: string; colSpan: number }> = []
      for (let c = 0; c < columnHeaders.length; c++) {
        for (const vl of valueLabels) {
          valueRow.push({ label: vl, colSpan: 1 })
        }
      }
      baseRows.push(valueRow)
    }

    // If no column formulas, return base rows as HeaderCell
    if (colFormulas.length === 0) {
      return baseRows.map(row => row.map(h => ({ label: h.label, colSpan: h.colSpan })))
    }

    // Determine level-0 group ranges (colKey ranges)
    const level0Groups: { label: string; startCK: number; endCK: number }[] = []
    {
      let ck = 0
      while (ck < columnHeaders.length) {
        const start = ck
        const label = columnHeaders[ck][0]
        while (ck + 1 < columnHeaders.length && columnHeaders[ck + 1][0] === label) ck++
        level0Groups.push({ label, startCK: start, endCK: ck })
        ck++
      }
    }

    // Map formulas to level-0 groups they insert after
    const formulasAfterGroup = new Map<number, number[]>()
    for (let fi = 0; fi < colFormulas.length; fi++) {
      const insertCK = colFormulas[fi].insertAfterColKeyIndex
      for (let g = 0; g < level0Groups.length; g++) {
        if (insertCK >= level0Groups[g].startCK && insertCK <= level0Groups[g].endCK) {
          if (!formulasAfterGroup.has(g)) formulasAfterGroup.set(g, [])
          formulasAfterGroup.get(g)!.push(fi)
          break
        }
      }
    }

    // Build augmented header rows
    const result: HeaderCell[][] = []
    for (let level = 0; level < baseRows.length; level++) {
      const isValueLevel = hasMultipleValues && level === baseRows.length - 1

      if (level === 0) {
        const augRow: HeaderCell[] = []
        for (let g = 0; g < level0Groups.length; g++) {
          augRow.push({ label: baseRows[0][g].label, colSpan: baseRows[0][g].colSpan })
          const formulas = formulasAfterGroup.get(g)
          if (formulas) {
            for (const fi of formulas) {
              augRow.push({
                label: colFormulas[fi].name,
                colSpan: hasMultipleValues ? numValues : 1,
                rowSpan: hasMultipleValues ? numColDims : numColDims,
                isFormula: true,
              })
            }
          }
        }
        result.push(augRow)
      } else if (isValueLevel) {
        // Value level: regular value labels + formula value labels
        const augRow: HeaderCell[] = []
        for (let g = 0; g < level0Groups.length; g++) {
          const numCKs = level0Groups[g].endCK - level0Groups[g].startCK + 1
          for (let ck = 0; ck < numCKs; ck++) {
            for (const vl of valueLabels) {
              augRow.push({ label: vl, colSpan: 1 })
            }
          }
          const formulas = formulasAfterGroup.get(g)
          if (formulas) {
            for (const _fi of formulas) {
              for (const vl of valueLabels) {
                augRow.push({ label: vl, colSpan: 1, isFormula: true })
              }
            }
          }
        }
        result.push(augRow)
      } else {
        // Intermediate dim levels: regular headers only (formula cols covered by rowSpan)
        result.push(baseRows[level].map(h => ({ label: h.label, colSpan: h.colSpan })))
      }
    }

    return result
  }, [columnHeaders, numColDims, hasMultipleValues, numValues, valueLabels, formulaResults, fmtHeader, colDimNames])

  // Build display rows: data + subtotals + formula rows
  const displayRows = useMemo((): DisplayRow[] => {
    if (rowHeaders.length === 0) {
      const result: DisplayRow[] = cells.map((_, i) => ({ type: 'data' as const, rowIndex: i }))
      // Insert formula rows at end if applicable
      const rowFormulas = formulaResults?.rowFormulas ?? []
      for (const rf of rowFormulas) {
        result.push({ type: 'formula-row', name: rf.name, cells: rf.cells, rowTotal: rf.rowTotal })
      }
      return result
    }

    // Build data + subtotal rows
    const result: DisplayRow[] = []

    if (numRowDims < 2) {
      // No subtotals for single dim
      for (let i = 0; i < rowHeaders.length; i++) {
        result.push({ type: 'data', rowIndex: i })
      }
    } else {
      for (let i = 0; i < rowHeaders.length; i++) {
        result.push({ type: 'data', rowIndex: i })

        for (let level = numRowDims - 2; level >= 0; level--) {
          const isLastRow = i === rowHeaders.length - 1
          const groupChanges = !isLastRow && (
            rowHeaders[i][level] !== rowHeaders[i + 1][level] ||
            (() => {
              for (let p = 0; p < level; p++) {
                if (rowHeaders[i][p] !== rowHeaders[i + 1][p]) return true
              }
              return false
            })()
          )

          if (isLastRow || groupChanges) {
            let groupStart = i
            while (groupStart > 0) {
              let sameGroup = true
              for (let p = 0; p <= level; p++) {
                if (rowHeaders[groupStart - 1][p] !== rowHeaders[i][p]) {
                  sameGroup = false
                  break
                }
              }
              if (sameGroup) groupStart--
              else break
            }

            const subtotalCells = new Array(numDataCols).fill(0)
            let subtotalRowTotal = 0
            for (let r = groupStart; r <= i; r++) {
              for (let c = 0; c < numDataCols; c++) {
                subtotalCells[c] += cells[r][c]
              }
              subtotalRowTotal += rowTotals[r]
            }

            result.push({
              type: 'subtotal',
              level,
              label: rowHeaders[i][level] + ' Total',
              cells: subtotalCells,
              rowTotal: subtotalRowTotal,
              groupValues: rowHeaders[i].slice(0, level + 1),
            })
          }
        }
      }
    }

    // Insert formula rows at appropriate positions
    const rowFormulas = formulaResults?.rowFormulas ?? []
    if (rowFormulas.length > 0) {
      // Insert in reverse order so indices don't shift
      const insertions: { position: number; formula: DisplayRow }[] = []
      for (const rf of rowFormulas) {
        const topLevelValue = rowHeaders[rf.insertAfterRowIndex]?.[0]
        if (!topLevelValue) continue

        let insertPosition = -1
        // Find the level-0 subtotal for this group
        for (let d = 0; d < result.length; d++) {
          const dr = result[d]
          if (dr.type === 'subtotal' && dr.level === 0 && dr.groupValues[0] === topLevelValue) {
            insertPosition = d + 1
            break
          }
        }
        // Fallback: after the last data row of this group
        if (insertPosition === -1) {
          for (let d = result.length - 1; d >= 0; d--) {
            const dr = result[d]
            if (dr.type === 'data' && rowHeaders[dr.rowIndex][0] === topLevelValue) {
              insertPosition = d + 1
              break
            }
          }
        }
        if (insertPosition === -1) insertPosition = result.length

        insertions.push({
          position: insertPosition,
          formula: { type: 'formula-row', name: rf.name, cells: rf.cells, rowTotal: rf.rowTotal },
        })
      }

      // Sort by position descending so we can splice without shifting
      insertions.sort((a, b) => b.position - a.position)
      for (const ins of insertions) {
        result.splice(ins.position, 0, ins.formula)
      }
    }

    return result
  }, [rowHeaders, cells, numRowDims, numDataCols, rowTotals, formulaResults])

  // Filter visible rows based on collapsed groups and showRowTotals (formula rows always visible)
  const visibleRows = useMemo((): DisplayRow[] => {
    return displayRows.filter(dr => {
      if (dr.type === 'formula-row') return true

      if (dr.type === 'subtotal') {
        // Hide subtotals when row totals are disabled
        if (!showRowTotals) return false
        for (let parentLevel = 0; parentLevel < dr.level; parentLevel++) {
          const parentKey = makeGroupKey(dr.groupValues.slice(0, parentLevel + 1))
          if (collapsedGroups.has(parentKey)) return false
        }
        return true
      }

      if (dr.type === 'data') {
        for (let level = 0; level < numRowDims - 1; level++) {
          const key = makeGroupKey(rowHeaders[dr.rowIndex].slice(0, level + 1))
          if (collapsedGroups.has(key)) return false
        }
        return true
      }

      return true
    })
  }, [displayRows, collapsedGroups, rowHeaders, numRowDims, showRowTotals])

  // Build row header spans for nested grouping based on visibleRows
  const rowSpans = useMemo(() => {
    if (rowHeaders.length === 0 || numRowDims === 0) return []

    const spans: Array<Array<{ show: boolean; rowSpan: number }>> = visibleRows.map(() =>
      Array.from({ length: numRowDims }, () => ({ show: true, rowSpan: 1 }))
    )

    for (let level = 0; level < numRowDims; level++) {
      let i = 0
      while (i < visibleRows.length) {
        const dr = visibleRows[i]

        // Formula rows and subtotals don't participate in dimension grouping
        if (dr.type === 'subtotal' || dr.type === 'formula-row') {
          spans[i][level] = { show: false, rowSpan: 1 }
          i++
          continue
        }

        // Data row: count span including subtotals at levels STRICTLY GREATER than this level
        let span = 1
        while (i + span < visibleRows.length) {
          const next = visibleRows[i + span]
          if (next.type === 'formula-row') {
            // Formula rows break the span
            break
          }
          if (next.type === 'subtotal') {
            if (next.level > level) {
              span++
              continue
            }
            break
          }
          const matches = rowHeaders[next.rowIndex][level] === rowHeaders[dr.rowIndex][level]
          let parentsMatch = true
          for (let p = 0; p < level; p++) {
            if (rowHeaders[next.rowIndex][p] !== rowHeaders[dr.rowIndex][p]) {
              parentsMatch = false
              break
            }
          }
          if (matches && parentsMatch) span++
          else break
        }

        spans[i][level] = { show: true, rowSpan: span }
        for (let j = 1; j < span; j++) {
          spans[i + j][level] = { show: false, rowSpan: 1 }
        }
        i += span
      }
    }

    return spans
  }, [rowHeaders, numRowDims, visibleRows])

  // Drill-down click handler for pivot data cells
  const handlePivotCellClick = useCallback((rowIndex: number, cellIndex: number, event: React.MouseEvent) => {
    const filters: Record<string, string> = {}

    // Row dimension filters
    if (rowDimNames && rowHeaders[rowIndex]) {
      rowDimNames.forEach((dimName, i) => {
        if (i < rowHeaders[rowIndex].length) {
          filters[dimName] = rowHeaders[rowIndex][i]
        }
      })
    }

    // Column dimension filters
    const colKeyIndex = Math.floor(cellIndex / numValues)
    if (colDimNames && columnHeaders[colKeyIndex]) {
      colDimNames.forEach((dimName, i) => {
        if (i < columnHeaders[colKeyIndex].length) {
          filters[dimName] = columnHeaders[colKeyIndex][i]
        }
      })
    }

    // Value identification
    const valueIndex = cellIndex % numValues
    const valueLabel = valueLabels[valueIndex] || ''

    console.log('Pivot drill-down filters:', { filters, value: valueLabel })
    onCellClick?.(filters, valueLabel, event)
  }, [rowHeaders, columnHeaders, rowDimNames, colDimNames, numValues, valueLabels, onCellClick])

  if (cells.length === 0 || (cells.length > 0 && cells[0].length === 0)) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        {emptyMessage || 'No data available for pivot table'}
      </Box>
    )
  }

  // Styling helpers
  const getSubtotalBg = (level: number) => level === 0 ? 'accent.teal/20' : 'accent.teal/12'
  const getSubtotalBorderTop = (level: number) => level === 0 ? '2px solid' : '1px solid'
  const getSubtotalBorderColor = (level: number) => level === 0 ? 'border.default' : 'border.muted'

  const colFormulas = formulaResults?.columnFormulas ?? []
  const hasColFormulas = colFormulas.length > 0

  // Helper: render cells for a row using columnEntries
  const renderDataCells = (rowIndex: number) => {
    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        return (
          <ChakraTable.Cell
            key={`col-${i}`}
            textAlign="right"
            fontFamily="mono"
            fontSize="sm"
            bg={getCellBg(cells[rowIndex][entry.cellIndex])}
            cursor="pointer"
            onClick={(e) => handlePivotCellClick(rowIndex, entry.cellIndex, e)}
            _hover={{ outline: '2px solid', outlineColor: 'accent.teal', outlineOffset: '-2px' }}
          >
            {fmt(cells[rowIndex][entry.cellIndex], entry.cellIndex % numValues)}
          </ChakraTable.Cell>
        )
      }
      // formula-col
      const val = colFormulas[entry.formulaIdx].rowValues[rowIndex][entry.valueIdx]
      return (
        <ChakraTable.Cell
          key={`col-${i}`}
          textAlign="right"
          fontFamily="mono"
          fontSize="sm"
          bg="accent.secondary/12"
          fontStyle="italic"
        >
          {fmt(val, entry.valueIdx)}
        </ChakraTable.Cell>
      )
    })
  }

  const renderSubtotalCells = (dr: Extract<DisplayRow, { type: 'subtotal' }>) => {
    const subtotalBg = getSubtotalBg(dr.level)
    const borderTop = getSubtotalBorderTop(dr.level)
    const borderTopColor = getSubtotalBorderColor(dr.level)
    const groupKey = makeGroupKey(dr.groupValues)

    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        return (
          <ChakraTable.Cell
            key={`col-${i}`}
            textAlign="right"
            fontFamily="mono"
            fontSize="sm"
            fontWeight="600"
            bg={subtotalBg}
            color="fg.default"
            borderTop={borderTop}
            borderBottom={dr.level === 0 ? '2px solid' : undefined}
            borderColor={borderTopColor}
          >
            {fmt(dr.cells[entry.cellIndex], entry.cellIndex % numValues)}
          </ChakraTable.Cell>
        )
      }
      // formula-col in subtotal row
      const vals = colFormulas[entry.formulaIdx].subtotalValues.get(groupKey)
      const val = vals?.[entry.valueIdx]
      return (
        <ChakraTable.Cell
          key={`col-${i}`}
          textAlign="right"
          fontFamily="mono"
          fontSize="sm"
          fontWeight="600"
          bg="accent.secondary/12"
          fontStyle="italic"
          color="fg.default"
          borderTop={borderTop}
          borderBottom={dr.level === 0 ? '2px solid' : undefined}
          borderColor={borderTopColor}
        >
          {val !== undefined ? fmt(val, entry.valueIdx) : '\u2014'}
        </ChakraTable.Cell>
      )
    })
  }

  const renderFormulaRowCells = (dr: Extract<DisplayRow, { type: 'formula-row' }>) => {
    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        return (
          <ChakraTable.Cell
            key={`col-${i}`}
            textAlign="right"
            fontFamily="mono"
            fontSize="sm"
            fontWeight="600"
            bg="accent.secondary/12"
            fontStyle="italic"
            color="fg.default"
            borderTop="1px dashed"
            borderColor="accent.secondary/40"
          >
            {fmt(dr.cells[entry.cellIndex], entry.cellIndex % numValues)}
          </ChakraTable.Cell>
        )
      }
      // formula-col in formula-row: show dash
      return (
        <ChakraTable.Cell
          key={`col-${i}`}
          textAlign="center"
          fontFamily="mono"
          fontSize="sm"
          bg="accent.secondary/12"
          color="fg.subtle"
          borderTop="1px dashed"
          borderColor="accent.secondary/40"
        >
          {'\u2014'}
        </ChakraTable.Cell>
      )
    })
  }

  const renderGrandTotalCells = () => {
    return columnEntries.map((entry, i) => {
      if (entry.type === 'data') {
        return (
          <ChakraTable.Cell
            key={`col-${i}`}
            textAlign="right"
            fontFamily="mono"
            fontSize="sm"
            fontWeight="600"
            borderTop="2px solid"
            borderColor="border.default"
            bg="accent.teal/40"
            color="fg.default"
          >
            {fmt(columnTotals[entry.cellIndex], entry.cellIndex % numValues)}
          </ChakraTable.Cell>
        )
      }
      // formula-col in grand total: dash
      return (
        <ChakraTable.Cell
          key={`col-${i}`}
          textAlign="center"
          fontFamily="mono"
          fontSize="sm"
          fontWeight="600"
          borderTop="2px solid"
          borderColor="border.default"
          bg="accent.teal/40"
          color="fg.subtle"
        >
          {'\u2014'}
        </ChakraTable.Cell>
      )
    })
  }

  const numHeaderRows = augmentedColHeaderRows.length

  return (
    <Box
      width="100%"
      height="100%"
      overflow="auto"
      border="1px solid"
      borderColor="border.muted"
      borderRadius="md"
    >
      <ChakraTable.Root size="sm" css={{ borderCollapse: 'collapse' }}>
        <ChakraTable.Header position="sticky" top={0} zIndex={5} bg="bg.muted">
          {/* Column header rows */}
          {augmentedColHeaderRows.map((headerRow, rowIdx) => (
            <ChakraTable.Row key={rowIdx} bg="bg.muted">
              {/* Row dimension name headers */}
              {rowIdx === 0 && numRowDims > 0 && (
                Array.from({ length: numRowDims }, (_, dimIdx) => (
                  <ChakraTable.ColumnHeader
                    key={`dim-${dimIdx}`}
                    rowSpan={numHeaderRows}
                    fontWeight="700"
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="0.05em"
                    color="fg.muted"
                    borderRight={dimIdx === numRowDims - 1 ? '2px solid' : '1px solid'}
                    borderColor={dimIdx === numRowDims - 1 ? 'border.default' : 'border.muted'}
                    position={dimIdx === 0 ? 'sticky' : undefined}
                    left={dimIdx === 0 ? 0 : undefined}
                    bg="bg.muted"
                    zIndex={dimIdx === 0 ? 4 : 3}
                    minW="100px"
                  >
                    {rowDimNames?.[dimIdx] || ''}
                  </ChakraTable.ColumnHeader>
                ))
              )}

              {/* Column headers at this level */}
              {headerRow.map((hdr, colIdx) => (
                <ChakraTable.ColumnHeader
                  key={colIdx}
                  colSpan={hdr.colSpan}
                  rowSpan={hdr.rowSpan}
                  fontWeight="700"
                  fontSize="xs"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                  color={hdr.isFormula ? 'accent.secondary' : 'fg.muted'}
                  textAlign="center"
                  minW="80px"
                  borderBottom={rowIdx < numHeaderRows - 1 ? '1px solid' : undefined}
                  borderColor="border.muted"
                  zIndex={3}
                  bg={hdr.isFormula ? 'accent.secondary/12' : undefined}
                  fontStyle={hdr.isFormula ? 'italic' : undefined}
                >
                  {hdr.isFormula ? (
                    <Box display="inline-flex" alignItems="center" gap={1} justifyContent="center">
                      <Icon fontSize="md" color="accent.secondary">
                        <LuSquareFunction />
                      </Icon>
                    
                      {hdr.label}
                    </Box>
                  ) : hdr.label}
                </ChakraTable.ColumnHeader>
              ))}

              {/* Row total header */}
              {showRowTotals && rowIdx === 0 && (
                <ChakraTable.ColumnHeader
                  rowSpan={numHeaderRows}
                  fontWeight="700"
                  fontSize="xs"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                  color="fg.muted"
                  textAlign="right"
                  borderLeft="2px solid"
                  borderColor="border.default"
                  minW="80px"
                  bg="accent.teal/20"
                  zIndex={3}
                >
                  Total
                </ChakraTable.ColumnHeader>
              )}
            </ChakraTable.Row>
          ))}

          {/* If no column dimensions, still show a header row with value labels */}
          {augmentedColHeaderRows.length === 0 && (
            <ChakraTable.Row bg="bg.muted">
              {numRowDims > 0 && (
                Array.from({ length: numRowDims }, (_, dimIdx) => (
                  <ChakraTable.ColumnHeader
                    key={`dim-${dimIdx}`}
                    fontWeight="700"
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="0.05em"
                    color="fg.muted"
                    borderRight={dimIdx === numRowDims - 1 ? '2px solid' : '1px solid'}
                    borderColor={dimIdx === numRowDims - 1 ? 'border.default' : 'border.muted'}
                    position={dimIdx === 0 ? 'sticky' : undefined}
                    left={dimIdx === 0 ? 0 : undefined}
                    bg="bg.muted"
                    zIndex={dimIdx === 0 ? 4 : 3}
                    minW="100px"
                  >
                    {rowDimNames?.[dimIdx] || ''}
                  </ChakraTable.ColumnHeader>
                ))
              )}
              {valueLabels.map((vl, i) => (
                <ChakraTable.ColumnHeader
                  key={i}
                  fontWeight="700"
                  fontSize="xs"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                  color="fg.muted"
                  textAlign="right"
                  minW="80px"
                  zIndex={3}
                >
                  {vl}
                </ChakraTable.ColumnHeader>
              ))}
              {showRowTotals && (
                <ChakraTable.ColumnHeader
                  fontWeight="700"
                  fontSize="xs"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                  color="fg.muted"
                  textAlign="right"
                  borderLeft="2px solid"
                  borderColor="border.default"
                  minW="80px"
                  bg="accent.teal/20"
                  zIndex={3}
                >
                  Total
                </ChakraTable.ColumnHeader>
              )}
            </ChakraTable.Row>
          )}
        </ChakraTable.Header>

        <ChakraTable.Body>
          {/* Data + subtotal + formula rows */}
          {visibleRows.map((displayRow, displayIndex) => {
            // Formula row
            if (displayRow.type === 'formula-row') {
              return (
                <ChakraTable.Row key={`formula-${displayIndex}`}>
                  <ChakraTable.Cell
                    colSpan={numRowDims || 1}
                    fontWeight="700"
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="0.05em"
                    fontStyle="italic"
                    color="accent.secondary"
                    borderRight="2px solid"
                    borderTop="1px dashed"
                    borderColor="accent.secondary/40"
                    position="sticky"
                    left={0}
                    bg="accent.secondary/12"
                    zIndex={2}
                  >
                    <Box display="flex" alignItems="center" gap={1}>
                      <Icon fontSize="md" color="accent.secondary">
                        <LuSquareFunction />
                      </Icon>
                      {displayRow.name}
                    </Box>
                  </ChakraTable.Cell>

                  {hasColFormulas ? renderFormulaRowCells(displayRow) : (
                    displayRow.cells.map((value, colIndex) => (
                      <ChakraTable.Cell
                        key={colIndex}
                        textAlign="right"
                        fontFamily="mono"
                        fontSize="sm"
                        fontWeight="600"
                        bg="accent.secondary/12"
                        fontStyle="italic"
                        color="fg.default"
                        borderTop="1px dashed"
                        borderColor="accent.secondary/40"
                      >
                        {fmt(value, colIndex % numValues)}
                      </ChakraTable.Cell>
                    ))
                  )}

                  {showRowTotals && (
                    <ChakraTable.Cell
                      textAlign="right"
                      fontFamily="mono"
                      fontSize="sm"
                      fontWeight="700"
                      fontStyle="italic"
                      borderLeft="2px solid"
                      borderTop="1px dashed"
                      borderColor="accent.secondary/40"
                      bg="accent.secondary/12"
                      color="accent.secondary"
                    >
                      {fmt(displayRow.rowTotal)}
                    </ChakraTable.Cell>
                  )}
                </ChakraTable.Row>
              )
            }

            // Subtotal row
            if (displayRow.type === 'subtotal') {
              const S = displayRow.level
              const subtotalBg = getSubtotalBg(S)
              const borderTop = getSubtotalBorderTop(S)
              const borderTopColor = getSubtotalBorderColor(S)
              const groupKey = makeGroupKey(displayRow.groupValues)
              const collapsed = collapsedGroups.has(groupKey)

              return (
                <ChakraTable.Row key={`subtotal-${displayIndex}`}>
                  <ChakraTable.Cell
                    colSpan={numRowDims - S}
                    fontWeight="700"
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="0.05em"
                    color="fg.default"
                    borderRight="2px solid"
                    borderTop={borderTop}
                    borderBottom={S === 0 ? '2px solid' : undefined}
                    borderColor={borderTopColor}
                    position={S === 0 ? 'sticky' : undefined}
                    left={S === 0 ? 0 : undefined}
                    bg={subtotalBg}
                    zIndex={S === 0 ? 2 : undefined}
                    cursor="pointer"
                    onClick={() => toggleGroup(groupKey)}
                    _hover={{ opacity: 0.8 }}
                  >
                    <Box display="flex" alignItems="center" gap={1}>
                      <Box as={collapsed ? LuChevronRight : LuChevronDown} fontSize="sm" flexShrink={0} />
                      {displayRow.label}
                    </Box>
                  </ChakraTable.Cell>

                  {hasColFormulas ? renderSubtotalCells(displayRow) : (
                    displayRow.cells.map((value, colIndex) => (
                      <ChakraTable.Cell
                        key={colIndex}
                        textAlign="right"
                        fontFamily="mono"
                        fontSize="sm"
                        fontWeight="600"
                        bg={subtotalBg}
                        color="fg.default"
                        borderTop={borderTop}
                        borderBottom={S === 0 ? '2px solid' : undefined}
                        borderColor={borderTopColor}
                      >
                        {fmt(value, colIndex % numValues)}
                      </ChakraTable.Cell>
                    ))
                  )}

                  {showRowTotals && (
                    <ChakraTable.Cell
                      textAlign="right"
                      fontFamily="mono"
                      fontSize="sm"
                      fontWeight="700"
                      borderLeft="2px solid"
                      borderTop={borderTop}
                      borderBottom={S === 0 ? '2px solid' : undefined}
                      borderColor={borderTopColor}
                      bg={S === 0 ? 'accent.teal/40' : 'accent.teal/30'}
                      color="fg.default"
                    >
                      {fmt(displayRow.rowTotal)}
                    </ChakraTable.Cell>
                  )}
                </ChakraTable.Row>
              )
            }

            // Data row
            const rowIndex = displayRow.rowIndex
            return (
              <ChakraTable.Row key={`data-${displayIndex}`} _hover={{ bg: 'bg.muted' }}>
                {/* Row dimension headers */}
                {rowSpans[displayIndex]?.map((spanInfo, dimIdx) =>
                  spanInfo.show ? (
                    <ChakraTable.Cell
                      key={`dim-${dimIdx}`}
                      rowSpan={spanInfo.rowSpan}
                      fontWeight="600"
                      fontSize="sm"
                      borderRight={dimIdx === numRowDims - 1 ? '2px solid' : '1px solid'}
                      borderColor={dimIdx === numRowDims - 1 ? 'border.default' : 'border.muted'}
                      position={dimIdx === 0 ? 'sticky' : undefined}
                      left={dimIdx === 0 ? 0 : undefined}
                      bg="bg.surface"
                      zIndex={dimIdx === 0 ? 2 : undefined}
                      verticalAlign="top"
                    >
                      {fmtHeader(rowHeaders[rowIndex][dimIdx], rowDimNames?.[dimIdx])}
                    </ChakraTable.Cell>
                  ) : null
                )}

                {/* Data cells (interleaved with formula columns if applicable) */}
                {hasColFormulas ? renderDataCells(rowIndex) : (
                  cells[rowIndex].map((value, colIndex) => (
                    <ChakraTable.Cell
                      key={colIndex}
                      textAlign="right"
                      fontFamily="mono"
                      fontSize="sm"
                      bg={getCellBg(value)}
                      cursor="pointer"
                      onClick={(e) => handlePivotCellClick(rowIndex, colIndex, e)}
                      _hover={{ outline: '2px solid', outlineColor: 'accent.teal', outlineOffset: '-2px' }}
                    >
                      {fmt(value, colIndex % numValues)}
                    </ChakraTable.Cell>
                  ))
                )}

                {/* Row total */}
                {showRowTotals && (
                  <ChakraTable.Cell
                    textAlign="right"
                    fontFamily="mono"
                    fontSize="sm"
                    fontWeight="600"
                    borderLeft="2px solid"
                    borderColor="border.default"
                    bg="accent.teal/20"
                    color="fg.default"
                  >
                    {fmt(rowTotals[rowIndex])}
                  </ChakraTable.Cell>
                )}
              </ChakraTable.Row>
            )
          })}

          {/* Column totals row */}
          {showColTotals && (
            <ChakraTable.Row fontWeight="600">
              <ChakraTable.Cell
                colSpan={numRowDims || 1}
                fontWeight="700"
                fontSize="xs"
                textTransform="uppercase"
                letterSpacing="0.05em"
                color="fg.default"
                borderRight="2px solid"
                borderTop="2px solid"
                borderColor="border.default"
                position="sticky"
                left={0}
                bg="accent.teal/40"
                zIndex={2}
              >
                Grand Total
              </ChakraTable.Cell>

              {hasColFormulas ? renderGrandTotalCells() : (
                columnTotals.map((total, colIndex) => (
                  <ChakraTable.Cell
                    key={colIndex}
                    textAlign="right"
                    fontFamily="mono"
                    fontSize="sm"
                    fontWeight="600"
                    borderTop="2px solid"
                    borderColor="border.default"
                    bg="accent.teal/40"
                    color="fg.default"
                  >
                    {fmt(total, colIndex % numValues)}
                  </ChakraTable.Cell>
                ))
              )}

              {showRowTotals && (
                <ChakraTable.Cell
                  textAlign="right"
                  fontFamily="mono"
                  fontSize="sm"
                  fontWeight="700"
                  color="fg.default"
                  borderLeft="2px solid"
                  borderTop="2px solid"
                  borderColor="border.default"
                  bg="accent.teal/50"
                >
                  {fmt(grandTotal)}
                </ChakraTable.Cell>
              )}
            </ChakraTable.Row>
          )}
        </ChakraTable.Body>
      </ChakraTable.Root>
    </Box>
  )
}
