'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Box, HStack, VStack, Text, Input, IconButton, Icon } from '@chakra-ui/react'
import { LuPlus, LuX, LuChevronDown, LuSquareFunction } from 'react-icons/lu'
import type { PivotFormula, FormulaOperator } from '@/lib/types'

const OPERATORS: { value: FormulaOperator; label: string }[] = [
  { value: '+', label: '+' },
  { value: '-', label: '\u2212' },
  { value: '*', label: '\u00d7' },
  { value: '/', label: '\u00f7' },
]

export interface DimensionInfo {
  name: string
  level: number
  /** Available values at this level. For level > 0, these are ALL values at that level (unfiltered). */
  availableValues: string[]
  /** For level > 0: unique parent group values at level-1 */
  parentValues?: string[]
}

interface FormulaBuilderProps {
  axis: 'row' | 'column'
  formulas: PivotFormula[]
  /** Legacy: single-level available values (used when dimensions is not provided) */
  availableValues: string[]
  dimensionName: string
  onChange: (formulas: PivotFormula[]) => void
  /** Multi-level dimension info. When provided, enables level selection. */
  dimensions?: DimensionInfo[]
  /** Callback to get available values at a level filtered by parent values */
  getValuesAtLevel?: (level: number, parentValues?: string[]) => string[]
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
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <Box position="relative" ref={ref}>
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
  dimensions,
  getValuesAtLevel,
}: FormulaBuilderProps) => {
  const hasMultipleDimensions = dimensions && dimensions.length >= 2
  const operatorOptions = OPERATORS.map(o => ({ value: o.value, label: o.label }))

  const getOperandValues = useCallback((formula: PivotFormula): string[] => {
    const level = formula.dimensionLevel ?? 0
    if (level > 0 && getValuesAtLevel && formula.parentValues?.length) {
      return getValuesAtLevel(level, formula.parentValues)
    }
    if (level === 0) return availableValues
    // Fallback: use dimension info
    const dim = dimensions?.find(d => d.level === level)
    return dim?.availableValues ?? availableValues
  }, [availableValues, dimensions, getValuesAtLevel])

  const getParentOptions = useCallback((level: number): string[] => {
    if (level === 0 || !dimensions) return []
    // Parent values are the unique values at level - 1
    const parentDim = dimensions.find(d => d.level === level - 1)
    return parentDim?.availableValues ?? []
  }, [dimensions])

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

  const handleDimensionLevelChange = useCallback((index: number, newLevel: number) => {
    const formula = formulas[index]
    const parentOpts = getParentOptions(newLevel)
    const parentVals = newLevel > 0 && parentOpts.length > 0 ? [parentOpts[0]] : undefined

    // Get new operand values at the new level
    let newOperandValues: string[]
    if (newLevel > 0 && getValuesAtLevel && parentVals?.length) {
      newOperandValues = getValuesAtLevel(newLevel, parentVals)
    } else {
      const dim = dimensions?.find(d => d.level === newLevel)
      newOperandValues = dim?.availableValues ?? availableValues
    }

    const a = newOperandValues[0] || ''
    const b = newOperandValues[1] || ''
    const opLabel = formula.operator === '-' ? '-' : formula.operator === '+' ? '+' : formula.operator === '*' ? '\u00d7' : '\u00f7'

    onChange(formulas.map((f, i) => {
      if (i !== index) return f
      return {
        ...f,
        dimensionLevel: newLevel === 0 ? undefined : newLevel,
        parentValues: parentVals ?? undefined,
        operandA: a,
        operandB: b,
        name: `${a} ${opLabel} ${b}`,
      }
    }))
  }, [formulas, onChange, getParentOptions, getValuesAtLevel, dimensions, availableValues])

  const handleParentChange = useCallback((index: number, parentValue: string) => {
    const formula = formulas[index]
    const level = formula.dimensionLevel ?? 0
    const newParentVals = [parentValue]

    // Get new operand values filtered by new parent
    let newOperandValues: string[]
    if (getValuesAtLevel) {
      newOperandValues = getValuesAtLevel(level, newParentVals)
    } else {
      const dim = dimensions?.find(d => d.level === level)
      newOperandValues = dim?.availableValues ?? availableValues
    }

    const a = newOperandValues[0] || ''
    const b = newOperandValues[1] || ''
    const opLabel = formula.operator === '-' ? '-' : formula.operator === '+' ? '+' : formula.operator === '*' ? '\u00d7' : '\u00f7'

    onChange(formulas.map((f, i) => {
      if (i !== index) return f
      return {
        ...f,
        parentValues: newParentVals,
        operandA: a,
        operandB: b,
        name: `${a} ${opLabel} ${b}`,
      }
    }))
  }, [formulas, onChange, getValuesAtLevel, dimensions, availableValues])

  if (availableValues.length < 2 && !hasMultipleDimensions) return null

  const dimensionLevelOptions = dimensions?.map(d => ({
    value: String(d.level),
    label: d.name,
  })) ?? []

  return (
    <VStack gap={2} align="stretch" width="100%">
      <HStack gap={1}>
        <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em">
          {axis === 'row' ? 'Row' : 'Column'} Formulas
        </Text>
        <Text fontSize="xs" color="fg.subtle">({dimensionName})</Text>
      </HStack>

      {formulas.map((formula, index) => {
        const level = formula.dimensionLevel ?? 0
        const operandValues = getOperandValues(formula)
        // Include names of prior formulas as operand options
        const priorFormulaNames = formulas.slice(0, index).map(f => f.name).filter(n => n.length > 0)
        const valueOptions = [
          ...operandValues.map(v => ({ value: v, label: v })),
          ...priorFormulaNames.map(n => ({ value: n, label: `\u0192 ${n}` })),
        ]
        const parentOpts = getParentOptions(level)
        const parentOptions = parentOpts.map(v => ({ value: v, label: v }))

        return (
          <VStack key={index} gap={1} align="stretch">
            {/* Dimension level + parent selectors (only when multiple dimensions) */}
            {hasMultipleDimensions && (
              <HStack gap={1.5} flexWrap="wrap" alignItems="center">
                <Text fontSize="2xs" color="fg.subtle" fontWeight="600">Level:</Text>
                <SimpleSelect
                  value={String(level)}
                  options={dimensionLevelOptions}
                  onChange={(v) => handleDimensionLevelChange(index, Number(v))}
                  placeholder="Level"
                  minW="70px"
                />
                {level > 0 && parentOptions.length > 0 && (
                  <>
                    <Text fontSize="2xs" color="fg.subtle" fontWeight="600">in:</Text>
                    <SimpleSelect
                      value={formula.parentValues?.[0] ?? ''}
                      options={parentOptions}
                      onChange={(v) => handleParentChange(index, v)}
                      placeholder="Group"
                      minW="80px"
                    />
                  </>
                )}
              </HStack>
            )}
            {/* Formula row: name = operandA op operandB */}
            <HStack gap={1.5} flexWrap="wrap" alignItems="center">
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
          </VStack>
        )
      })}

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
