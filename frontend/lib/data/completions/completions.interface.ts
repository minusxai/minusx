import { EffectiveUser } from '@/lib/auth/auth-helpers';
import {
  MentionsOptions,
  MentionsResult,
  SqlCompletionsOptions,
  SqlCompletionsResult,
  SqlToIROptions,
  SqlToIRResult,
  IRToSqlOptions,
  IRToSqlResult,
  TableSuggestionsOptions,
  TableSuggestionsResult,
  ColumnSuggestionsOptions,
  ColumnSuggestionsResult,
} from './types';

/**
 * Shared interface for completions data layer
 * Both server and client implementations must conform to this interface
 *
 * Server: Loads schema/questions + calls Python backend
 * Client: HTTP calls to API routes with caching
 */
export interface ICompletionsDataLayer {
  /**
   * Get mention completions for @ autocomplete
   *
   * @param options - Completion options (prefix, mentionType, databaseName)
   * @param user - Effective user for permission checks
   * @returns Suggestions array with metadata
   */
  getMentions(options: MentionsOptions, user: EffectiveUser): Promise<MentionsResult>;

  /**
   * Get SQL autocomplete completions
   *
   * @param options - SQL completion options (query, cursorOffset, context)
   * @param user - Effective user for permission checks
   * @returns SQL completion suggestions
   */
  getSqlCompletions(options: SqlCompletionsOptions, user: EffectiveUser): Promise<SqlCompletionsResult>;

  /**
   * Parse SQL to Intermediate Representation (IR) for GUI builder
   * Pure parsing operation - no user context needed
   *
   * @param options - SQL to IR options (sql, databaseName)
   * @returns IR object or error details
   */
  sqlToIR(options: SqlToIROptions): Promise<SqlToIRResult>;

  /**
   * Generate SQL from Intermediate Representation (IR)
   * Pure function - no user context needed
   *
   * @param options - IR to SQL options (ir)
   * @returns Generated SQL string
   */
  irToSql(options: IRToSqlOptions): Promise<IRToSqlResult>;

  /**
   * Get table suggestions for GUI builder
   * Returns list of available tables from schema
   *
   * @param options - Table suggestions options (databaseName, optional currentIR)
   * @param user - Effective user for permission checks
   * @returns List of table suggestions
   */
  getTableSuggestions(options: TableSuggestionsOptions, user: EffectiveUser): Promise<TableSuggestionsResult>;

  /**
   * Get column suggestions for GUI builder
   * Returns list of columns for specified table
   *
   * @param options - Column suggestions options (databaseName, table, optional currentIR)
   * @param user - Effective user for permission checks
   * @returns List of column suggestions
   */
  getColumnSuggestions(options: ColumnSuggestionsOptions, user: EffectiveUser): Promise<ColumnSuggestionsResult>;
}
