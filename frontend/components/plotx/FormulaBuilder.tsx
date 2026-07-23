'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { LuPlus, LuX, LuChevronDown, LuSquareFunction } from 'react-icons/lu'
import type { PivotFormula, FormulaOperator } from '@/lib/types'

const OPERATORS: { value: FormulaOperator; label: string }[] = [
  { value: '+', label: '+' },
  { value: '-', label: '−' },
  { value: '*', label: '×' },
  { value: '/', label: '÷' },
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
    <div className="relative" ref={ref}>
      <div
        className="flex cursor-pointer items-center gap-0.5 rounded-sm border border-border bg-card px-2 py-0.5 transition-all duration-150 hover:border-muted-foreground/50"
        style={{ minWidth: minW }}
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
      >
        <span className={`truncate text-xs font-medium ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
          {selected?.label || placeholder}
        </span>
        <LuChevronDown className="shrink-0 text-[10px] text-muted-foreground" />
      </div>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 flex max-h-[200px] min-w-[90px] flex-col items-center gap-0 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {options.map(opt => (
            <div
              key={opt.value}
              className={`w-full cursor-pointer rounded-sm px-2 py-1 hover:bg-[#9b59b6]/10 ${
                opt.value === value ? 'bg-[#9b59b6]/15' : 'bg-transparent'
              }`}
              onClick={(e) => { e.stopPropagation(); onChange(opt.value); setOpen(false) }}
            >
              <span className={`block truncate text-xs ${opt.value === value ? 'font-bold text-[#9b59b6]' : 'font-medium text-foreground'}`}>
                {opt.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
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
        const oldAutoName = `${f.operandA} ${f.operator === '-' ? '-' : f.operator === '+' ? '+' : f.operator === '*' ? '×' : '÷'} ${f.operandB}`
        if (f.name === oldAutoName || f.name === `${f.operandA} - ${f.operandB}`) {
          const opLabel = updated.operator === '-' ? '-' : updated.operator === '+' ? '+' : updated.operator === '*' ? '×' : '÷'
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
    const opLabel = formula.operator === '-' ? '-' : formula.operator === '+' ? '+' : formula.operator === '*' ? '×' : '÷'

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
    const opLabel = formula.operator === '-' ? '-' : formula.operator === '+' ? '+' : formula.operator === '*' ? '×' : '÷'

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
    <div className="flex w-full flex-col items-stretch gap-2">
      <div className="flex items-center gap-1">
        <span className="text-xs font-bold uppercase tracking-wider">
          {axis === 'row' ? 'Row' : 'Column'} Formulas
        </span>
        <span className="text-xs text-muted-foreground">({dimensionName})</span>
      </div>

      {formulas.map((formula, index) => {
        const level = formula.dimensionLevel ?? 0
        const operandValues = getOperandValues(formula)
        // Include names of prior formulas as operand options
        const priorFormulaNames = formulas.slice(0, index).map(f => f.name).filter(n => n.length > 0)
        const valueOptions = [
          ...operandValues.map(v => ({ value: v, label: v })),
          ...priorFormulaNames.map(n => ({ value: n, label: `ƒ ${n}` })),
        ]
        const parentOpts = getParentOptions(level)
        const parentOptions = parentOpts.map(v => ({ value: v, label: v }))

        return (
          <div key={index} className="flex flex-col items-stretch gap-1">
            {/* Dimension level + parent selectors (only when multiple dimensions) */}
            {hasMultipleDimensions && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground">Level:</span>
                <SimpleSelect
                  value={String(level)}
                  options={dimensionLevelOptions}
                  onChange={(v) => handleDimensionLevelChange(index, Number(v))}
                  placeholder="Level"
                  minW="70px"
                />
                {level > 0 && parentOptions.length > 0 && (
                  <>
                    <span className="text-[10px] font-semibold text-muted-foreground">in:</span>
                    <SimpleSelect
                      value={formula.parentValues?.[0] ?? ''}
                      options={parentOptions}
                      onChange={(v) => handleParentChange(index, v)}
                      placeholder="Group"
                      minW="80px"
                    />
                  </>
                )}
              </div>
            )}
            {/* Formula row: name = operandA op operandB */}
            <div className="flex flex-wrap items-center gap-1.5">
              <LuSquareFunction className="text-base text-[#9b59b6]" />
              <input
                type="text"
                value={formula.name}
                onChange={(e) => updateFormula(index, { name: e.target.value })}
                className="h-6 w-full max-w-[120px] rounded-md border border-border bg-transparent px-2 text-xs font-semibold outline-none focus:border-[#9b59b6]"
              />
              <span className="text-xs font-semibold text-muted-foreground">=</span>
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
              <button
                type="button"
                aria-label="Remove formula"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#c0392b]/10 hover:text-[#c0392b]"
                onClick={() => removeFormula(index)}
              >
                <LuX />
              </button>
            </div>
          </div>
        )
      })}

      <div>
        <div
          className="flex w-fit cursor-pointer items-center gap-1 rounded-sm px-2 py-1 hover:bg-[#9b59b6]/10"
          onClick={addFormula}
        >
          <LuPlus className="text-xs text-[#9b59b6]" />
          <span className="text-xs font-semibold text-[#9b59b6]">
            Add Formula
          </span>
        </div>
      </div>
    </div>
  )
}
