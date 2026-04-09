'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Box, HStack, VStack, Text } from '@chakra-ui/react'
import { Checkbox } from '@/components/ui/checkbox'
import { LuChevronDown, LuChevronRight, LuLayoutGrid, LuSettings2 } from 'react-icons/lu'
import { resolveColumnType } from './AxisComponents'
import { AxisBuilder, type AxisZone } from './AxisBuilder'
import { FormulaBuilder, type DimensionInfo } from './FormulaBuilder'
import type { PivotConfig, PivotValueConfig, PivotFormula, AggregationFunction, ColumnFormatConfig } from '@/lib/types'

const AGG_FUNCTIONS: AggregationFunction[] = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']

interface PivotAxisBuilderProps {
  columns: string[]
  types: string[]
  pivotConfig?: PivotConfig
  onPivotConfigChange: (config: PivotConfig) => void
  useCompactView?: boolean
  availableRowValues?: string[]
  availableColumnValues?: string[]
  columnFormats?: Record<string, ColumnFormatConfig>
  onColumnFormatChange?: (column: string, config: ColumnFormatConfig) => void
  rowDimensions?: DimensionInfo[]
  getRowValuesAtLevel?: (level: number, parentValues?: string[]) => string[]
}

export const PivotAxisBuilder = ({
  columns,
  types,
  pivotConfig,
  onPivotConfigChange,
  availableRowValues,
  availableColumnValues,
  columnFormats,
  onColumnFormatChange,
  rowDimensions,
  getRowValuesAtLevel,
}: PivotAxisBuilderProps) => {
  // Classify columns for auto-init
  const groupedColumns = useMemo(() => {
    const groups: { dates: string[]; numbers: string[]; categories: string[] } = {
      dates: [], numbers: [], categories: [],
    }
    columns.forEach((col) => {
      const type = resolveColumnType(col, columns, types)
      if (type === 'date') groups.dates.push(col)
      else if (type === 'number') groups.numbers.push(col)
      else groups.categories.push(col)
    })
    return groups
  }, [columns, types])

  // Auto-initialize when no pivotConfig
  const config: PivotConfig = useMemo(() => {
    if (pivotConfig) return pivotConfig

    const rowCols: string[] = []
    const colCols: string[] = []
    const vals: PivotValueConfig[] = []

    if (groupedColumns.dates.length > 0) {
      rowCols.push(groupedColumns.dates[0])
    } else if (groupedColumns.categories.length > 0) {
      rowCols.push(groupedColumns.categories[0])
    }

    const remainingCats = groupedColumns.categories.filter(c => !rowCols.includes(c))
    const remainingDates = groupedColumns.dates.filter(c => !rowCols.includes(c))
    if (remainingCats.length > 0) {
      colCols.push(remainingCats[0])
    } else if (remainingDates.length > 0) {
      colCols.push(remainingDates[0])
    }

    if (groupedColumns.numbers.length > 0) {
      vals.push({ column: groupedColumns.numbers[0], aggFunction: 'SUM' })
    }

    return { rows: rowCols, columns: colCols, values: vals, showRowTotals: false, showColumnTotals: false, showHeatmap: true }
  }, [pivotConfig, groupedColumns])

  // Fire initial config if auto-initialized
  useEffect(() => {
    if (!pivotConfig && config.values.length > 0) {
      onPivotConfigChange(config)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Drop handlers (receive column from AxisBuilder)
  const handleDropRows = useCallback((col: string) => {
    if (config.rows.includes(col)) return
    const newCols = config.columns.filter(c => c !== col)
    const newVals = config.values.filter(v => v.column !== col)
    const newRows = [...config.rows, col]
    const clearRowFormulas = config.rows.length === 0
    onPivotConfigChange({ ...config, rows: newRows, columns: newCols, values: newVals, ...(clearRowFormulas ? { rowFormulas: [] } : {}) })
  }, [config, onPivotConfigChange])

  const handleDropColumns = useCallback((col: string) => {
    if (config.columns.includes(col)) return
    const newRows = config.rows.filter(c => c !== col)
    const newVals = config.values.filter(v => v.column !== col)
    const newColumns = [...config.columns, col]
    const clearColFormulas = config.columns.length === 0
    onPivotConfigChange({ ...config, rows: newRows, columns: newColumns, values: newVals, ...(clearColFormulas ? { columnFormulas: [] } : {}) })
  }, [config, onPivotConfigChange])

  const handleDropValues = useCallback((col: string) => {
    if (config.values.some(v => v.column === col)) return
    const newRows = config.rows.filter(c => c !== col)
    const newCols = config.columns.filter(c => c !== col)
    onPivotConfigChange({ ...config, rows: newRows, columns: newCols, values: [...config.values, { column: col, aggFunction: 'SUM' }] })
  }, [config, onPivotConfigChange])

  // Remove handlers
  const removeFromRows = useCallback((col: string) => {
    const newRows = config.rows.filter(c => c !== col)
    const clearRowFormulas = config.rows[0] === col
    onPivotConfigChange({ ...config, rows: newRows, ...(clearRowFormulas ? { rowFormulas: [] } : {}) })
  }, [config, onPivotConfigChange])

  const removeFromColumns = useCallback((col: string) => {
    const newCols = config.columns.filter(c => c !== col)
    const clearColFormulas = config.columns[0] === col
    onPivotConfigChange({ ...config, columns: newCols, ...(clearColFormulas ? { columnFormulas: [] } : {}) })
  }, [config, onPivotConfigChange])

  const removeFromValues = useCallback((col: string) => {
    onPivotConfigChange({ ...config, values: config.values.filter(v => v.column !== col) })
  }, [config, onPivotConfigChange])

  // Change aggregation function
  const changeAggFunction = useCallback((col: string, fn: AggregationFunction) => {
    onPivotConfigChange({
      ...config,
      values: config.values.map(v => v.column === col ? { ...v, aggFunction: fn } : v),
    })
  }, [config, onPivotConfigChange])

  // Aggregation selector component for value zone chips
  const AggSelector = ({ column, aggFunction }: { column: string; aggFunction: AggregationFunction }) => {
    const [showMenu, setShowMenu] = useState(false)

    return (
      <Box position="relative">
        <HStack
          gap={0.5}
          px={1.5}
          py={0.5}
          bg="accent.teal/15"
          borderRadius="sm"
          cursor="pointer"
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
          _hover={{ bg: 'accent.teal/25' }}
          transition="all 0.15s"
        >
          <Text fontSize="2xs" fontWeight="700" color="accent.teal">
            {aggFunction}
          </Text>
          <Box as={LuChevronDown} fontSize="2xs" color="accent.teal" />
        </HStack>
        {showMenu && (
          <VStack
            position="absolute"
            top="100%"
            left={0}
            mt={1}
            bg="bg.panel"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="md"
            boxShadow="md"
            zIndex={10}
            p={1}
            gap={0}
            minW="70px"
          >
            {AGG_FUNCTIONS.map(fn => (
              <Box
                key={fn}
                px={2}
                py={1}
                cursor="pointer"
                borderRadius="sm"
                bg={fn === aggFunction ? 'accent.teal/15' : 'transparent'}
                _hover={{ bg: 'accent.teal/10' }}
                onClick={(e) => { e.stopPropagation(); changeAggFunction(column, fn); setShowMenu(false) }}
              >
                <Text fontSize="xs" fontWeight={fn === aggFunction ? '700' : '500'} color={fn === aggFunction ? 'accent.teal' : 'fg.default'}>
                  {fn}
                </Text>
              </Box>
            ))}
          </VStack>
        )}
      </Box>
    )
  }

  // Build zones config
  const zones: AxisZone[] = useMemo(() => [
    {
      label: 'Rows',
      items: config.rows.map(col => ({ column: col })),
      emptyText: 'Drop dimensions here',
      onDrop: handleDropRows,
      onRemove: removeFromRows,
    },
    {
      label: 'Columns',
      items: config.columns.map(col => ({ column: col })),
      emptyText: 'Drop dimensions here',
      onDrop: handleDropColumns,
      onRemove: removeFromColumns,
    },
    {
      label: 'Values',
      items: config.values.map(v => ({
        column: v.column,
        extra: <AggSelector column={v.column} aggFunction={v.aggFunction ?? 'SUM'} />,
      })),
      emptyText: 'Drop measures here',
      onDrop: handleDropValues,
      onRemove: removeFromValues,
    },
  ], [config, handleDropRows, handleDropColumns, handleDropValues, removeFromRows, removeFromColumns, removeFromValues])

  const showRowFormulas = config.rows.length > 0 && availableRowValues && availableRowValues.length >= 2
  const showColFormulas = config.columns.length > 0 && availableColumnValues && availableColumnValues.length >= 2

  const [activeTab, setActiveTab] = useState<'fields' | 'settings'>('fields')
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({
    options: false,
    formulas: false,
  })

  const togglePanel = (key: string) => {
    setCollapsedPanels(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const renderSettingsCard = (title: string, panelKey: string, children: React.ReactNode) => {
    const collapsed = collapsedPanels[panelKey]
    return (
      <VStack
        align="stretch"
        gap={collapsed ? 0 : 2.5}
        p={3}
        bg="bg.surface"
        borderRadius="md"
        border="2px dashed"
        borderColor="border.muted"
        minW={0}
      >
        <HStack justify="space-between" align="center">
          <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">
            {title}
          </Text>
          <button
            onClick={() => togglePanel(panelKey)}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            style={{
              color: 'var(--chakra-colors-fg-subtle)',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {collapsed ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
          </button>
        </HStack>
        {!collapsed && children}
      </VStack>
    )
  }

  return (
    <VStack align="stretch" gap={0}>
      {/* Tab bar */}
      <HStack gap={2} justify="flex-start" px={3} pt={3} pb={1} bg="bg.canvas">
        {([{ key: 'fields', icon: LuLayoutGrid, label: 'Fields' }, { key: 'settings', icon: LuSettings2, label: 'Settings' }] as const).map(({ key, icon: Icon, label }) => (
          <HStack
            key={key}
            as="button"
            gap={1}
            px={2}
            py={1}
            cursor="pointer"
            bg="transparent"
            color={activeTab === key ? 'accent.teal' : 'fg.subtle'}
            borderBottom="2px solid"
            borderColor={activeTab === key ? 'accent.teal' : 'transparent'}
            _hover={{ color: 'accent.teal' }}
            transition="all 0.15s"
            onClick={() => setActiveTab(key)}
            borderRadius={0}
          >
            <Box as={Icon} fontSize="xs" />
            <Text fontSize="2xs" fontFamily="mono" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em">
              {label}
            </Text>
          </HStack>
        ))}
      </HStack>

      {/* Fields tab — AxisBuilder renders its own styled container */}
      {activeTab === 'fields' && (
        <AxisBuilder columns={columns} types={types} zones={zones} columnFormats={columnFormats} onColumnFormatChange={onColumnFormatChange} />
      )}

      {/* Settings tab */}
      {activeTab === 'settings' && (
        <Box p={3} bg="bg.canvas" display="flex" flexDirection="column" gap={3}>
          {renderSettingsCard('Options', 'options',
            <HStack gap={4} flexWrap="wrap">
              {config.columns.length >= 2 && (
                <Checkbox
                  checked={config.showRowTotals !== false}
                  onCheckedChange={(e) => onPivotConfigChange({ ...config, showRowTotals: e.checked })}
                  size="sm"
                >
                  <Text fontSize="xs" color="fg.muted">Row Totals</Text>
                </Checkbox>
              )}
              {config.rows.length >= 2 && (
                <Checkbox
                  checked={config.showColumnTotals !== false}
                  onCheckedChange={(e) => onPivotConfigChange({ ...config, showColumnTotals: e.checked })}
                  size="sm"
                >
                  <Text fontSize="xs" color="fg.muted">Column Totals</Text>
                </Checkbox>
              )}
              <Checkbox
                checked={config.showHeatmap !== false}
                onCheckedChange={(e) => onPivotConfigChange({ ...config, showHeatmap: e.checked })}
                size="sm"
              >
                <Text fontSize="xs" color="fg.muted">Heatmap</Text>
              </Checkbox>
              <Checkbox
                checked={config.compact === true}
                onCheckedChange={(e) => onPivotConfigChange({ ...config, compact: e.checked })}
                size="sm"
              >
                <Text fontSize="xs" color="fg.muted">Compact</Text>
              </Checkbox>
              {config.showHeatmap !== false && (
                <HStack gap={1} ml={2}>
                  <Text fontSize="xs" color="fg.muted">Scale:</Text>
                  {([
                    { key: 'red-yellow-green', label: 'RYG', colors: ['#c83c3c', '#d2b43c', '#2da08c'] },
                    { key: 'green', label: 'Green', colors: ['#ebedf0', '#40c463', '#216e39'] },
                    { key: 'blue', label: 'Blue', colors: ['#eef3ff', '#5a9bd5', '#2a6cb8'] },
                  ] as const).map(({ key, colors }) => (
                    <Box
                      key={key}
                      w="56px"
                      h="16px"
                      borderRadius="sm"
                      cursor="pointer"
                      border="2px solid"
                      borderColor={(config.heatmapScale ?? 'red-yellow-green') === key ? 'accent.teal' : 'transparent'}
                      _hover={{ borderColor: 'accent.teal/50' }}
                      transition="all 0.15s"
                      onClick={() => onPivotConfigChange({ ...config, heatmapScale: key })}
                      style={{
                        background: `linear-gradient(to right, ${colors.join(', ')})`,
                      }}
                    />
                  ))}
                </HStack>
              )}
            </HStack>
          )}
          {(showRowFormulas || showColFormulas) && renderSettingsCard('Formulas', 'formulas',
            <HStack gap={4} align="stretch">
              <Box flex={1} minW={0}>
                {showRowFormulas ? (
                  <FormulaBuilder
                    axis="row"
                    formulas={config.rowFormulas || []}
                    availableValues={availableRowValues!}
                    dimensionName={config.rows[0]}
                    onChange={(formulas: PivotFormula[]) => onPivotConfigChange({ ...config, rowFormulas: formulas })}
                    dimensions={rowDimensions}
                    getValuesAtLevel={getRowValuesAtLevel}
                  />
                ) : (
                  <VStack align="start" gap={0}>
                    <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em" color="fg.subtle">
                      Row Formulas
                    </Text>
                    <Text fontSize="xs" color="fg.subtle" fontStyle="italic">Add row dimensions first</Text>
                  </VStack>
                )}
              </Box>
              <Box width="1px" bg="border.muted" alignSelf="stretch" />
              <Box flex={1} minW={0}>
                {showColFormulas ? (
                  <FormulaBuilder
                    axis="column"
                    formulas={config.columnFormulas || []}
                    availableValues={availableColumnValues!}
                    dimensionName={config.columns[0]}
                    onChange={(formulas: PivotFormula[]) => onPivotConfigChange({ ...config, columnFormulas: formulas })}
                  />
                ) : (
                  <VStack align="start" gap={0}>
                    <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em" color="fg.subtle">
                      Column Formulas
                    </Text>
                    <Text fontSize="xs" color="fg.subtle" fontStyle="italic">Add column dimensions first</Text>
                  </VStack>
                )}
              </Box>
            </HStack>
          )}
        </Box>
      )}
    </VStack>
  )
}
