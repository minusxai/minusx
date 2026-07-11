import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Box, Text } from '@chakra-ui/react'
import { calculateColumnStats, ColumnStats, getColumnType, loadDataIntoTable, generateRandomTableName } from '@/lib/database/duckdb'
import { calculateHistogram } from '@/lib/chart/histogram'
import { formatNumber, applyPrefixSuffix, formatDateValue } from '@/lib/chart/chart-format'
import { buildConditionalBg } from '@/lib/chart/conditional-format-utils'
import type { ColumnFormatConfig, ConditionalFormatRule } from '@/lib/types'
import { DrillDownCard, type DrillDownState } from './DrillDownCard'
import { TableHeaderCell } from './TableHeaderCell'
import { TableBody } from './TableBody'
import { TableBottomBar } from './TableBottomBar'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  createColumnHelper,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type ColumnDef,
  type ColumnSizingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  type ColumnType,
  formatValue,
  NUMBER_FORMAT,
  ROW_HEIGHT,
  isFacetedFilter,
} from './table-v2-utils'

interface TableProps {
  columns: string[]
  types?: string[]
  rows: Record<string, any>[]
  pageSize?: number
  sql?: string
  databaseName?: string
  /** Called when a row is clicked. Receives the row's original data object and its index. */
  onRowClick?: (row: Record<string, any>, index: number) => void
  /** Optional initial column sizes (column name → width in px) */
  initialColumnSizing?: Record<string, number>
  /** Columns whose text should wrap instead of truncating with ellipsis */
  wrapColumns?: ReadonlySet<string>
  /** Custom cell renderer for specific columns. Return undefined to use default formatting. */
  renderCell?: (colId: string, value: any, row: Record<string, any>) => React.ReactNode | undefined
  /** Initial sort state: array of { id: columnName, desc: boolean } */
  initialSorting?: SortingState
  /** Click-a-cell-to-drill-down. Off for read-only embeds (shared story). */
  enableDrilldown?: boolean
  /** Per-column display formatting (alias/decimals/prefix/suffix/date) keyed by column name. Applied to headers and cells. */
  columnFormats?: Record<string, ColumnFormatConfig>
  /** When provided, each column header exposes a rename/format editor. Omit for read-only tables. */
  onColumnFormatsChange?: (formats: Record<string, ColumnFormatConfig>) => void
  /** Conditional background-color rules. Applied to cells/rows/columns when their condition matches. */
  conditionalFormats?: ConditionalFormatRule[]
}

export const TableV2 = ({ columns: colNames, types, rows, pageSize: _fixedPageSize, sql, databaseName, onRowClick, initialColumnSizing, wrapColumns, renderCell, initialSorting, enableDrilldown = true, columnFormats, onColumnFormatsChange, conditionalFormats }: TableProps) => {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? [])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(initialColumnSizing ?? {})
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null)
  const closeDrillDown = useCallback(() => setDrillDown(null), [])
  const [stats, setStats] = useState<Record<string, ColumnStats> | null>(null)
  const [histograms, setHistograms] = useState<Record<string, Array<{ bin: number; binMin: number; binMax: number; count: number }>>>({})
  const [loadingStats, setLoadingStats] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [activeFilterCol, setActiveFilterCol] = useState<string | null>(null)
  const [activeFormatCol, setActiveFormatCol] = useState<string | null>(null)

  // Display name (alias) + value formatting derived from columnFormats. When no
  // config exists for a column, behaviour is identical to the unformatted table.
  const getDisplayName = useCallback(
    (col: string) => columnFormats?.[col]?.alias || col,
    [columnFormats]
  )

  const formatCell = useCallback((col: string, value: any, type: ColumnType): string => {
    if (value == null) return '-'
    const cfg = columnFormats?.[col]
    if (cfg) {
      if (type === 'number' && typeof value === 'number') {
        const base = cfg.decimalPoints != null ? formatNumber(value, cfg.decimalPoints) : NUMBER_FORMAT.format(value)
        return applyPrefixSuffix(base, cfg.prefix, cfg.suffix)
      }
      if (type === 'date' && cfg.dateFormat) {
        return formatDateValue(value instanceof Date ? value.toISOString() : String(value), cfg.dateFormat)
      }
    }
    return formatValue(value, type)
  }, [columnFormats])

  const handleFormatChange = useCallback((col: string, cfg: ColumnFormatConfig) => {
    const next: Record<string, ColumnFormatConfig> = { ...(columnFormats ?? {}) }
    const isEmpty = !cfg.alias && cfg.decimalPoints == null && !cfg.dateFormat && !cfg.prefix && !cfg.suffix
    if (isEmpty) delete next[col]
    else next[col] = cfg
    onColumnFormatsChange?.(next)
  }, [columnFormats, onColumnFormatsChange])

  const containerRef = useRef<HTMLDivElement>(null)
  const tableBodyRef = useRef<HTMLDivElement>(null)

  const columnTypes: ColumnType[] = useMemo(
    () => types ? types.map(getColumnType) : colNames.map(() => 'text'),
    [types, colNames]
  )

  // Conditional background-color lookup. No-op (returns undefined) when no rules.
  const getCellBg = useMemo(() => {
    const typeByName: Record<string, ColumnType> = {}
    colNames.forEach((col, i) => { typeByName[col] = columnTypes[i] })
    return buildConditionalBg(conditionalFormats, rows, typeByName)
  }, [conditionalFormats, rows, colNames, columnTypes])

  // Reset visibility when columns change
  useEffect(() => {
    setColumnVisibility({})
    setColumnFilters([])
    setSorting(initialSorting ?? [])
    setColumnSizing(initialColumnSizing ?? {})
  }, [colNames])

  // Column definitions for TanStack Table
  const tableColumns = useMemo<ColumnDef<Record<string, any>, any>[]>(() => {
    const helper = createColumnHelper<Record<string, any>>()
    return colNames.map((col, index) => {
      const colType = columnTypes[index]
      return helper.accessor(col, {
        id: col,
        header: col,
        cell: (info) => formatValue(info.getValue(), colType),
        filterFn: (row, columnId, filterValue) => {
          if (!filterValue) return true
          const val = row.getValue(columnId)
          const formatted = formatValue(val, colType)
          if (isFacetedFilter(filterValue)) {
            // If values are selected, use those; otherwise fall back to text search
            if (filterValue.selected.length > 0) {
              return filterValue.selected.includes(formatted)
            }
            if (filterValue.search) {
              return formatted.toLowerCase().includes(filterValue.search.toLowerCase())
            }
            return true
          }
          // Legacy: plain string filter
          return formatted.toLowerCase().includes(String(filterValue).toLowerCase())
        },
        sortingFn: colType === 'number' ? 'basic' : 'alphanumeric',
      })
    })
  }, [colNames, columnTypes])

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    state: { sorting, columnFilters, columnVisibility, columnSizing },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const { rows: tableRows } = table.getRowModel()

  // Pre-compute unique values per column (top 200, sorted by frequency) for faceted filter
  const columnUniqueValues = useMemo(() => {
    const result: Record<string, Array<{ value: string; count: number }>> = {}
    for (const col of colNames) {
      const colIdx = colNames.indexOf(col)
      const colType = columnTypes[colIdx]
      if (colType === 'json') continue
      const counts = new Map<string, number>()
      for (const row of rows) {
        const formatted = formatValue(row[col], colType)
        counts.set(formatted, (counts.get(formatted) ?? 0) + 1)
      }
      result[col] = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 200)
    }
    return result
  }, [colNames, columnTypes, rows])

  // Pre-compute column index map to avoid indexOf() per cell
  const colIndexMap = useMemo(() => {
    const map: Record<string, number> = {}
    colNames.forEach((col, i) => { map[col] = i })
    return map
  }, [colNames])

  // Virtual scrolling
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => tableBodyRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  const virtualItems = rowVirtualizer.getVirtualItems()

  // Pre-compute visible column IDs and sizes once per render
  const visibleColIds = useMemo(() => {
    return table.getVisibleLeafColumns().map(c => c.id)
  }, [table, columnVisibility]) // eslint-disable-line react-hooks/exhaustive-deps

  const colSizes = useMemo(() => {
    const sizes: Record<string, number> = {}
    table.getVisibleLeafColumns().forEach(c => { sizes[c.id] = c.getSize() })
    return sizes
  }, [table, columnSizing, columnVisibility]) // eslint-disable-line react-hooks/exhaustive-deps

  // Event delegation: single click handler on tbody, find cell via DOM traversal
  const handleBodyClick = useCallback((e: React.MouseEvent<HTMLTableSectionElement>) => {
    const td = (e.target as HTMLElement).closest('td') as HTMLTableCellElement | null
    if (!td) return
    const tr = td.closest('tr')
    if (!tr) return
    const rowIdx = Number(tr.dataset.rowIdx)
    const colId = td.dataset.colId
    if (colId == null || isNaN(rowIdx)) return
    const row = tableRows[rowIdx]
    if (!row) return
    const colIdx = colIndexMap[colId]
    const value = row.original[colId]
    const colType = columnTypes[colIdx]
    setDrillDown({
      filters: { [colId]: formatValue(value, colType) },
      filterTypes: { [colId]: colType },
      yColumn: colId,
      position: { x: e.clientX, y: e.clientY },
    })
  }, [tableRows, colIndexMap, columnTypes])

  // Stats calculation — only when user opts in
  useEffect(() => {
    if (showStats && colNames.length > 0 && rows.length > 0 && types) {
      setLoadingStats(true)
      const tableName = generateRandomTableName()
      loadDataIntoTable(tableName, rows)
        .then(async () => {
          const calculatedStats = await calculateColumnStats(tableName, colNames, types)
          setStats(calculatedStats)
          setLoadingStats(false)

          const histogramColumns = colNames
            .map((col, index) => ({ col, type: types[index] ? getColumnType(types[index]) : 'text' }))
            .filter(({ type }) => type === 'number' || type === 'date')

          const histResults = await Promise.all(
            histogramColumns.map(async ({ col, type }) => {
              const hist = await calculateHistogram(tableName, col, type as 'number' | 'date', 20)
              return { col, hist }
            })
          )
          const histMap: Record<string, Array<{ bin: number; binMin: number; binMax: number; count: number }>> = {}
          histResults.forEach(({ col, hist }) => { histMap[col] = hist })
          setHistograms(histMap)
        })
        .catch((error) => {
          console.error('Failed to calculate stats/histograms:', error)
          setLoadingStats(false)
        })
    }
  }, [showStats, colNames, rows, types])

  const downloadCsv = useCallback(() => {
    const visibleCols = colNames.filter(c => columnVisibility[c] !== false)
    const escape = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v
    const header = visibleCols.map(c => escape(getDisplayName(c))).join(',')
    const dataRows = tableRows.map(row =>
      visibleCols.map(c => escape(String(row.original[c] ?? ''))).join(',')
    )
    const csv = [header, ...dataRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    link.download = `table-${ts}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }, [colNames, tableRows, columnVisibility, getDisplayName])

  const visibleColumnCount = colNames.filter(c => columnVisibility[c] !== false).length

  if (!colNames || colNames.length === 0) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        No data available
      </Box>
    )
  }

  if (rows.length === 0) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" h="100%" display="flex" alignItems="center" justifyContent="center">
        Uh-oh, no data in results!
      </Box>
    )
  }

  const visibleHeaders = table.getHeaderGroups()[0].headers.filter(h => h.column.getIsVisible())

  return (
    <Box ref={containerRef} height="100%" display="flex" flexDirection="column">
      {visibleColumnCount === 0 ? (
        <Box flex="1" display="flex" alignItems="center" justifyContent="center">
          <Text fontSize="sm" color="fg.muted">
            No columns selected. Use the Columns menu to show columns.
          </Text>
        </Box>
      ) : (
        <Box
          ref={tableBodyRef}
          flex="1"
          minHeight="0"
          overflowX="auto"
          overflowY="auto"
          css={{
            '&::-webkit-scrollbar': { height: '6px', width: '6px' },
            '&::-webkit-scrollbar-track': { background: 'transparent' },
            '&::-webkit-scrollbar-thumb': { background: 'rgba(128,128,128,0.3)', borderRadius: '3px' },
            '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(128,128,128,0.5)' },
            '&::-webkit-scrollbar-corner': { background: 'transparent' },
            // Zebra stripe DEFAULT — a stylesheet rule (not inline) so css overrides
            // (.mx-row-odd / .mx-row-even in the scoped `css` field) can restyle it.
            '& .mx-row-odd': {
              background: 'var(--chakra-colors-bg-emphasized)',
            },
            '& .table-v2-row': {},
            '& .table-v2-row:hover': {
              background: 'var(--chakra-colors-bg-muted) !important',
            },
            '& .table-v2-cell': {
              fontFamily: 'var(--chakra-fonts-mono)',
              fontSize: 'var(--chakra-fontSizes-sm)',
              color: 'var(--chakra-colors-fg-default)',
              padding: '12px 16px',
              textAlign: 'left',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            },
            '& .table-v2-cell:hover': {
              background: 'var(--chakra-colors-bg-emphasized)',
            },
          }}
        >
          <Box
            as="table"
            // mx-* classes are the STABLE contract for css overrides (Viz V2 table
            // source `css` field / story-level styling) — documented in atlas-schemas.
            className="mx-table"
            width="100%"
            fontSize="sm"
            borderCollapse="collapse"
            tableLayout="fixed"
            minW={`${visibleColumnCount * 150}px`}
          >
            {/* Header */}
            <Box as="thead" position="sticky" top={0} zIndex={2} bg="bg.muted">
              <Box as="tr" className="mx-header-row">
                {visibleHeaders.map((header, displayIndex) => (
                  <TableHeaderCell
                    key={header.id}
                    header={header}
                    colNames={colNames}
                    columnTypes={columnTypes}
                    displayIndex={displayIndex}
                    totalHeaders={visibleHeaders.length}
                    getDisplayName={getDisplayName}
                    columnFormats={columnFormats}
                    onColumnFormatsChange={onColumnFormatsChange}
                    handleFormatChange={handleFormatChange}
                    activeFilterCol={activeFilterCol}
                    setActiveFilterCol={setActiveFilterCol}
                    activeFormatCol={activeFormatCol}
                    setActiveFormatCol={setActiveFormatCol}
                    columnUniqueValues={columnUniqueValues}
                    rowsLength={rows.length}
                    showStats={showStats}
                    stats={stats}
                    loadingStats={loadingStats}
                    histograms={histograms}
                  />
                ))}
              </Box>
            </Box>

            {/* Virtualized Body — native elements + event delegation for performance */}
            <TableBody
              enableDrilldown={enableDrilldown}
              handleBodyClick={handleBodyClick}
              virtualItems={virtualItems}
              totalSize={rowVirtualizer.getTotalSize()}
              tableRows={tableRows}
              visibleColIds={visibleColIds}
              colSizes={colSizes}
              wrapColumns={wrapColumns}
              onRowClick={onRowClick}
              getCellBg={getCellBg}
              renderCell={renderCell}
              formatCell={formatCell}
              columnTypes={columnTypes}
              colIndexMap={colIndexMap}
            />
          </Box>
        </Box>
      )}

      {/* Bottom Bar */}
      <TableBottomBar
        colNames={colNames}
        columnTypes={columnTypes}
        columnVisibility={columnVisibility}
        setColumnVisibility={setColumnVisibility}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        setActiveFilterCol={setActiveFilterCol}
        showStats={showStats}
        setShowStats={setShowStats}
        filteredRowCount={tableRows.length}
        totalRowCount={rows.length}
        downloadCsv={downloadCsv}
      />
      <DrillDownCard drillDown={drillDown} onClose={closeDrillDown} sql={sql} databaseName={databaseName} />
    </Box>
  )
}
