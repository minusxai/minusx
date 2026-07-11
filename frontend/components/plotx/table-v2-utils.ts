import { LuType, LuHash, LuCalendar, LuBraces } from 'react-icons/lu'

export type ColumnType = 'text' | 'number' | 'date' | 'json'

/**
 * Per-column class in the table's STABLE class contract (`.mx-col-<name>`), the
 * public styling surface for CSS overrides (Viz V2 table source / story styling).
 * Column names are sanitized to a css-safe token. Keep the contract in sync with
 * the `css` field docs in atlas-schemas' VizSourceTable.
 */
export const cssColumnClass = (name: string): string =>
  `mx-col-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`

// Reusable format options — created once, not per call
export const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
export const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

export const formatValue = (value: any, type: ColumnType): string => {
  if (value == null) {
    return '-'
  }
  switch (type) {
    case 'number':
      if (typeof value === 'number') {
        return NUMBER_FORMAT.format(value)
      }
      return String(value)
    case 'date':
      if (value instanceof Date) {
        return DATE_FORMAT.format(value)
      }
      return String(value)
    case 'json':
      if (typeof value === 'object') {
        return JSON.stringify(value)
      }
      return String(value)
    case 'text':
    default:
      if (typeof value === 'object') {
        return JSON.stringify(value)
      }
      return String(value)
  }
}

export const getTypeIcon = (type: ColumnType) => {
  switch (type) {
    case 'number': return LuHash
    case 'date': return LuCalendar
    case 'json': return LuBraces
    case 'text':
    default: return LuType
  }
}

export const getTypeColor = (type: ColumnType) => {
  switch (type) {
    case 'number': return '#2980b9'
    case 'date': return '#9b59b6'
    case 'json': return '#1abc9c'
    case 'text':
    default: return '#f39c12'
  }
}

export const ROW_HEIGHT = 41
// Max unique values to show checkbox picker; above this only the search bar is shown.
// Uses the greater of this floor or 50% of total rows.
export const FACET_PICKER_MAX_UNIQUE = 500
export const FACET_PICKER_RATIO = 0.5

// Filter value: text search OR a set of selected values
export interface FacetedFilterValue {
  search: string
  selected: string[] // stored as array for serialization; treated as set
}

export const isFacetedFilter = (v: unknown): v is FacetedFilterValue =>
  v != null && typeof v === 'object' && 'search' in v
