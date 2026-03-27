/**
 * Shared types for completions module
 * Used by both server and client implementations
 */

import type { DatabaseWithSchema } from '@/lib/types';
import type { ResolvedReference } from '@/lib/sql/query-composer';
import type { QueryIR, AnyQueryIR } from '@/lib/sql/ir-types';

/**
 * Options for fetching mention completions
 */
export interface MentionsOptions {
  prefix: string;
  mentionType: 'all' | 'questions';  // @ = all, @@ = questions only
  databaseName?: string;
  whitelistedSchemas?: DatabaseWithSchema[];  // From context - if provided, only show these tables
}

/**
 * Individual mention item returned from completions
 */
export interface MentionItem {
  id?: number;
  name: string;
  schema?: string;
  type: 'table' | 'question' | 'dashboard';
  display_text: string;
  insert_text: string;
}

/**
 * Result from getMentions call
 */
export interface MentionsResult {
  suggestions: MentionItem[];
  metadata?: {
    cached?: boolean;
    timestamp?: number;
  };
}

/**
 * SQL autocomplete options
 */
export interface SqlCompletionsOptions {
  query: string;
  cursorOffset: number;
  context: {
    type: 'sql_editor' | 'chat';
    schemaData?: DatabaseWithSchema[];
    resolvedReferences?: ResolvedReference[];
    databaseName?: string;
  };
}

/**
 * SQL autocomplete suggestion
 */
export interface SqlSuggestion {
  label: string;
  kind: 'table' | 'column' | 'keyword' | 'function' | 'alias';
  insertText: string;
  detail?: string;
}

/**
 * SQL autocomplete result
 */
export interface SqlCompletionsResult {
  suggestions: SqlSuggestion[];
  metadata?: {
    cached?: boolean;
    timestamp?: number;
  };
}

/**
 * SQL to IR conversion options
 */
export interface SqlToIROptions {
  sql: string;
  databaseName?: string;
}

/**
 * SQL to IR conversion result
 */
export interface SqlToIRResult {
  success: boolean;
  ir?: AnyQueryIR;
  error?: string;
  unsupportedFeatures?: string[];
  hint?: string;
  warnings?: string[];
}

/**
 * IR to SQL conversion options
 */
export interface IRToSqlOptions {
  ir: AnyQueryIR;
}

/**
 * IR to SQL conversion result
 */
export interface IRToSqlResult {
  success: boolean;
  sql?: string;
  error?: string;
}

/**
 * Table suggestions options
 */
export interface TableSuggestionsOptions {
  databaseName: string;
  currentIR?: QueryIR;  // Optional context for future intelligence
}

/**
 * Table suggestion item
 */
export interface TableSuggestion {
  name: string;
  schema?: string;
  displayName: string;  // e.g., "schema.table" or "table"
}

/**
 * Table suggestions result
 */
export interface TableSuggestionsResult {
  success: boolean;
  tables?: TableSuggestion[];
  error?: string;
}

/**
 * Column suggestions options
 */
export interface ColumnSuggestionsOptions {
  databaseName: string;
  table: string;
  schema?: string;
  currentIR?: QueryIR;  // Optional context for future intelligence
}

/**
 * Column suggestion item
 */
export interface ColumnSuggestion {
  name: string;
  type?: string;  // Data type (e.g., "varchar", "integer")
  displayName: string;
}

/**
 * Column suggestions result
 */
export interface ColumnSuggestionsResult {
  success: boolean;
  columns?: ColumnSuggestion[];
  error?: string;
}

/**
 * SQL validation error with position info
 */
export interface SqlValidationError {
  message: string;
  line: number;      // 1-indexed
  col: number;       // 1-indexed
  end_col: number;   // 1-indexed
}

/**
 * SQL validation result
 */
export interface ValidateSqlResult {
  valid: boolean;
  errors: SqlValidationError[];
}
