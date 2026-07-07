'use client'

import { Box, HStack, Text, VStack } from '@chakra-ui/react'
import { SeriesColorInput } from './StyleConfigPopover'
import type { TableStyleConfig, VisualizationStyleConfig } from '@/lib/types'

interface TableStylePanelProps {
  styleConfig?: VisualizationStyleConfig
  onChange: (config: VisualizationStyleConfig) => void
}

const FONT_SIZE_OPTIONS = [11, 12, 14, 16] as const

const Pill = ({ selected, onClick, children, label }: { selected: boolean; onClick: () => void; children: React.ReactNode; label: string }) => (
  <Box
    aria-label={label}
    px={2}
    py={0.5}
    borderRadius="sm"
    cursor="pointer"
    fontSize="xs"
    fontFamily="mono"
    fontWeight={selected ? '700' : '500'}
    bg={selected ? 'accent.teal' : 'bg.surface'}
    color={selected ? 'white' : 'fg.default'}
    border="1px solid"
    borderColor={selected ? 'accent.teal' : 'border.muted'}
    _hover={{ bg: selected ? 'accent.teal' : 'bg.muted' }}
    onClick={onClick}
    transition="all 0.15s"
  >
    {children}
  </Box>
)

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
    {children}
  </Text>
)

/**
 * Human editor for `styleConfig.table` (TableStyleConfig) — header colors, row striping,
 * border color, cell font size. Rendered for the table viz (next to conditional formats)
 * and the pivot viz. Patches only the `table` group; every other styleConfig key
 * (cssOverrides, echartsOverrides, …) passes through untouched.
 */
export const TableStylePanel = ({ styleConfig, onChange }: TableStylePanelProps) => {
  const table = styleConfig?.table ?? {}

  const emitTable = (patch: Partial<TableStyleConfig>) => {
    const nextTable: Record<string, unknown> = { ...table, ...patch }
    for (const key of Object.keys(nextTable)) {
      if (nextTable[key] == null) delete nextTable[key]
    }
    const next: VisualizationStyleConfig = { ...(styleConfig ?? {}) }
    if (Object.keys(nextTable).length > 0) next.table = nextTable as TableStyleConfig
    else delete next.table
    onChange(next)
  }

  const stripeOn = table.rowStripe !== false

  return (
    <VStack align="stretch" gap={2}>
      <Box>
        <SectionLabel>Header</SectionLabel>
        <VStack align="stretch" gap={1.5}>
          <HStack justify="space-between">
            <Text fontSize="xs" fontFamily="mono" color="fg.subtle">Background</Text>
            <HStack gap={1.5}>
              <SeriesColorInput
                label="Table header background color"
                value={table.headerBg || '#f6f8fa'}
                onCommit={(hex) => emitTable({ headerBg: hex })}
              />
              <Pill label="Table header background auto" selected={table.headerBg == null} onClick={() => emitTable({ headerBg: null })}>
                auto
              </Pill>
            </HStack>
          </HStack>
          <HStack justify="space-between">
            <Text fontSize="xs" fontFamily="mono" color="fg.subtle">Text</Text>
            <HStack gap={1.5}>
              <SeriesColorInput
                label="Table header text color"
                value={table.headerTextColor || '#888888'}
                onCommit={(hex) => emitTable({ headerTextColor: hex })}
              />
              <Pill label="Table header text auto" selected={table.headerTextColor == null} onClick={() => emitTable({ headerTextColor: null })}>
                auto
              </Pill>
            </HStack>
          </HStack>
        </VStack>
      </Box>

      <Box>
        <SectionLabel>Rows</SectionLabel>
        <HStack gap={1} flexWrap="wrap">
          <Pill label="Row striping on" selected={stripeOn} onClick={() => emitTable({ rowStripe: null })}>
            Striped
          </Pill>
          <Pill label="Row striping off" selected={!stripeOn} onClick={() => emitTable({ rowStripe: false, stripeBg: null })}>
            Plain
          </Pill>
          {stripeOn && (
            <SeriesColorInput
              label="Row stripe color"
              value={table.stripeBg || '#f6f8fa'}
              onCommit={(hex) => emitTable({ stripeBg: hex })}
            />
          )}
        </HStack>
      </Box>

      <Box>
        <SectionLabel>Cells</SectionLabel>
        <HStack gap={1} flexWrap="wrap" align="center">
          {FONT_SIZE_OPTIONS.map(size => (
            <Pill key={size} label={`Table cell font size ${size}`} selected={table.cellFontSize === size} onClick={() => emitTable({ cellFontSize: size })}>
              {size}px
            </Pill>
          ))}
          <Pill label="Table cell font size auto" selected={table.cellFontSize == null} onClick={() => emitTable({ cellFontSize: null })}>
            auto
          </Pill>
          <SeriesColorInput
            label="Table border color"
            value={table.borderColor || '#d0d7de'}
            onCommit={(hex) => emitTable({ borderColor: hex })}
          />
          <Pill label="Table border color auto" selected={table.borderColor == null} onClick={() => emitTable({ borderColor: null })}>
            border auto
          </Pill>
        </HStack>
      </Box>
    </VStack>
  )
}
