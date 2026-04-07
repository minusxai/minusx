import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Box, HStack, Button, Text, VStack, Menu, Portal, Icon, Spinner, Input } from '@chakra-ui/react'
import { LuChevronDown, LuType, LuHash, LuCalendar, LuBraces, LuColumns3, LuCheck, LuDownload, LuArrowUp, LuArrowDown, LuFilter, LuX, LuArrowUpDown, LuChartColumn } from 'react-icons/lu'
import { calculateColumnStats, ColumnStats, getColumnType, loadDataIntoTable, generateRandomTableName } from '@/lib/database/duckdb'
import { calculateHistogram } from '@/lib/chart/histogram'
import { MiniHistogram } from './MiniHistogram'
import { MiniBarChart } from './MiniBarChart'
import { DrillDownCard, type DrillDownState } from './DrillDownCard'
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

interface TableProps {
  columns: string[]
  types?: string[]
  rows: Record<string, any>[]
  pageSize?: number
  sql?: string
  databaseName?: string
}

type ColumnType = 'text' | 'number' | 'date' | 'json'

// Reusable format options — created once, not per call
const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

const formatValue = (value: any, type: ColumnType): string => {
  if (value === null || value === undefined) {
    return '-'
  }
  switch (type) {
    case 'number':
      if (typeof value === 'number') {
        return NUMBER_FORMAT.format(value)
      }
      return String(value)
    case 'date':
      if (value instanceof Date) {
        return DATE_FORMAT.format(value)
      }
      return String(value)
    case 'json':
      if (typeof value === 'object') {
        return JSON.stringify(value)
      }
      return String(value)
    case 'text':
    default:
      if (typeof value === 'object') {
        return JSON.stringify(value)
      }
      return String(value)
  }
}

const getTypeIcon = (type: ColumnType) => {
  switch (type) {
    case 'number': return LuHash
    case 'date': return LuCalendar
    case 'json': return LuBraces
    case 'text':
    default: return LuType
  }
}

const getTypeColor = (type: ColumnType) => {
  switch (type) {
    case 'number': return '#2980b9'
    case 'date': return '#9b59b6'
    case 'json': return '#1abc9c'
    case 'text':
    default: return '#f39c12'
  }
}

const ROW_HEIGHT = 41
// Max unique values to show checkbox picker; above this only the search bar is shown.
// Uses the greater of this floor or 50% of total rows.
const FACET_PICKER_MAX_UNIQUE = 500
const FACET_PICKER_RATIO = 0.5

// Filter value: text search OR a set of selected values
interface FacetedFilterValue {
  search: string
  selected: string[] // stored as array for serialization; treated as set
}

const isFacetedFilter = (v: unknown): v is FacetedFilterValue =>
  v != null && typeof v === 'object' && 'search' in v

export const TableV2 = ({ columns: colNames, types, rows, pageSize: _fixedPageSize, sql, databaseName }: TableProps) => {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({})
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null)
  const closeDrillDown = useCallback(() => setDrillDown(null), [])
  const [stats, setStats] = useState<Record<string, ColumnStats> | null>(null)
  const [histograms, setHistograms] = useState<Record<string, Array<{ bin: number; binMin: number; binMax: number; count: number }>>>({})
  const [loadingStats, setLoadingStats] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [activeFilterCol, setActiveFilterCol] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const tableBodyRef = useRef<HTMLDivElement>(null)

  const columnTypes: ColumnType[] = useMemo(
    () => types ? types.map(getColumnType) : colNames.map(() => 'text'),
    [types, colNames]
  )

  // Reset visibility when columns change
  useEffect(() => {
    setColumnVisibility({})
    setColumnFilters([])
    setSorting([])
    setColumnSizing({})
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
    const header = visibleCols.map(escape).join(',')
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
  }, [colNames, tableRows, columnVisibility])

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
            '& .table-v2-row': {
              borderBottom: '1px solid var(--chakra-colors-border-muted)',
            },
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
            width="100%"
            fontSize="sm"
            borderCollapse="collapse"
            tableLayout="fixed"
            minW={`${visibleColumnCount * 150}px`}
          >
            {/* Header */}
            <Box as="thead" position="sticky" top={0} zIndex={2} bg="bg.muted">
              <Box as="tr">
                {visibleHeaders.map((header, displayIndex) => {
                  const colIndex = colNames.indexOf(header.id)
                  const colType = columnTypes[colIndex]
                  const isSorted = header.column.getIsSorted()
                  const rawFilter = header.column.getFilterValue()
                  const facetedFilter: FacetedFilterValue = isFacetedFilter(rawFilter)
                    ? rawFilter
                    : { search: '', selected: [] }
                  const hasActiveFilter = facetedFilter.search !== '' || facetedFilter.selected.length > 0

                  return (
                    <Box
                      as="th"
                      key={header.id}
                      textAlign="left"
                      py={3}
                      px={4}
                      fontFamily="heading"
                      fontWeight="700"
                      fontSize="xs"
                      color="fg.default"
                      borderRight="1px solid"
                      borderRightColor="border.default"
                      borderBottom={(hasActiveFilter || isSorted) ? '2px solid' : '1px solid'}
                      borderBottomColor={(hasActiveFilter || isSorted) ? 'accent.teal' : 'border.default'}
                      bg={(hasActiveFilter || isSorted) ? 'accent.teal/5' : undefined}
                      width={header.getSize()}
                      minW="100px"
                      _last={{ borderRight: 'none' }}
                      position="relative"
                      verticalAlign="top"
                    >
                      {/* Resize handle */}
                      <Box
                        position="absolute"
                        right={0}
                        top={0}
                        bottom={0}
                        w="4px"
                        cursor="col-resize"
                        userSelect="none"
                        touchAction="none"
                        opacity={header.column.getIsResizing() ? 1 : 0}
                        _hover={{ opacity: 1 }}
                        bg="accent.teal"
                        zIndex={3}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                      />
                      <VStack align="start" gap={1}>
                        {/* Column name + sort + filter controls */}
                        <HStack gap={1} justify="start" overflow="hidden" w="100%">
                          <Box
                            as={getTypeIcon(colType)}
                            fontSize="11px"
                            color={getTypeColor(colType)}
                            flexShrink={0}
                          />
                          <Text
                            textTransform="uppercase"
                            letterSpacing="0.05em"
                            truncate
                            flex="1"
                            cursor="pointer"
                            onClick={header.column.getToggleSortingHandler()}
                            _hover={{ color: 'accent.teal' }}
                          >
                            {header.id}
                          </Text>
                          <HStack gap={0.5} flexShrink={0}>
                            {/* Sort indicator / toggle */}
                            <Box
                              as="button"
                              onClick={header.column.getToggleSortingHandler()}
                              cursor="pointer"
                              display="flex"
                              alignItems="center"
                              justifyContent="center"
                              w={4} h={4}
                              borderRadius="sm"
                              bg={isSorted ? 'accent.teal' : undefined}
                              opacity={isSorted ? 1 : 0.5}
                              _hover={{ opacity: 1, bg: isSorted ? 'accent.teal' : 'bg.subtle' }}
                              transition="all 0.15s"
                            >
                              {isSorted === 'asc' ? (
                                <Icon as={LuArrowUp} boxSize={2.5} color="white" />
                              ) : isSorted === 'desc' ? (
                                <Icon as={LuArrowDown} boxSize={2.5} color="white" />
                              ) : (
                                <Icon as={LuArrowUpDown} boxSize={2.5} color="fg.muted" />
                              )}
                            </Box>
                            {/* Filter toggle */}
                            {colType !== 'json' && (
                              <Box
                                as="button"
                                data-filter-anchor={header.id}
                                onClick={() => setActiveFilterCol(prev => prev === header.id ? null : header.id)}
                                cursor="pointer"
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                                w={4} h={4}
                                borderRadius="sm"
                                bg={hasActiveFilter ? 'accent.teal' : undefined}
                                opacity={hasActiveFilter ? 1 : 0.5}
                                _hover={{ opacity: 1, bg: hasActiveFilter ? 'accent.teal' : 'bg.subtle' }}
                                transition="all 0.15s"
                              >
                                <Icon as={LuFilter} boxSize={2.5} color={hasActiveFilter ? 'white' : 'fg.muted'} />
                              </Box>
                            )}
                          </HStack>
                        </HStack>

                        {/* Faceted filter popover — rendered via Portal */}
                        {activeFilterCol === header.id && (
                          <Portal>
                            <Box
                              position="fixed"
                              top={0} left={0} right={0} bottom={0}
                              zIndex={99}
                              onClick={() => setActiveFilterCol(null)}
                            />
                            <Box
                              position="absolute"
                              zIndex={100}
                              bg="bg.surface"
                              border="1px solid"
                              borderColor="border.default"
                              borderRadius="md"
                              shadow="lg"
                              p={2}
                              w="220px"
                              ref={(el: HTMLDivElement | null) => {
                                if (!el) return
                                // Position below the filter icon
                                const th = el.closest('body')?.querySelector(`th [data-filter-anchor="${header.id}"]`)
                                if (!th) return
                                const rect = (th as HTMLElement).getBoundingClientRect()
                                el.style.top = `${rect.bottom + 4}px`
                                el.style.left = `${Math.max(8, rect.left - 180)}px`
                                el.style.position = 'fixed'
                              }}
                              onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            >
                              <VStack gap={1.5} align="stretch">
                                <HStack gap={1}>
                                  <Input
                                    size="xs"
                                    placeholder="Search values..."
                                    value={facetedFilter.search}
                                    onChange={(e) => {
                                      const search = e.target.value
                                      header.column.setFilterValue(
                                        search || facetedFilter.selected.length > 0
                                          ? { search, selected: facetedFilter.selected }
                                          : undefined
                                      )
                                    }}
                                    fontFamily="mono"
                                    fontSize="xs"
                                    autoFocus
                                    bg="bg.surface"
                                    borderColor="border.default"
                                    _focus={{ borderColor: 'accent.teal', boxShadow: 'none' }}
                                  />
                                  {hasActiveFilter && (
                                    <Box
                                      as="button"
                                      onClick={() => {
                                        header.column.setFilterValue(undefined)
                                        setActiveFilterCol(null)
                                      }}
                                      cursor="pointer"
                                      display="flex"
                                      alignItems="center"
                                      flexShrink={0}
                                    >
                                      <Icon as={LuX} boxSize={3} color="fg.subtle" />
                                    </Box>
                                  )}
                                </HStack>
                                {columnUniqueValues[header.id] && columnUniqueValues[header.id].length <= Math.max(FACET_PICKER_MAX_UNIQUE, rows.length * FACET_PICKER_RATIO) && (
                                  <Box maxH="200px" overflowY="auto" css={{
                                    '&::-webkit-scrollbar': { width: '4px' },
                                    '&::-webkit-scrollbar-thumb': { background: '#16a085', borderRadius: '2px' },
                                  }}>
                                    {columnUniqueValues[header.id]
                                      .filter(({ value }) =>
                                        !facetedFilter.search || value.toLowerCase().includes(facetedFilter.search.toLowerCase())
                                      )
                                      .slice(0, 50)
                                      .map(({ value, count }) => {
                                        const isSelected = facetedFilter.selected.includes(value)
                                        return (
                                          <HStack
                                            key={value}
                                            gap={1.5}
                                            px={1.5}
                                            py={1}
                                            cursor="pointer"
                                            borderRadius="sm"
                                            bg={isSelected ? 'accent.teal/10' : undefined}
                                            _hover={{ bg: isSelected ? 'accent.teal/15' : 'bg.subtle' }}
                                            onClick={() => {
                                              const next = isSelected
                                                ? facetedFilter.selected.filter(v => v !== value)
                                                : [...facetedFilter.selected, value]
                                              header.column.setFilterValue(
                                                next.length > 0 || facetedFilter.search
                                                  ? { search: facetedFilter.search, selected: next }
                                                  : undefined
                                              )
                                            }}
                                          >
                                            <Box
                                              w={3} h={3} borderRadius="sm" flexShrink={0}
                                              border="1px solid"
                                              borderColor={isSelected ? 'accent.teal' : 'border.default'}
                                              bg={isSelected ? 'accent.teal' : 'transparent'}
                                              display="flex" alignItems="center" justifyContent="center"
                                            >
                                              {isSelected && <Icon as={LuCheck} boxSize={2} color="white" />}
                                            </Box>
                                            <Text fontSize="xs" fontFamily="mono" truncate flex="1" color="fg.default">
                                              {value}
                                            </Text>
                                            <Text fontSize="xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>
                                              {count}
                                            </Text>
                                          </HStack>
                                        )
                                      })}
                                  </Box>
                                )}
                                {facetedFilter.selected.length > 0 && (
                                  <Text fontSize="2xs" color="accent.teal" fontFamily="mono" textAlign="center">
                                    {facetedFilter.selected.length} selected
                                  </Text>
                                )}
                              </VStack>
                            </Box>
                          </Portal>
                        )}

                        {/* Stats area — only rendered when toggled on */}
                        {showStats && (
                          <Box h="100px" w="100%" overflow="hidden">
                            {colType === 'json' ? (
                              <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" fontWeight="400">
                                stats n/a
                              </Text>
                            ) : (
                              <>
                                {loadingStats && !stats && (
                                  <Box w="100%" h="100%" display="flex" alignItems="center" justifyContent="center">
                                    <Spinner size="sm" color="fg.subtle" />
                                  </Box>
                                )}
                                {(() => {
                                  const colStats = stats?.[header.id]
                                  if (!colStats) return null
                                  return (
                                    <>
                                      <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" fontWeight="400">
                                        {colStats.type === 'number' && (
                                          <>avg: {colStats.avg.toLocaleString('en-US', { maximumFractionDigits: 0 })}</>
                                        )}
                                        {colStats.type === 'date' && (
                                          <>{colStats.unique} unique</>
                                        )}
                                        {colStats.type === 'text' && (
                                          <>{colStats.unique} unique</>
                                        )}
                                      </Text>
                                      {colStats.type === 'text' && colStats.topValues.length > 0 && (
                                        <Box mt={1} w="100%">
                                          <MiniBarChart
                                            data={colStats.topValues}
                                            totalUnique={colStats.unique}
                                            color={getTypeColor(colType)}
                                            height={75}
                                          />
                                        </Box>
                                      )}
                                      {(colStats.type === 'number' || colStats.type === 'date') && histograms[header.id] && (
                                        <Box mt={1} w="100%">
                                          <MiniHistogram
                                            data={histograms[header.id]}
                                            color={getTypeColor(colType)}
                                            height={30}
                                            isDate={colStats.type === 'date'}
                                            isFirstColumn={displayIndex === 0}
                                            isLastColumn={displayIndex === visibleHeaders.length - 1}
                                          />
                                        </Box>
                                      )}
                                    </>
                                  )
                                })()}
                              </>
                            )}
                          </Box>
                        )}
                      </VStack>
                    </Box>
                  )
                })}
              </Box>
            </Box>

            {/* Virtualized Body — native elements + event delegation for performance */}
            <tbody onClick={handleBodyClick}>
              {virtualItems.length > 0 && virtualItems[0].start > 0 && (
                <tr><td style={{ height: virtualItems[0].start, padding: 0 }} /></tr>
              )}
              {virtualItems.map((virtualRow) => {
                const row = tableRows[virtualRow.index]
                const original = row.original
                const lastColIdx = visibleColIds.length - 1
                return (
                  <tr
                    key={row.id}
                    data-row-idx={virtualRow.index}
                    className="table-v2-row"
                    style={{
                      height: ROW_HEIGHT,
                      background: virtualRow.index % 2 === 1 ? 'var(--chakra-colors-bg-muted)' : undefined,
                    }}
                  >
                    {visibleColIds.map((colId, cellIdx) => (
                      <td
                        key={colId}
                        data-col-id={colId}
                        className="table-v2-cell"
                        style={{
                          width: colSizes[colId],
                          borderRight: cellIdx < lastColIdx ? '1px solid var(--chakra-colors-border-muted)' : undefined,
                        }}
                      >
                        {formatValue(original[colId], columnTypes[colIndexMap[colId]])}
                      </td>
                    ))}
                  </tr>
                )
              })}
              {virtualItems.length > 0 && rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end > 0 && (
                <tr><td style={{ height: rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end, padding: 0 }} /></tr>
              )}
            </tbody>
          </Box>
        </Box>
      )}

      {/* Bottom Bar */}
      <HStack justify="space-between" align="center" mt={2} px={2} flexShrink={0}>
        {/* Left: Stats, Columns, Filters */}
        <HStack gap={3}>
          <Button
            size="2xs"
            variant={showStats ? 'solid' : 'outline'}
            bg={showStats ? 'accent.teal' : 'bg.muted'}
            color={showStats ? 'white' : undefined}
            borderColor={showStats ? 'accent.teal' : 'border.default'}
            _hover={{ bg: showStats ? 'accent.teal/80' : 'bg.subtle', borderColor: 'border.emphasized' }}
            onClick={() => setShowStats(prev => !prev)}
          >
            <Icon as={LuChartColumn} boxSize={3} />
            Stats
          </Button>
          <Menu.Root closeOnSelect={false}>
            <Menu.Trigger asChild>
              <Button
                size="2xs"
                variant="outline"
                bg="bg.muted"
                borderColor="border.default"
                _hover={{ bg: 'bg.subtle', borderColor: 'border.emphasized' }}
              >
                <Icon as={LuColumns3} boxSize={3} />
                {visibleColumnCount}/{colNames.length} Columns
                <Icon as={LuChevronDown} boxSize={3} color="fg.muted" />
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content
                  minW="200px"
                  maxH="300px"
                  overflowY="auto"
                  bg="bg.surface"
                  borderColor="border.default"
                  shadow="lg"
                  p={1}
                >
                  <Menu.Item
                    value="toggle-all"
                    cursor="pointer"
                    borderRadius="sm"
                    px={3}
                    py={2}
                    _hover={{ bg: 'bg.muted' }}
                    onClick={() => {
                      const allVisible = colNames.every(c => columnVisibility[c] !== false)
                      if (allVisible) {
                        const hidden: VisibilityState = {}
                        colNames.forEach(c => { hidden[c] = false })
                        setColumnVisibility(hidden)
                      } else {
                        setColumnVisibility({})
                      }
                    }}
                  >
                    <HStack gap={2} w="100%">
                      <Box w={4} h={4} display="flex" alignItems="center" justifyContent="center">
                        {colNames.every(c => columnVisibility[c] !== false) && (
                          <Icon as={LuCheck} boxSize={4} color="accent.teal" />
                        )}
                      </Box>
                      <Text fontSize="xs" fontWeight="600">
                        {colNames.every(c => columnVisibility[c] !== false) ? 'Hide All' : 'Show All'}
                      </Text>
                    </HStack>
                  </Menu.Item>
                  <Box h="1px" bg="border.default" my={1} />
                  {colNames.map((column, index) => (
                    <Menu.Item
                      key={column}
                      value={column}
                      cursor="pointer"
                      borderRadius="sm"
                      px={3}
                      py={1.5}
                      _hover={{ bg: 'bg.muted' }}
                      onClick={() => {
                        setColumnVisibility(prev => ({
                          ...prev,
                          [column]: prev[column] === false ? true : false,
                        }))
                      }}
                    >
                      <HStack gap={2} w="100%">
                        <Box w={4} h={4} display="flex" alignItems="center" justifyContent="center">
                          {columnVisibility[column] !== false && (
                            <Icon as={LuCheck} boxSize={4} color="accent.teal" />
                          )}
                        </Box>
                        <Box
                          as={getTypeIcon(columnTypes[index])}
                          fontSize="11px"
                          color={getTypeColor(columnTypes[index])}
                        />
                        <Text fontSize="xs" fontFamily="mono" truncate>
                          {column}
                        </Text>
                      </HStack>
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
          {columnFilters.length > 0 && (
            <Button
              size="xs"
              variant="ghost"
              color="accent.teal"
              onClick={() => {
                setColumnFilters([])
                setActiveFilterCol(null)
              }}
            >
              <Icon as={LuX} boxSize={3} />
              Clear {columnFilters.length} filter{columnFilters.length > 1 ? 's' : ''}
            </Button>
          )}
        </HStack>

        {/* Right: Row count, CSV */}
        <HStack gap={3}>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            {tableRows.length !== rows.length
              ? `${tableRows.length} filtered of ${rows.length} rows`
              : `${rows.length} rows`
            }
          </Text>
          <Button
            size="2xs"
            variant="outline"
            bg="bg.muted"
            borderColor="border.default"
            _hover={{ bg: 'bg.subtle', borderColor: 'border.emphasized' }}
            onClick={downloadCsv}
          >
            <Icon as={LuDownload} boxSize={3} />
            CSV
          </Button>
        </HStack>
      </HStack>
      <DrillDownCard drillDown={drillDown} onClose={closeDrillDown} sql={sql} databaseName={databaseName} />
    </Box>
  )
}
