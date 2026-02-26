import { useState, useEffect, useRef } from 'react'
import { Table as ChakraTable, Box, HStack, Button, Text, VStack, Menu, Portal, Icon, Spinner } from '@chakra-ui/react'
import { LuChevronLeft, LuChevronRight, LuChevronDown, LuType, LuHash, LuCalendar, LuColumns3, LuCheck } from 'react-icons/lu'
import { calculateColumnStats, ColumnStats, getColumnType, loadDataIntoTable, generateRandomTableName } from '@/lib/database/duckdb'
import { calculateHistogram } from '@/lib/chart/histogram'
import { MiniHistogram } from './MiniHistogram'
import { MiniBarChart } from './MiniBarChart'

interface TableProps {
  columns: string[]
  types?: string[]
  rows: Record<string, any>[]
  pageSize?: number // Optional fixed page size, otherwise calculated from height
}

type ColumnType = 'text' | 'number' | 'date'

const formatValue = (value: any, type: ColumnType): string => {
  if (value === null || value === undefined) {
    return '-'
  }

  switch (type) {
    case 'number':
      // Format numbers with commas
      if (typeof value === 'number') {
        return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
      }
      return String(value)

    case 'date':
      // Format dates consistently
      if (value instanceof Date) {
        return value.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      }
      return String(value)

    case 'text':
    default:
      return String(value)
  }
}

const getTypeIcon = (type: ColumnType) => {
  switch (type) {
    case 'number':
      return LuHash
    case 'date':
      return LuCalendar
    case 'text':
    default:
      return LuType
  }
}

const getTypeColor = (type: ColumnType) => {
  switch (type) {
    case 'number':
      return '#2980b9' // Belize Hole (theme primary blue)
    case 'date':
      return '#9b59b6' // Amethyst (theme purple)
    case 'text':
    default:
      return '#f39c12' // Orange (theme warning)
  }
}

export const Table = ({ columns, types, rows, pageSize: fixedPageSize }: TableProps) => {
  const [currentPage, setCurrentPage] = useState(1)
  const [stats, setStats] = useState<Record<string, ColumnStats> | null>(null)
  const [histograms, setHistograms] = useState<Record<string, Array<{ bin: number; binMin: number; binMax: number; count: number }>>>({})
  const [loadingStats, setLoadingStats] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState<number>(0)
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(columns))

  // Reset visible columns when columns change
  useEffect(() => {
    setVisibleColumns(new Set(columns))
  }, [columns])

  const toggleColumn = (column: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev)
      if (next.has(column)) {
        next.delete(column)
      } else {
        next.add(column)
      }
      return next
    })
  }

  const toggleAllColumns = () => {
    if (visibleColumns.size > 0) {
      // Hide all
      setVisibleColumns(new Set())
    } else {
      // Show all
      setVisibleColumns(new Set(columns))
    }
  }

  // Map SQL types to column types
  const columnTypes: ColumnType[] = types
    ? types.map(getColumnType)
    : columns.map(() => 'text')

  // Filter columns based on visibility - get indices to preserve original column type mappings
  const displayColumnIndices = columns
    .map((col, i) => ({ col, index: i }))
    .filter(({ col }) => visibleColumns.has(col))
    .map(({ index }) => index)

  // Measure container height to calculate dynamic page size
  useEffect(() => {
    if (!containerRef.current) return

    const updateHeight = () => {
      if (containerRef.current) {
        const height = containerRef.current.offsetHeight
        if (height > 0) setContainerHeight(height)
      }
    }

    updateHeight()

    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  // Calculate dynamic page size based on available height
  // Header with stats is ~150px, each row is ~45px, pagination is ~60px
  const HEADER_HEIGHT = 150
  const ROW_HEIGHT = 45
  const PAGINATION_HEIGHT = 60
  const calculatedPageSize = containerHeight > 0
    ? Math.max(3, Math.floor((containerHeight - HEADER_HEIGHT - PAGINATION_HEIGHT) / ROW_HEIGHT))
    : 10

  // Use fixed page size if provided, otherwise use calculated
  const pageSize = fixedPageSize || calculatedPageSize

  useEffect(() => {
    if (columns.length > 0 && rows.length > 0 && types) {
      console.log('Calculating stats for', columns.length, 'columns and', rows.length, 'rows')
      setLoadingStats(true)

      // Load data into table once, then run all calculations on it
      const tableName = generateRandomTableName()
      console.log('Using random table name:', tableName)
      loadDataIntoTable(tableName, rows)
        .then(async () => {
          // Calculate stats using the loaded table
          const calculatedStats = await calculateColumnStats(tableName, columns, types)
          console.log('Stats calculated:', calculatedStats)
          setStats(calculatedStats)
          setLoadingStats(false)

          // Calculate histograms for number and date columns
          const histogramColumns = columns
            .map((col, index) => ({
              col,
              type: types[index] ? getColumnType(types[index]) : 'text'
            }))
            .filter(({ type }) => type === 'number' || type === 'date')

          const histResults = await Promise.all(
            histogramColumns.map(async ({ col, type }) => {
              const hist = await calculateHistogram(tableName, col, type as 'number' | 'date', 20)
              console.log(`Histogram for ${col}:`, hist)
              return { col, hist }
            })
          )

          const histMap: Record<string, Array<{ bin: number; binMin: number; binMax: number; count: number }>> = {}
          histResults.forEach(({ col, hist }) => {
            histMap[col] = hist
          })
          setHistograms(histMap)
          console.log('All histograms calculated:', histMap)
        })
        .catch(error => {
          console.error('Failed to calculate stats/histograms:', error)
          setLoadingStats(false)
        })
    }
  }, [columns, rows, types])

  if (!columns || columns.length === 0) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        No data available
      </Box>
    )
  }

  const totalPages = Math.ceil(rows.length / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const currentRows = rows.slice(startIndex, endIndex)

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(1, prev - 1))
  }

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages, prev + 1))
  }

  return (
    <Box ref={containerRef} height="100%" display="flex" flexDirection="column">
      {displayColumnIndices.length === 0 ? (
        <Box flex="1" display="flex" alignItems="center" justifyContent="center">
          <Text fontSize="sm" color="fg.muted">
            No columns selected. Use the Columns menu to show columns.
          </Text>
        </Box>
      ) : (
      <Box overflow="auto" flex="1" minHeight="0">
        <ChakraTable.Root key={displayColumnIndices.join(',')} variant="outline" size="sm" tableLayout="fixed">
          <ChakraTable.Header position="sticky" top={0} zIndex={1} bg="bg.muted">
            <ChakraTable.Row bg="bg.muted">
              {displayColumnIndices.map((originalIndex, displayIndex) => {
                const column = columns[originalIndex]
                return (
                  <ChakraTable.ColumnHeader
                    key={column}
                    fontFamily="heading"
                    fontWeight="700"
                    fontSize="xs"
                    color="fg.default"
                    py={3}
                    px={4}
                    textAlign="left"
                    width={`${100 / displayColumnIndices.length}%`}
                    borderRight="1px solid"
                    borderRightColor="border.default"
                    _last={{ borderRight: 'none' }}
                  >
                    <VStack align="start" gap={1}>
                      <HStack gap={1.5} justify="start">
                        <Box
                          as={getTypeIcon(columnTypes[originalIndex])}
                          fontSize="11px"
                          color={getTypeColor(columnTypes[originalIndex])}
                        />
                        <Text textTransform="uppercase" letterSpacing="0.05em">
                          {column}
                        </Text>
                      </HStack>
                      <Box h="100px" w="100%" overflow="hidden">
                        {loadingStats && !stats && (
                          <Box w="100%" h="100%" display="flex" alignItems="center" justifyContent="center">
                            <Spinner size="sm" color="fg.subtle" />
                          </Box>
                        )}
                        {stats && stats[column] && (
                          <>
                            <Text
                              fontSize="2xs"
                              color="fg.subtle"
                              fontFamily="mono"
                              fontWeight="400"
                            >
                              {stats[column].type === 'number' && (
                                <>
                                  avg: {stats[column].avg.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                </>
                              )}
                              {stats[column].type === 'date' && (
                                <>
                                  {stats[column].unique} unique
                                </>
                              )}
                              {stats[column].type === 'text' && (
                                <>
                                  {stats[column].unique} unique
                                </>
                              )}
                            </Text>
                            {stats[column].type === 'text' && stats[column].topValues.length > 0 && (
                              <Box mt={1} w={"100%"}>
                                <MiniBarChart
                                  data={stats[column].topValues}
                                  totalUnique={stats[column].unique}
                                  color={getTypeColor(columnTypes[originalIndex])}
                                  height={75}
                                />
                              </Box>
                            )}
                            {(stats[column].type === 'number' || stats[column].type === 'date') && histograms[column] && (
                              <Box mt={1} w={"100%"}>
                                <MiniHistogram
                                  data={histograms[column]}
                                  color={getTypeColor(columnTypes[originalIndex])}
                                  height={30}
                                  isDate={stats[column].type === 'date'}
                                  isFirstColumn={displayIndex === 0}
                                  isLastColumn={displayIndex === displayColumnIndices.length - 1}
                                />
                              </Box>
                            )}
                          </>
                        )}
                      </Box>
                    </VStack>
                  </ChakraTable.ColumnHeader>
                )
              })}
            </ChakraTable.Row>
          </ChakraTable.Header>
          <ChakraTable.Body>
            {currentRows.map((row, rowIndex) => (
              <ChakraTable.Row
                key={startIndex + rowIndex}
                _hover={{ bg: 'bg.muted/50' }}
                transition="background 0.15s"
              >
                {displayColumnIndices.map((originalIndex) => {
                  const column = columns[originalIndex]
                  return (
                    <ChakraTable.Cell
                      key={column}
                      fontFamily="mono"
                      fontSize="sm"
                      color="fg.default"
                      py={3}
                      px={4}
                      textAlign="left"
                      borderRight="1px solid"
                      borderRightColor="border.muted"
                      _last={{ borderRight: 'none' }}
                      overflow="hidden"
                      textOverflow="ellipsis"
                      whiteSpace="nowrap"
                    >
                      {formatValue(row[column], columnTypes[originalIndex])}
                    </ChakraTable.Cell>
                  )
                })}
              </ChakraTable.Row>
            ))}
          </ChakraTable.Body>
        </ChakraTable.Root>
      </Box>
      )}

      {/* Bottom Bar - Column Selector & Pagination */}
      <HStack justify="space-between" align="center" mt={2} px={2} flexShrink={0}>
        {/* Left: Row count & Column selector */}
        <HStack gap={3}>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Showing {startIndex + 1}-{Math.min(endIndex, rows.length)} of {rows.length} rows
          </Text>
          <Menu.Root closeOnSelect={false}>
            <Menu.Trigger asChild>
              <Button
                size="xs"
                variant="outline"
                bg="bg.muted"
                borderColor="border.default"
                _hover={{ bg: 'bg.subtle', borderColor: 'border.emphasized' }}
              >
                <Icon as={LuColumns3} boxSize={3.5} />
                {visibleColumns.size}/{columns.length} Columns
                <Icon as={LuChevronDown} boxSize={3.5} color="fg.muted" />
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
                    onClick={toggleAllColumns}
                  >
                    <HStack gap={2} w="100%">
                      <Box w={4} h={4} display="flex" alignItems="center" justifyContent="center">
                        {visibleColumns.size === columns.length && (
                          <Icon as={LuCheck} boxSize={4} color="accent.teal" />
                        )}
                      </Box>
                      <Text fontSize="xs" fontWeight="600">
                        {visibleColumns.size > 0 ? 'Hide All' : 'Show All'}
                      </Text>
                    </HStack>
                  </Menu.Item>
                  <Box h="1px" bg="border.default" my={1} />
                  {columns.map((column, index) => (
                    <Menu.Item
                      key={column}
                      value={column}
                      cursor="pointer"
                      borderRadius="sm"
                      px={3}
                      py={1.5}
                      _hover={{ bg: 'bg.muted' }}
                      onClick={() => toggleColumn(column)}
                    >
                      <HStack gap={2} w="100%">
                        <Box w={4} h={4} display="flex" alignItems="center" justifyContent="center">
                          {visibleColumns.has(column) && (
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
        </HStack>

        {/* Right: Pagination (only if needed) */}
        {totalPages > 1 && (
          <HStack gap={2}>
            <Button
              size="xs"
              variant="ghost"
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
            >
              <LuChevronLeft />
              Prev
            </Button>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              {currentPage}/{totalPages}
            </Text>
            <Button
              size="xs"
              variant="ghost"
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
            >
              Next
              <LuChevronRight />
            </Button>
          </HStack>
        )}
      </HStack>
    </Box>
  )
}
