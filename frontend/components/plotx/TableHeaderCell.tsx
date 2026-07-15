import { Box, HStack, VStack, Text, Portal, Icon, Spinner, Input } from '@chakra-ui/react'
import { LuCheck, LuArrowUp, LuArrowDown, LuFilter, LuX, LuArrowUpDown, LuSettings2 } from 'react-icons/lu'
import type { Header } from '@tanstack/react-table'
import type { ColumnStats } from '@/lib/database/duckdb'
import type { ColumnFormatConfig } from '@/lib/types'
import { FormatPopover } from './AxisComponents'
import { MiniHistogram } from './MiniHistogram'
import { MiniBarChart } from './MiniBarChart'
import {
  type ColumnType,
  type FacetedFilterValue,
  cssColumnClass,
  getTypeIcon,
  getTypeColor,
  isFacetedFilter,
  FACET_PICKER_MAX_UNIQUE,
  FACET_PICKER_RATIO,
} from './table-v2-utils'

interface TableHeaderCellProps {
  header: Header<Record<string, any>, any>
  colNames: string[]
  columnTypes: ColumnType[]
  displayIndex: number
  totalHeaders: number
  getDisplayName: (col: string) => string
  columnFormats?: Record<string, ColumnFormatConfig>
  onColumnFormatsChange?: (formats: Record<string, ColumnFormatConfig>) => void
  handleFormatChange: (col: string, cfg: ColumnFormatConfig) => void
  /** d3 vocabulary format popover (Viz V2 table). */
  d3Formats?: boolean
  activeFilterCol: string | null
  setActiveFilterCol: React.Dispatch<React.SetStateAction<string | null>>
  activeFormatCol: string | null
  setActiveFormatCol: React.Dispatch<React.SetStateAction<string | null>>
  columnUniqueValues: Record<string, Array<{ value: string; count: number }>>
  rowsLength: number
  showStats: boolean
  stats: Record<string, ColumnStats> | null
  loadingStats: boolean
  histograms: Record<string, Array<{ bin: number; binMin: number; binMax: number; count: number }>>
}

/** Single table header cell: column name + sort/filter/format controls, faceted filter
 * popover, rename/format popover, and (when enabled) the column stats mini-charts. */
export const TableHeaderCell = ({
  header,
  colNames,
  columnTypes,
  displayIndex,
  totalHeaders,
  getDisplayName,
  columnFormats,
  onColumnFormatsChange,
  handleFormatChange,
  d3Formats,
  activeFilterCol,
  setActiveFilterCol,
  activeFormatCol,
  setActiveFormatCol,
  columnUniqueValues,
  rowsLength,
  showStats,
  stats,
  loadingStats,
  histograms,
}: TableHeaderCellProps) => {
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
      // Stable class contract for css overrides (Viz V2 table / story styling)
      className={`mx-th ${cssColumnClass(header.id)}`}
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
            aria-label={`Column header ${getDisplayName(header.id)}`}
            textTransform="uppercase"
            letterSpacing="0.05em"
            truncate
            flex="1"
            cursor="pointer"
            onClick={header.column.getToggleSortingHandler()}
            _hover={{ color: 'accent.teal' }}
          >
            {getDisplayName(header.id)}
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
            {/* Rename / format toggle — only when editable */}
            {onColumnFormatsChange && (() => {
              const hasFormat = !!columnFormats?.[header.id]
              return (
                <Box
                  as="button"
                  data-format-anchor={header.id}
                  aria-label={`Format column ${header.id}`}
                  onClick={() => setActiveFormatCol(prev => prev === header.id ? null : header.id)}
                  cursor="pointer"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  w={4} h={4}
                  borderRadius="sm"
                  bg={hasFormat ? 'accent.teal' : undefined}
                  opacity={hasFormat ? 1 : 0.5}
                  _hover={{ opacity: 1, bg: hasFormat ? 'accent.teal' : 'bg.subtle' }}
                  transition="all 0.15s"
                >
                  <Icon as={LuSettings2} boxSize={2.5} color={hasFormat ? 'white' : 'fg.muted'} />
                </Box>
              )
            })()}
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
                {columnUniqueValues[header.id] && columnUniqueValues[header.id].length <= Math.max(FACET_PICKER_MAX_UNIQUE, rowsLength * FACET_PICKER_RATIO) && (
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

        {/* Rename / format popover — rendered via Portal */}
        {activeFormatCol === header.id && onColumnFormatsChange && (
          <Portal>
            <Box
              position="fixed"
              top={0} left={0} right={0} bottom={0}
              zIndex={99}
              onClick={() => setActiveFormatCol(null)}
            />
            <Box
              position="absolute"
              zIndex={100}
              bg="bg.panel"
              border="1px solid"
              borderColor="border.muted"
              borderRadius="md"
              shadow="lg"
              ref={(el: HTMLDivElement | null) => {
                if (!el) return
                const anchor = el.closest('body')?.querySelector(`th [data-format-anchor="${header.id}"]`)
                if (!anchor) return
                const rect = (anchor as HTMLElement).getBoundingClientRect()
                el.style.top = `${rect.bottom + 4}px`
                el.style.left = `${Math.max(8, rect.left - 150)}px`
                el.style.position = 'fixed'
              }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <FormatPopover
                type={colType}
                column={header.id}
                formatConfig={columnFormats?.[header.id] ?? {}}
                onChange={(cfg) => handleFormatChange(header.id, cfg)}
                d3Formats={d3Formats}
              />
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
                            isLastColumn={displayIndex === totalHeaders - 1}
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
}
