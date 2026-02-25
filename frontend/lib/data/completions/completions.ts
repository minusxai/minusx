import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { ICompletionsDataLayer } from './completions.interface';
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

const API_BASE = '';  // Same origin

/**
 * Client-side implementation of completions data layer
 * Uses HTTP calls to API routes with caching
 *
 * Note: user parameter is ignored on client - auth is handled by API routes
 */
class CompletionsDataLayerClient implements ICompletionsDataLayer {
  private mentionsCache = new Map<string, MentionsResult>();
  private sqlCompletionsCache = new Map<string, SqlCompletionsResult>();

  /**
   * Generate cache key for mentions
   */
  private getMentionsCacheKey(options: MentionsOptions): string {
    return JSON.stringify({
      prefix: options.prefix.toLowerCase(), // Normalize for case-insensitive caching
      mentionType: options.mentionType,
      databaseName: options.databaseName,
      whitelistedSchemas: options.whitelistedSchemas
    });
  }

  async getMentions(options: MentionsOptions, user?: EffectiveUser): Promise<MentionsResult> {
    // Check cache first
    const cacheKey = this.getMentionsCacheKey(options);
    const cached = this.mentionsCache.get(cacheKey);

    if (cached) {
      return {
        ...cached,
        metadata: {
          ...cached.metadata,
          cached: true
        }
      };
    }

    // Fetch from API
    const res = await fetch(`${API_BASE}/api/chat/mentions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix: options.prefix,
        mentionType: options.mentionType,
        databaseName: options.databaseName,
        whitelistedSchemas: options.whitelistedSchemas
      })
    });

    if (!res.ok) {
      console.error('[Completions Client] API error:', res.statusText);
      return { suggestions: [] };
    }

    const data = await res.json();
    const result: MentionsResult = {
      suggestions: data.suggestions || [],
      metadata: {
        timestamp: Date.now(),
        cached: false
      }
    };

    // Cache the result
    this.mentionsCache.set(cacheKey, result);

    // Limit cache size (keep last 100 entries)
    if (this.mentionsCache.size > 100) {
      const firstKey = this.mentionsCache.keys().next().value;
      if (firstKey) {
        this.mentionsCache.delete(firstKey);
      }
    }

    return result;
  }

  /**
   * Generate cache key for SQL completions
   */
  private getSqlCompletionsCacheKey(options: SqlCompletionsOptions): string {
    return JSON.stringify({
      query: options.query.substring(Math.max(0, options.cursorOffset - 50), options.cursorOffset + 50), // Only cache context around cursor
      cursorOffset: options.cursorOffset,
      databaseName: options.context.databaseName,
      type: options.context.type
    });
  }

  async getSqlCompletions(options: SqlCompletionsOptions, user?: EffectiveUser): Promise<SqlCompletionsResult> {
    // Check cache first
    const cacheKey = this.getSqlCompletionsCacheKey(options);
    const cached = this.sqlCompletionsCache.get(cacheKey);

    if (cached) {
      return {
        ...cached,
        metadata: {
          ...cached.metadata,
          cached: true
        }
      };
    }

    // Fetch from API
    const res = await fetch(`${API_BASE}/api/autocomplete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: options.query,
        cursorOffset: options.cursorOffset,
        context: options.context
      })
    });

    if (!res.ok) {
      console.error('[Completions Client] SQL autocomplete API error:', res.statusText);
      return { suggestions: [] };
    }

    const data = await res.json();
    const result: SqlCompletionsResult = {
      suggestions: data.suggestions || [],
      metadata: {
        timestamp: Date.now(),
        cached: false
      }
    };

    // Cache the result
    this.sqlCompletionsCache.set(cacheKey, result);

    // Limit cache size (keep last 50 entries for SQL - smaller cache)
    if (this.sqlCompletionsCache.size > 50) {
      const firstKey = this.sqlCompletionsCache.keys().next().value;
      if (firstKey) {
        this.sqlCompletionsCache.delete(firstKey);
      }
    }

    return result;
  }

  /**
   * Clear all caches
   * Useful when switching databases or when data changes
   */
  clearCache(): void {
    this.mentionsCache.clear();
    this.sqlCompletionsCache.clear();
  }

  /**
   * Clear cache entries for a specific database
   */
  clearCacheForDatabase(databaseName: string): void {
    // Clear mentions cache
    for (const [key, _] of this.mentionsCache.entries()) {
      try {
        const options = JSON.parse(key) as MentionsOptions;
        if (options.databaseName === databaseName) {
          this.mentionsCache.delete(key);
        }
      } catch (e) {
        // Skip invalid cache keys
        continue;
      }
    }

    // Clear SQL completions cache
    for (const [key, _] of this.sqlCompletionsCache.entries()) {
      try {
        const options = JSON.parse(key) as { databaseName?: string };
        if (options.databaseName === databaseName) {
          this.sqlCompletionsCache.delete(key);
        }
      } catch (e) {
        // Skip invalid cache keys
        continue;
      }
    }
  }

  async sqlToIR(options: SqlToIROptions): Promise<SqlToIRResult> {
    try {
      const res = await fetch(`${API_BASE}/api/sql-to-ir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: options.sql,
          databaseName: options.databaseName,
        }),
      });

      if (!res.ok) {
        console.error('[Completions Client] SQL to IR API error:', res.statusText);
        return {
          success: false,
          error: 'Failed to parse SQL',
        };
      }

      const data = await res.json();
      return data;
    } catch (error) {
      console.error('[Completions Client] SQL to IR error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async irToSql(options: IRToSqlOptions): Promise<IRToSqlResult> {
    try {
      // Call backend API - single source of truth for IR→SQL conversion
      const res = await fetch(`${API_BASE}/api/ir-to-sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ir: options.ir,
        }),
      });

      if (!res.ok) {
        console.error('[Completions Client] IR to SQL API error:', res.statusText);
        return {
          success: false,
          error: 'Failed to generate SQL',
        };
      }

      const data = await res.json();
      return data;
    } catch (error) {
      console.error('[Completions Client] IR to SQL error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getTableSuggestions(options: TableSuggestionsOptions, user?: EffectiveUser): Promise<TableSuggestionsResult> {
    try {
      const res = await fetch(`${API_BASE}/api/table-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseName: options.databaseName,
          currentIR: options.currentIR,
        }),
      });

      if (!res.ok) {
        console.error('[Completions Client] Table suggestions API error:', res.statusText);
        return {
          success: false,
          error: 'Failed to get table suggestions',
        };
      }

      const data = await res.json();
      return data;
    } catch (error) {
      console.error('[Completions Client] Table suggestions error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getColumnSuggestions(options: ColumnSuggestionsOptions, user?: EffectiveUser): Promise<ColumnSuggestionsResult> {
    // @reference tables (e.g. "@revenue_by_month_43") — infer columns via /api/infer-columns.
    // The alias format is always `${slug}_${id}` so the question ID is after the last `_`.
    if (options.table?.startsWith('@')) {
      try {
        const alias = options.table.slice(1);
        const lastUnderscore = alias.lastIndexOf('_');
        const questionId = lastUnderscore >= 0 ? parseInt(alias.slice(lastUnderscore + 1), 10) : NaN;
        if (!isNaN(questionId)) {
          const res = await fetch(`${API_BASE}/api/infer-columns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ questionId }),
          });
          if (res.ok) {
            const data = await res.json();
            return {
              success: true,
              columns: (data.columns ?? []).map((c: { name: string; type: string }) => ({
                name: c.name,
                type: c.type,
                displayName: c.name,
              })),
            };
          }
        }
      } catch (err) {
        console.error('[Completions Client] Failed to infer columns for reference:', err);
      }
      return { success: false, error: 'Could not infer columns for reference' };
    }

    try {
      const res = await fetch(`${API_BASE}/api/column-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseName: options.databaseName,
          table: options.table,
          schema: options.schema,
          currentIR: options.currentIR,
        }),
      });

      if (!res.ok) {
        console.error('[Completions Client] Column suggestions API error:', res.statusText);
        return {
          success: false,
          error: 'Failed to get column suggestions',
        };
      }

      const data = await res.json();
      return data;
    } catch (error) {
      console.error('[Completions Client] Column suggestions error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

/**
 * Singleton instance for client-side completions
 */
export const CompletionsAPI = new CompletionsDataLayerClient();
