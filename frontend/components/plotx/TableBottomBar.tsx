import { createElement } from 'react'
import { LuChevronDown, LuColumns3, LuCheck, LuDownload, LuX, LuChartColumn } from 'react-icons/lu'
import type { ColumnFiltersState, VisibilityState } from '@tanstack/react-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/kit/dropdown-menu'
import { getTypeIcon, getTypeColor, type ColumnType } from './table-v2-utils'

// Accent constants (the app palette — same values the converted pivot uses).
const TEAL = '#16a085'

// Small toolbar button chrome (Chakra size 2xs outline equivalent: 24px tall, xs text).
const TOOLBAR_BTN =
  'inline-flex h-6 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md border border-border bg-muted px-2 text-xs font-medium whitespace-nowrap text-foreground transition-all hover:bg-accent hover:border-muted-foreground/40 [&_svg]:shrink-0'

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
  const allVisible = colNames.every(c => columnVisibility[c] !== false)

  return (
    // mx-toolbar: stable class contract — surfaces/css overrides hide chrome with
    // `.mx-toolbar { display: none }` instead of a prop (no toggles by design).
    <div className="mx-toolbar mt-2 flex shrink-0 items-center justify-between px-2">
      {/* Left: Stats, Columns, Filters */}
      <div className="flex items-center gap-3">
        {setShowStats && (
        <button
          className={TOOLBAR_BTN}
          style={showStats ? { background: TEAL, borderColor: TEAL, color: 'white' } : undefined}
          onClick={() => setShowStats(prev => !prev)}
        >
          <LuChartColumn className="size-3" />
          Stats
        </button>
        )}
        {setColumnVisibility && colNames.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className={TOOLBAR_BTN}>
            <LuColumns3 className="size-3" />
            {visibleColumnCount}/{colNames.length} Columns
            <LuChevronDown className="size-3 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-[300px] min-w-[200px] overflow-y-auto">
            <DropdownMenuItem
              className="cursor-pointer"
              // closeOnSelect={false} equivalent: keep the menu open on toggle
              onSelect={(e) => e.preventDefault()}
              onClick={() => {
                if (allVisible) {
                  const hidden: VisibilityState = {}
                  colNames.forEach(c => { hidden[c] = false })
                  setColumnVisibility(hidden)
                } else {
                  setColumnVisibility({})
                }
              }}
            >
              <div className="flex w-full items-center gap-2">
                <div className="flex h-4 w-4 items-center justify-center">
                  {allVisible && <LuCheck className="size-4" style={{ color: TEAL }} />}
                </div>
                <span className="text-xs font-semibold">
                  {allVisible ? 'Hide All' : 'Show All'}
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {colNames.map((column, index) => {
              return (
                <DropdownMenuItem
                  key={column}
                  className="cursor-pointer"
                  onSelect={(e) => e.preventDefault()}
                  onClick={() => {
                    setColumnVisibility(prev => ({
                      ...prev,
                      [column]: prev[column] === false ? true : false,
                    }))
                  }}
                >
                  <div className="flex w-full items-center gap-2">
                    <div className="flex h-4 w-4 items-center justify-center">
                      {columnVisibility[column] !== false && (
                        <LuCheck className="size-4" style={{ color: TEAL }} />
                      )}
                    </div>
                    {createElement(getTypeIcon(columnTypes[index]), {
                      className: 'shrink-0 text-[11px]',
                      style: { color: getTypeColor(columnTypes[index]) },
                    })}
                    <span className="min-w-0 truncate font-mono text-xs">
                      {column}
                    </span>
                  </div>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        )}
        {setColumnFilters && columnFilters.length > 0 && (
          <button
            className="inline-flex h-6 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-all hover:bg-accent [&_svg]:shrink-0"
            style={{ color: TEAL }}
            onClick={() => {
              setColumnFilters([])
              setActiveFilterCol?.(null)
            }}
          >
            <LuX className="size-3" />
            Clear {columnFilters.length} filter{columnFilters.length > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Right: Row count, CSV */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-muted-foreground">
          {filteredRowCount !== totalRowCount
            ? `${filteredRowCount} filtered of ${totalRowCount} rows`
            : `${totalRowCount} rows`
          }
        </span>
        <button
          className={TOOLBAR_BTN}
          onClick={downloadCsv}
          aria-label="Download CSV"
          data-dev-hide-in-capture="true"
        >
          <LuDownload className="size-3" />
          CSV
        </button>
      </div>
    </div>
  )
}
