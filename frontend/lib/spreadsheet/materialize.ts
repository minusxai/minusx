import type { QueryResult, SpreadsheetSource } from '@/lib/types';
import { getQueryHash, hashContent } from '@/lib/utils/query-hash';

export interface SpreadsheetLimits {
  maxRows: number;
  maxColumns: number;
}

/** Direct-data question limits. Other spreadsheet surfaces may pass their own limits. */
export const QUESTION_SPREADSHEET_LIMITS: SpreadsheetLimits = {
  maxRows: 500,
  maxColumns: 25,
};

// Compatibility aliases for callers/tests that only need the question limits.
export const MAX_SPREADSHEET_ROWS = QUESTION_SPREADSHEET_LIMITS.maxRows;
export const MAX_SPREADSHEET_COLUMNS = QUESTION_SPREADSHEET_LIMITS.maxColumns;

export type CellValidationErrorCode =
  | 'row_limit'
  | 'column_limit'
  | 'empty_header'
  | 'duplicate_header'
  | 'row_width'
  | 'invalid_number'
  | 'invalid_boolean'
  | 'invalid_date';

export interface CellValidationError {
  code: CellValidationErrorCode;
  /** Zero is the header row; data rows are one-based. */
  row: number;
  /** Zero-based column index. */
  column: number;
  message: string;
  value?: string | null;
}

export type SpreadsheetRunResult =
  | { ok: true; data: QueryResult }
  | { ok: false; errors: CellValidationError[] };

export interface SpreadsheetExecution {
  query: string;
  params: Record<string, never>;
  database: '';
  id: string;
}

/**
 * Return the content-addressed cache identity used by every direct-data surface.
 * It deliberately uses the existing query-result key space so visualization and
 * projection consumers do not need a second result store.
 */
export function getSpreadsheetExecution(source: SpreadsheetSource): SpreadsheetExecution {
  const query = `spreadsheet:${hashContent(source)}`;
  return { query, params: {}, database: '', id: getQueryHash(query, {}, '') };
}

function valueOrNull(value: string | null | undefined): string | null {
  return value == null || value === '' ? null : value;
}

function isNumber(value: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())
    && Number.isFinite(Number(value));
}

function isBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === 'false';
}

function isDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

type MaterializedType = 'text' | 'number' | 'boolean' | 'date';

function inferType(values: Array<string | null>): MaterializedType {
  const present = values.filter((value): value is string => value != null);
  if (present.length === 0) return 'text';
  if (present.every(isBoolean)) return 'boolean';
  if (present.every(isNumber)) return 'number';
  if (present.every(isDate)) return 'date';
  return 'text';
}

function queryType(type: MaterializedType): string {
  if (type === 'number') return 'DOUBLE';
  if (type === 'boolean') return 'BOOLEAN';
  if (type === 'date') return 'DATE';
  return 'VARCHAR';
}

function invalidCode(type: Exclude<MaterializedType, 'text'>): CellValidationErrorCode {
  if (type === 'number') return 'invalid_number';
  if (type === 'boolean') return 'invalid_boolean';
  return 'invalid_date';
}

function isValid(value: string, type: MaterializedType): boolean {
  if (type === 'text') return true;
  if (type === 'number') return isNumber(value);
  if (type === 'boolean') return isBoolean(value);
  return isDate(value);
}

function coerce(value: string | null, type: MaterializedType): string | number | boolean | null {
  if (value == null) return null;
  if (type === 'number') return Number(value.trim());
  if (type === 'boolean') return value.trim().toLowerCase() === 'true';
  if (type === 'date') return value.trim();
  return value;
}

/**
 * The sole validation and coercion boundary for persisted spreadsheet data.
 * Callers either receive a complete QueryResult or no data at all.
 */
export function runSpreadsheetSource(
  source: SpreadsheetSource,
  limits: SpreadsheetLimits = QUESTION_SPREADSHEET_LIMITS,
): SpreadsheetRunResult {
  const errors: CellValidationError[] = [];

  if (source.rows.length > limits.maxRows) {
    errors.push({
      code: 'row_limit', row: limits.maxRows + 1, column: 0,
      message: `Spreadsheet data is limited to ${limits.maxRows.toLocaleString()} rows.`,
    });
  }
  if (source.columns.length > limits.maxColumns) {
    errors.push({
      code: 'column_limit', row: 0, column: limits.maxColumns,
      message: `Spreadsheet data is limited to ${limits.maxColumns} columns.`,
    });
  }

  const headerIndexes = new Map<string, number[]>();
  const headers = source.columns.map((column, columnIndex) => {
    const name = column.name.trim();
    if (!name) {
      errors.push({
        code: 'empty_header', row: 0, column: columnIndex,
        message: 'Column headers cannot be empty.', value: column.name,
      });
    } else {
      const key = name.toLocaleLowerCase();
      headerIndexes.set(key, [...(headerIndexes.get(key) ?? []), columnIndex]);
    }
    return name;
  });
  for (const indexes of headerIndexes.values()) {
    if (indexes.length < 2) continue;
    for (const column of indexes) {
      errors.push({
        code: 'duplicate_header', row: 0, column,
        message: `Column header “${headers[column]}” is duplicated.`, value: headers[column],
      });
    }
  }

  const normalizedRows = source.rows.map((row, rowIndex) => {
    if (row.length > source.columns.length) {
      errors.push({
        code: 'row_width', row: rowIndex + 1, column: source.columns.length,
        message: `Row ${rowIndex + 1} has data outside the declared columns.`,
        value: row[source.columns.length],
      });
    }
    return Array.from(
      { length: source.columns.length },
      (_, columnIndex) => valueOrNull(row[columnIndex]),
    );
  });

  const resolvedTypes = source.columns.map((column, columnIndex): MaterializedType => {
    if (column.type !== 'auto') return column.type;
    return inferType(normalizedRows.map(row => row[columnIndex]));
  });

  for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex++) {
    for (let columnIndex = 0; columnIndex < source.columns.length; columnIndex++) {
      const value = normalizedRows[rowIndex][columnIndex];
      const type = resolvedTypes[columnIndex];
      if (value == null || type === 'text' || isValid(value, type)) continue;
      errors.push({
        code: invalidCode(type), row: rowIndex + 1, column: columnIndex,
        message: `“${value}” is not a valid ${type}.`, value,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const execution = getSpreadsheetExecution(source);
  const rows = normalizedRows.map(row => Object.fromEntries(
    headers.map((header, columnIndex) => [header, coerce(row[columnIndex], resolvedTypes[columnIndex])]),
  ));

  return {
    ok: true,
    data: {
      columns: headers,
      types: resolvedTypes.map(queryType),
      rows,
      finalQuery: execution.query,
      id: execution.id,
    },
  };
}
