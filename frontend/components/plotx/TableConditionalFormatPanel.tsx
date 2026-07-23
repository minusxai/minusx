'use client'

import { LuChevronDown, LuPlus, LuTrash2 } from 'react-icons/lu'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/kit/dropdown-menu'
import type { ColorScaleFormatRule, ConditionFormatRule, ConditionalFormatRule } from '@/lib/types'
import { isColorScaleRule } from '@/lib/chart/conditional-format-utils'
import type { ColorScaleName } from '@/lib/chart/color-scale'

interface TableConditionalFormatPanelProps {
  columns: string[]
  rules?: ConditionalFormatRule[]
  onChange: (rules: ConditionalFormatRule[]) => void
}

type Operator = ConditionFormatRule['operator']
type Target = ConditionFormatRule['target']

const SCALES: { value: ColorScaleName; label: string }[] = [
  { value: 'red-yellow-green', label: 'Red → Green' },
  { value: 'green', label: 'Green (GitHub)' },
  { value: 'blue', label: 'Blue' },
]

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

// Tiny section label (Chakra 2xs/700/0.05em equivalent)
const SECTION_LABEL = 'text-[10px] font-bold uppercase tracking-wider'

const INPUT_CLASSES = 'h-7 w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground outline-none'
const ADD_BUTTON_CLASSES = 'inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-transparent px-2 py-[3px] text-muted-foreground transition-all duration-150'
const DELETE_BUTTON_CLASSES = 'inline-flex cursor-pointer items-center border-none bg-transparent p-1 text-muted-foreground'

const newId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `cf-${Date.now()}-${Math.round(Math.random() * 1e9)}`

/** Compact dropdown-based select, styled to match the rest of the viz panel. */
function MenuSelect<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  const current = options.find(o => o.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={ariaLabel}
        className="flex h-6 w-full items-center justify-between gap-1 rounded-md border border-border bg-background px-2 font-mono text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
      >
        <span className="truncate">{current?.label ?? value}</span>
        <LuChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[280px] min-w-[120px] overflow-y-auto p-1">
        {options.map(o => (
          <DropdownMenuItem
            key={o.value}
            className="cursor-pointer rounded-sm px-2.5 py-1.5"
            onClick={() => onChange(o.value)}
          >
            <span className={`font-mono text-xs ${o.value === value ? 'font-bold text-[#16a085]' : 'font-medium text-foreground'}`}>
              {o.label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const TableConditionalFormatPanel = ({ columns, rules, onChange }: TableConditionalFormatPanelProps) => {
  const items = rules ?? []
  const columnOptions = columns.map(c => ({ value: c, label: c }))

  const updateRule = (index: number, patch: Partial<ConditionFormatRule> | Partial<ColorScaleFormatRule>) => {
    onChange(items.map((rule, i) => (i === index ? { ...rule, ...patch } as ConditionalFormatRule : rule)))
  }

  const addRule = () => {
    onChange([
      ...items,
      { id: newId(), column: columns[0] ?? '', operator: '=', value: '', target: 'cell', bgColor: DEFAULT_COLOR },
    ])
  }

  const addScaleRule = () => {
    onChange([
      ...items,
      { id: newId(), column: columns[0] ?? '', scale: 'red-yellow-green' },
    ])
  }

  const removeRule = (index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }

  return (
    <div className="mt-2 flex flex-col items-stretch gap-2.5 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className={`${SECTION_LABEL} text-muted-foreground`}>
          Conditional Formatting
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={addRule} aria-label="Add conditional formatting rule" className={ADD_BUTTON_CLASSES}>
            <LuPlus size={10} />
            <span className={SECTION_LABEL}>Rule</span>
          </button>
          <button type="button" onClick={addScaleRule} aria-label="Add color scale rule" className={ADD_BUTTON_CLASSES}>
            <LuPlus size={10} />
            <span className={SECTION_LABEL}>Scale</span>
          </button>
        </div>
      </div>

      {items.length === 0 && (
        <p className="font-mono text-xs text-muted-foreground">
          No rules yet. Color cells when a condition holds (Rule), or paint a numeric column min→max (Scale).
        </p>
      )}

      {items.length > 0 && (
        <div className="flex max-h-[320px] flex-col items-stretch gap-2 overflow-y-auto">
          {items.map((rule, index) => isColorScaleRule(rule) ? (
            <div key={rule.id} className="flex flex-col items-stretch gap-1.5 rounded-md border border-border p-2">
              {/* Colour scale: column · scale · delete */}
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="min-w-0 flex-[2]">
                  <MenuSelect ariaLabel="Scale column" value={rule.column} options={columnOptions} onChange={(column) => updateRule(index, { column })} />
                </div>
                <div className="min-w-0 flex-[2]">
                  <MenuSelect ariaLabel="Color scale" value={rule.scale} options={SCALES} onChange={(scale) => updateRule(index, { scale })} />
                </div>
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  aria-label="Remove conditional formatting rule"
                  className={DELETE_BUTTON_CLASSES}
                >
                  <LuTrash2 size={14} />
                </button>
              </div>
            </div>
          ) : (
            <div key={rule.id} className="flex flex-col items-stretch gap-1.5 rounded-md border border-border p-2">
              {/* Condition: column · operator · value */}
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="min-w-0 flex-[2]">
                  <MenuSelect ariaLabel="Condition column" value={rule.column} options={columnOptions} onChange={(column) => updateRule(index, { column })} />
                </div>
                <div className="min-w-0 flex-1">
                  <MenuSelect ariaLabel="Condition operator" value={rule.operator} options={OPERATORS} onChange={(operator) => updateRule(index, { operator })} />
                </div>
                <div className="min-w-0 flex-[2]">
                  <input
                    type="text"
                    aria-label="Condition value"
                    value={rule.value}
                    onChange={(e) => updateRule(index, { value: e.target.value })}
                    placeholder="value"
                    className={INPUT_CLASSES}
                  />
                </div>
              </div>
              {/* Paint: target · color · delete */}
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <MenuSelect ariaLabel="Paint target" value={rule.target} options={TARGETS} onChange={(target) => updateRule(index, { target })} />
                </div>
                <input
                  type="color"
                  aria-label="Background color"
                  value={rule.bgColor}
                  onChange={(e) => updateRule(index, { bgColor: e.target.value })}
                  className="h-7 w-[34px] cursor-pointer rounded border border-border bg-transparent p-0"
                />
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  aria-label="Remove conditional formatting rule"
                  className={DELETE_BUTTON_CLASSES}
                >
                  <LuTrash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 1 && (
        <p className="font-mono text-[10px] text-muted-foreground">
          When rules overlap, later rules override earlier ones.
        </p>
      )}
    </div>
  )
}
