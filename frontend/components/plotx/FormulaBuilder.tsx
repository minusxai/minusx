'use client'

import { useState, useCallback } from 'react'
import { Box, HStack, VStack, Text, Input, IconButton, Icon } from '@chakra-ui/react'
import { LuPlus, LuX, LuChevronDown, LuSquareFunction } from 'react-icons/lu'
import type { PivotFormula, FormulaOperator } from '@/lib/types'

const OPERATORS: { value: FormulaOperator; label: string }[] = [
  { value: '+', label: '+' },
  { value: '-', label: '\u2212' },
  { value: '*', label: '\u00d7' },
  { value: '/', label: '\u00f7' },
]

interface FormulaBuilderProps {
  axis: 'row' | 'column'
  formulas: PivotFormula[]
  availableValues: string[]
  dimensionName: string
  onChange: (formulas: PivotFormula[]) => void
}

const SimpleSelect = ({
  value,
  options,
  onChange,
  placeholder,
  minW = '80px',
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  placeholder: string
  minW?: string
}) => {
  const [open, setOpen] = useState(false)
  const selected = options.find(o => o.value === value)

  return (
    <Box position="relative">
      <HStack
        gap={0.5}
        px={2}
        py={0.5}
        bg="bg.surface"
        border="1px solid"
        borderColor="border.muted"
        borderRadius="sm"
        cursor="pointer"
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        _hover={{ borderColor: 'border.default' }}
        transition="all 0.15s"
        minW={minW}
      >
        <Text fontSize="xs" fontWeight="500" color={selected ? 'fg.default' : 'fg.subtle'} truncate>
          {selected?.label || placeholder}
        </Text>
        <Box as={LuChevronDown} fontSize="2xs" color="fg.subtle" flexShrink={0} />
      </HStack>
      {open && (
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
          zIndex={20}
          p={1}
          gap={0}
          minW="90px"
          maxH="200px"
          overflowY="auto"
        >
          {options.map(opt => (
            <Box
              key={opt.value}
              px={2}
              py={1}
              cursor="pointer"
              borderRadius="sm"
              bg={opt.value === value ? 'accent.secondary/15' : 'transparent'}
              _hover={{ bg: 'accent.secondary/10' }}
              onClick={(e) => { e.stopPropagation(); onChange(opt.value); setOpen(false) }}
              width="100%"
            >
              <Text fontSize="xs" fontWeight={opt.value === value ? '700' : '500'} color={opt.value === value ? 'accent.secondary' : 'fg.default'} truncate>
                {opt.label}
              </Text>
            </Box>
          ))}
        </VStack>
      )}
    </Box>
  )
}

export const FormulaBuilder = ({
  axis,
  formulas,
  availableValues,
  dimensionName,
  onChange,
}: FormulaBuilderProps) => {
  const valueOptions = availableValues.map(v => ({ value: v, label: v }))
  const operatorOptions = OPERATORS.map(o => ({ value: o.value, label: o.label }))

  const addFormula = useCallback(() => {
    const a = availableValues[0] || ''
    const b = availableValues[1] || ''
    const newFormula: PivotFormula = {
      name: `${a} - ${b}`,
      operandA: a,
      operandB: b,
      operator: '-',
    }
    onChange([...formulas, newFormula])
  }, [formulas, availableValues, onChange])

  const removeFormula = useCallback((index: number) => {
    onChange(formulas.filter((_, i) => i !== index))
  }, [formulas, onChange])

  const updateFormula = useCallback((index: number, update: Partial<PivotFormula>) => {
    onChange(formulas.map((f, i) => {
      if (i !== index) return f
      const updated = { ...f, ...update }
      // Auto-generate name only when operand/operator changes (not when user edits name directly)
      if (!('name' in update)) {
        const oldAutoName = `${f.operandA} ${f.operator === '-' ? '-' : f.operator === '+' ? '+' : f.operator === '*' ? '\u00d7' : '\u00f7'} ${f.operandB}`
        if (f.name === oldAutoName || f.name === `${f.operandA} - ${f.operandB}`) {
          const opLabel = updated.operator === '-' ? '-' : updated.operator === '+' ? '+' : updated.operator === '*' ? '\u00d7' : '\u00f7'
          updated.name = `${updated.operandA} ${opLabel} ${updated.operandB}`
        }
      }
      return updated
    }))
  }, [formulas, onChange])

  if (availableValues.length < 2) return null

  return (
    <VStack gap={2} align="stretch" width="100%">
      <HStack gap={1}>
        <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em">
          {axis === 'row' ? 'Row' : 'Column'} Formulas
        </Text>
        <Text fontSize="xs" color="fg.subtle">({dimensionName})</Text>
      </HStack>

      {formulas.map((formula, index) => (
        <HStack key={index} gap={1.5} flexWrap="wrap" alignItems="center">
          <Icon fontSize="md" color="accent.secondary">
            <LuSquareFunction />
          </Icon>
          <Input
            value={formula.name}
            onChange={(e) => updateFormula(index, { name: e.target.value })}
            size="xs"
            maxW="120px"
            fontWeight="600"
            fontSize="xs"
            borderColor="border.muted"
            _focus={{ borderColor: 'accent.secondary' }}
          />
          <Text fontSize="xs" color="fg.subtle" fontWeight="600">=</Text>
          <SimpleSelect
            value={formula.operandA}
            options={valueOptions}
            onChange={(v) => updateFormula(index, { operandA: v })}
            placeholder="Select..."
          />
          <SimpleSelect
            value={formula.operator}
            options={operatorOptions}
            onChange={(v) => updateFormula(index, { operator: v as FormulaOperator })}
            placeholder="Op"
            minW="40px"
          />
          <SimpleSelect
            value={formula.operandB}
            options={valueOptions}
            onChange={(v) => updateFormula(index, { operandB: v })}
            placeholder="Select..."
          />
          <IconButton
            aria-label="Remove formula"
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            _hover={{ color: 'fg.error', bg: 'bg.error/10' }}
            onClick={() => removeFormula(index)}
          >
            <LuX />
          </IconButton>
        </HStack>
      ))}

      <Box>
        <HStack
          gap={1}
          px={2}
          py={1}
          cursor="pointer"
          borderRadius="sm"
          _hover={{ bg: 'accent.secondary/10' }}
          onClick={addFormula}
          width="fit-content"
        >
          <Box as={LuPlus} fontSize="xs" color="accent.secondary" />
          <Text fontSize="xs" fontWeight="600" color="accent.secondary">
            Add Formula
          </Text>
        </HStack>
      </Box>
    </VStack>
  )
}
