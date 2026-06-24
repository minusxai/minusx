'use client'

import { Box, Button, HStack, Icon, Menu, Portal, Text, VStack } from '@chakra-ui/react'
import { LuChevronDown, LuPlus, LuTrash2 } from 'react-icons/lu'
import type { ConditionalFormatRule } from '@/lib/types'

interface TableConditionalFormatPanelProps {
  columns: string[]
  rules?: ConditionalFormatRule[]
  onChange: (rules: ConditionalFormatRule[]) => void
}

type Operator = ConditionalFormatRule['operator']
type Target = ConditionalFormatRule['target']

const OPERATORS: { value: Operator; label: string }[] = [
  { value: '=', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' },
  { value: 'contains', label: 'contains' },
]

const TARGETS: { value: Target; label: string }[] = [
  { value: 'cell', label: 'Cell' },
  { value: 'row', label: 'Row' },
  { value: 'column', label: 'Column' },
]

const DEFAULT_COLOR = '#fde68a'

const inputStyle: React.CSSProperties = {
  fontSize: '12px',
  fontFamily: 'var(--fonts-mono, monospace)',
  padding: '4px 8px',
  width: '100%',
  border: '1px solid var(--chakra-colors-border-muted)',
  borderRadius: '4px',
  background: 'var(--chakra-colors-bg-canvas)',
  color: 'var(--chakra-colors-fg-default)',
  outline: 'none',
  height: '28px',
}

const addButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '3px 8px',
  borderRadius: '4px',
  border: '1px solid var(--chakra-colors-border-muted)',
  background: 'transparent',
  color: 'var(--chakra-colors-fg-subtle)',
  cursor: 'pointer',
  transition: 'all 0.15s',
}

const newId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `cf-${Date.now()}-${Math.round(Math.random() * 1e9)}`

/** Compact Chakra Menu-based select, styled to match the rest of the viz panel. */
function MenuSelect<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  const current = options.find(o => o.value === value)
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          aria-label={ariaLabel}
          size="2xs"
          variant="outline"
          w="100%"
          justifyContent="space-between"
          fontFamily="mono"
          fontSize="xs"
          bg="bg.canvas"
          borderColor="border.muted"
          _hover={{ bg: 'bg.subtle', borderColor: 'border.emphasized' }}
        >
          <Text truncate>{current?.label ?? value}</Text>
          <Icon as={LuChevronDown} boxSize={3} color="fg.muted" />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="120px" maxH="280px" overflowY="auto" bg="bg.surface" borderColor="border.default" shadow="lg" p={1}>
            {options.map(o => (
              <Menu.Item
                key={o.value}
                value={o.value}
                cursor="pointer"
                borderRadius="sm"
                px={2.5}
                py={1.5}
                _hover={{ bg: 'bg.muted' }}
                onClick={() => onChange(o.value)}
              >
                <Text fontSize="xs" fontFamily="mono" fontWeight={o.value === value ? '700' : '500'} color={o.value === value ? 'accent.teal' : 'fg.default'}>
                  {o.label}
                </Text>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}

export const TableConditionalFormatPanel = ({ columns, rules, onChange }: TableConditionalFormatPanelProps) => {
  const items = rules ?? []
  const columnOptions = columns.map(c => ({ value: c, label: c }))

  const updateRule = (index: number, patch: Partial<ConditionalFormatRule>) => {
    onChange(items.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)))
  }

  const addRule = () => {
    onChange([
      ...items,
      { id: newId(), column: columns[0] ?? '', operator: '=', value: '', target: 'cell', bgColor: DEFAULT_COLOR },
    ])
  }

  const removeRule = (index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }

  return (
    <VStack align="stretch" gap={2.5} p={3} mt={2} bg="bg.surface" borderRadius="md" border="1px solid" borderColor="border.muted">
      <HStack justify="space-between" align="center">
        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">
          Conditional Formatting
        </Text>
        <button type="button" onClick={addRule} aria-label="Add conditional formatting rule" style={addButtonStyle}>
          <LuPlus size={10} />
          <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em">Add</Text>
        </button>
      </HStack>

      {items.length === 0 && (
        <Text fontSize="xs" fontFamily="mono" color="fg.muted">
          No rules yet. Color a cell, row, or column when a condition on a column holds.
        </Text>
      )}

      {items.length > 0 && (
        <VStack align="stretch" gap={2} maxH="320px" overflowY="auto">
          {items.map((rule, index) => (
            <VStack key={rule.id} align="stretch" gap={1.5} p={2} border="1px solid" borderColor="border.muted" borderRadius="md">
              {/* Condition: column · operator · value */}
              <HStack gap={1.5} minW={0}>
                <Box flex={2} minW={0}>
                  <MenuSelect ariaLabel="Condition column" value={rule.column} options={columnOptions} onChange={(column) => updateRule(index, { column })} />
                </Box>
                <Box flex={1} minW={0}>
                  <MenuSelect ariaLabel="Condition operator" value={rule.operator} options={OPERATORS} onChange={(operator) => updateRule(index, { operator })} />
                </Box>
                <Box flex={2} minW={0}>
                  <input
                    type="text"
                    aria-label="Condition value"
                    value={rule.value}
                    onChange={(e) => updateRule(index, { value: e.target.value })}
                    placeholder="value"
                    style={inputStyle}
                  />
                </Box>
              </HStack>
              {/* Paint: target · color · delete */}
              <HStack gap={1.5} minW={0} align="center">
                <Box flex={1} minW={0}>
                  <MenuSelect ariaLabel="Paint target" value={rule.target} options={TARGETS} onChange={(target) => updateRule(index, { target })} />
                </Box>
                <input
                  type="color"
                  aria-label="Background color"
                  value={rule.bgColor}
                  onChange={(e) => updateRule(index, { bgColor: e.target.value })}
                  style={{ width: '34px', height: '28px', padding: 0, border: '1px solid var(--chakra-colors-border-muted)', borderRadius: '4px', background: 'transparent', cursor: 'pointer' }}
                />
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  aria-label="Remove conditional formatting rule"
                  style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--chakra-colors-fg-subtle)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
                >
                  <LuTrash2 size={14} />
                </button>
              </HStack>
            </VStack>
          ))}
        </VStack>
      )}

      {items.length > 1 && (
        <Text fontSize="2xs" fontFamily="mono" color="fg.muted">
          When rules overlap, later rules override earlier ones.
        </Text>
      )}
    </VStack>
  )
}
