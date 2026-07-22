import { createElement } from 'react'
import { createPortal } from 'react-dom'
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

// Accent constants (the app palette — same values the converted pivot uses).
const TEAL = '#16a085'
const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

// Small 16px icon-button used for the sort/filter/format toggles.
const toggleBtnClass = (active: boolean) =>
  `flex h-4 w-4 cursor-pointer items-center justify-center rounded-sm transition-all duration-150 ${
    active ? 'opacity-100' : 'opacity-50 hover:opacity-100 hover:bg-muted'
  }`

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
  const isAccented = hasActiveFilter || !!isSorted

  return (
    <th
      // Stable class contract for css overrides (Viz V2 table / story styling)
      className={`mx-th ${cssColumnClass(header.id)} relative min-w-[100px] px-4 py-3 text-left align-top text-xs font-bold text-foreground`}
      style={{
        width: header.getSize(),
        borderRight: displayIndex < totalHeaders - 1 ? '1px solid var(--border)' : undefined,
        borderBottom: isAccented ? `2px solid ${TEAL}` : '1px solid var(--border)',
        ...(isAccented ? { background: mix(TEAL, 5) } : {}),
      }}
    >
      {/* Resize handle */}
      <div
        className={`absolute inset-y-0 right-0 z-[3] w-[4px] cursor-col-resize touch-none select-none hover:opacity-100 ${
          header.column.getIsResizing() ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ background: TEAL }}
        onMouseDown={header.getResizeHandler()}
        onTouchStart={header.getResizeHandler()}
      />
      <div className="flex flex-col items-start gap-1">
        {/* Column name + sort + filter controls */}
        <div className="flex w-full items-center justify-start gap-1 overflow-hidden">
          {/* Existing icon component reference (react-icons/lu) — rendered via
              createElement, matching the old `as={getTypeIcon(colType)}` shape. */}
          {createElement(getTypeIcon(colType), {
            className: 'shrink-0 text-[11px]',
            style: { color: getTypeColor(colType) },
          })}
          <span
            aria-label={`Column header ${getDisplayName(header.id)}`}
            className="min-w-0 flex-1 cursor-pointer truncate uppercase tracking-[0.05em] hover:text-[#16a085]"
            onClick={header.column.getToggleSortingHandler()}
          >
            {getDisplayName(header.id)}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            {/* Sort indicator / toggle */}
            <button
              onClick={header.column.getToggleSortingHandler()}
              className={toggleBtnClass(!!isSorted)}
              style={isSorted ? { background: TEAL } : undefined}
            >
              {isSorted === 'asc' ? (
                <LuArrowUp className="size-2.5 text-white" />
              ) : isSorted === 'desc' ? (
                <LuArrowDown className="size-2.5 text-white" />
              ) : (
                <LuArrowUpDown className="size-2.5 text-muted-foreground" />
              )}
            </button>
            {/* Filter toggle */}
            {colType !== 'json' && (
              <button
                data-filter-anchor={header.id}
                onClick={() => setActiveFilterCol(prev => prev === header.id ? null : header.id)}
                className={toggleBtnClass(hasActiveFilter)}
                style={hasActiveFilter ? { background: TEAL } : undefined}
              >
                <LuFilter className={`size-2.5 ${hasActiveFilter ? 'text-white' : 'text-muted-foreground'}`} />
              </button>
            )}
            {/* Rename / format toggle — only when editable */}
            {onColumnFormatsChange && (() => {
              const hasFormat = !!columnFormats?.[header.id]
              return (
                <button
                  data-format-anchor={header.id}
                  aria-label={`Format column ${header.id}`}
                  onClick={() => setActiveFormatCol(prev => prev === header.id ? null : header.id)}
                  className={toggleBtnClass(hasFormat)}
                  style={hasFormat ? { background: TEAL } : undefined}
                >
                  <LuSettings2 className={`size-2.5 ${hasFormat ? 'text-white' : 'text-muted-foreground'}`} />
                </button>
              )
            })()}
          </div>
        </div>

        {/* Faceted filter popover — portaled to body (fixed-position; carries its own
            theme host so shadcn tokens resolve outside the app-shell host). */}
        {activeFilterCol === header.id && createPortal(
          <div data-mx-theme-host="">
            <div
              className="fixed inset-0 z-[99]"
              onClick={() => setActiveFilterCol(null)}
            />
            <div
              className="z-[100] w-[220px] rounded-md border border-border bg-popover p-2 shadow-lg"
              ref={(el: HTMLDivElement | null) => {
                if (!el) return
                // Position below the filter icon
                const th = document.querySelector(`th [data-filter-anchor="${header.id}"]`)
                if (!th) return
                const rect = (th as HTMLElement).getBoundingClientRect()
                el.style.top = `${rect.bottom + 4}px`
                el.style.left = `${Math.max(8, rect.left - 180)}px`
                el.style.position = 'fixed'
              }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <div className="flex flex-col items-stretch gap-1.5">
                <div className="flex items-center gap-1">
                  <input
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
                    autoFocus
                    className="h-6 w-full min-w-0 rounded-sm border border-border bg-popover px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-[#16a085]"
                  />
                  {hasActiveFilter && (
                    <button
                      onClick={() => {
                        header.column.setFilterValue(undefined)
                        setActiveFilterCol(null)
                      }}
                      className="flex shrink-0 cursor-pointer items-center"
                    >
                      <LuX className="size-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
                {columnUniqueValues[header.id] && columnUniqueValues[header.id].length <= Math.max(FACET_PICKER_MAX_UNIQUE, rowsLength * FACET_PICKER_RATIO) && (
                  <div className="mx-facet-list max-h-[200px] overflow-y-auto">
                    {columnUniqueValues[header.id]
                      .filter(({ value }) =>
                        !facetedFilter.search || value.toLowerCase().includes(facetedFilter.search.toLowerCase())
                      )
                      .slice(0, 50)
                      .map(({ value, count }) => {
                        const isSelected = facetedFilter.selected.includes(value)
                        return (
                          <div
                            key={value}
                            className={`flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 ${isSelected ? '' : 'hover:bg-muted'}`}
                            style={isSelected ? { background: mix(TEAL, 10) } : undefined}
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
                            <div
                              className="flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border"
                              style={{
                                borderColor: isSelected ? TEAL : 'var(--border)',
                                background: isSelected ? TEAL : 'transparent',
                              }}
                            >
                              {isSelected && <LuCheck className="size-2 text-white" />}
                            </div>
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                              {value}
                            </span>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {count}
                            </span>
                          </div>
                        )
                      })}
                  </div>
                )}
                {facetedFilter.selected.length > 0 && (
                  <span className="text-center font-mono text-[10px]" style={{ color: TEAL }}>
                    {facetedFilter.selected.length} selected
                  </span>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Rename / format popover — portaled to body */}
        {activeFormatCol === header.id && onColumnFormatsChange && createPortal(
          <div data-mx-theme-host="">
            <div
              className="fixed inset-0 z-[99]"
              onClick={() => setActiveFormatCol(null)}
            />
            <div
              className="z-[100] rounded-md border border-border bg-popover shadow-lg"
              ref={(el: HTMLDivElement | null) => {
                if (!el) return
                const anchor = document.querySelector(`th [data-format-anchor="${header.id}"]`)
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
            </div>
          </div>,
          document.body
        )}

        {/* Stats area — only rendered when toggled on */}
        {showStats && (
          <div className="h-[100px] w-full overflow-hidden">
            {colType === 'json' ? (
              <span className="font-mono text-[10px] font-normal text-muted-foreground">
                stats n/a
              </span>
            ) : (
              <>
                {loadingStats && !stats && (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                  </div>
                )}
                {(() => {
                  const colStats = stats?.[header.id]
                  if (!colStats) return null
                  return (
                    <>
                      <span className="block font-mono text-[10px] font-normal text-muted-foreground">
                        {colStats.type === 'number' && (
                          <>avg: {colStats.avg.toLocaleString('en-US', { maximumFractionDigits: 0 })}</>
                        )}
                        {colStats.type === 'date' && (
                          <>{colStats.unique} unique</>
                        )}
                        {colStats.type === 'text' && (
                          <>{colStats.unique} unique</>
                        )}
                      </span>
                      {colStats.type === 'text' && colStats.topValues.length > 0 && (
                        <div className="mt-1 w-full">
                          <MiniBarChart
                            data={colStats.topValues}
                            totalUnique={colStats.unique}
                            color={getTypeColor(colType)}
                            height={75}
                          />
                        </div>
                      )}
                      {(colStats.type === 'number' || colStats.type === 'date') && histograms[header.id] && (
                        <div className="mt-1 w-full">
                          <MiniHistogram
                            data={histograms[header.id]}
                            color={getTypeColor(colType)}
                            height={30}
                            isDate={colStats.type === 'date'}
                            isFirstColumn={displayIndex === 0}
                            isLastColumn={displayIndex === totalHeaders - 1}
                          />
                        </div>
                      )}
                    </>
                  )
                })()}
              </>
            )}
          </div>
        )}
      </div>
    </th>
  )
}
