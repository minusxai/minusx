import { HStack, Button, Text, Box, Menu, Portal, Icon } from '@chakra-ui/react'
import { LuChevronDown, LuColumns3, LuCheck, LuDownload, LuX, LuChartColumn } from 'react-icons/lu'
import type { ColumnFiltersState, VisibilityState } from '@tanstack/react-table'
import { getTypeIcon, getTypeColor, type ColumnType } from './table-v2-utils'

interface TableBottomBarProps {
  /** Columns for the visibility menu. Omit (with the setters) for grids without per-column ops (pivot). */
  colNames?: string[]
  columnTypes?: ColumnType[]
  columnVisibility?: VisibilityState
  setColumnVisibility?: React.Dispatch<React.SetStateAction<VisibilityState>>
  columnFilters?: ColumnFiltersState
  setColumnFilters?: React.Dispatch<React.SetStateAction<ColumnFiltersState>>
  setActiveFilterCol?: React.Dispatch<React.SetStateAction<string | null>>
  showStats?: boolean
  setShowStats?: React.Dispatch<React.SetStateAction<boolean>>
  filteredRowCount: number
  totalRowCount: number
  downloadCsv: () => void
}

/** Shared grid bottom bar (flat table AND pivot): row count + CSV always; stats
 * toggle, columns visibility menu, and clear-filters render only when their
 * state setters are provided (the flat table). */
export const TableBottomBar = ({
  colNames = [],
  columnTypes = [],
  columnVisibility = {},
  setColumnVisibility,
  columnFilters = [],
  setColumnFilters,
  setActiveFilterCol,
  showStats = false,
  setShowStats,
  filteredRowCount,
  totalRowCount,
  downloadCsv,
}: TableBottomBarProps) => {
  const visibleColumnCount = colNames.filter(c => columnVisibility[c] !== false).length

  return (
    // mx-toolbar: stable class contract — surfaces/css overrides hide chrome with
    // `.mx-toolbar { display: none }` instead of a prop (no toggles by design).
    <HStack className="mx-toolbar" justify="space-between" align="center" mt={2} px={2} flexShrink={0}>
      {/* Left: Stats, Columns, Filters */}
      <HStack gap={3}>
        {setShowStats && (
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
        )}
        {setColumnVisibility && colNames.length > 0 && (
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
        )}
        {setColumnFilters && columnFilters.length > 0 && (
          <Button
            size="xs"
            variant="ghost"
            color="accent.teal"
            onClick={() => {
              setColumnFilters([])
              setActiveFilterCol?.(null)
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
          {filteredRowCount !== totalRowCount
            ? `${filteredRowCount} filtered of ${totalRowCount} rows`
            : `${totalRowCount} rows`
          }
        </Text>
        <Button
          size="2xs"
          variant="outline"
          bg="bg.muted"
          borderColor="border.default"
          _hover={{ bg: 'bg.subtle', borderColor: 'border.emphasized' }}
          onClick={downloadCsv}
          aria-label="Download CSV"
          data-dev-hide-in-capture="true"
        >
          <Icon as={LuDownload} boxSize={3} />
          CSV
        </Button>
      </HStack>
    </HStack>
  )
}
