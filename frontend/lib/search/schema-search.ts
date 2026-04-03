/**
 * Database schema search logic.
 *
 * Extracted from tool-handlers.server.ts so it can be imported without
 * triggering side-effect tool registrations in the chat orchestrator.
 */

import { JSONPath } from 'jsonpath-plus';
import { searchInField } from '@/lib/search/file-search-utils';

interface SchemaSearchResult {
  schema: any;
  score: number;
  matchCount: number;
  relevantResults: Array<{
    field: 'schema' | 'table' | 'column';
    location: string;
    snippet: string;
    matchType: 'exact' | 'partial';
  }>;
}

/**
 * Search within schema hierarchy using weighted scoring
 */
async function searchSchemas(
  schemas: any[],
  query: string
): Promise<SchemaSearchResult[]> {
  const results: SchemaSearchResult[] = [];

  for (const schemaItem of schemas) {
    const schemaName = schemaItem.schema || '';
    const tables = schemaItem.tables || [];

    let totalMatches = 0;
    let totalScore = 0;
    const relevantResults: SchemaSearchResult['relevantResults'] = [];

    // Search schema name (weight: 3)
    const schemaStats = searchInField(schemaName, query, 'schema', 3);
    totalMatches += schemaStats.exactMatches + schemaStats.wordBoundaryMatches + schemaStats.partialMatches;
    totalScore += (schemaStats.exactMatches * 10 + schemaStats.wordBoundaryMatches * 5 + schemaStats.partialMatches * 1) * 3;

    if (schemaStats.snippets.length > 0) {
      relevantResults.push({
        field: 'schema',
        location: schemaName,
        snippet: schemaStats.snippets[0],
        matchType: schemaStats.exactMatches > 0 ? 'exact' : 'partial'
      });
    }

    // Search tables and columns
    for (const table of tables) {
      const tableName = table.table || '';
      const columns = table.columns || [];

      // Search table name (weight: 2)
      const tableStats = searchInField(tableName, query, 'table', 2);
      totalMatches += tableStats.exactMatches + tableStats.wordBoundaryMatches + tableStats.partialMatches;
      totalScore += (tableStats.exactMatches * 10 + tableStats.wordBoundaryMatches * 5 + tableStats.partialMatches * 1) * 2;

      if (tableStats.snippets.length > 0) {
        relevantResults.push({
          field: 'table',
          location: `${schemaName}.${tableName}`,
          snippet: tableStats.snippets[0],
          matchType: tableStats.exactMatches > 0 ? 'exact' : 'partial'
        });
      }

      // Search column names (weight: 1)
      for (const column of columns) {
        const columnName = column.name || '';
        const columnStats = searchInField(columnName, query, 'column', 1);
        totalMatches += columnStats.exactMatches + columnStats.wordBoundaryMatches + columnStats.partialMatches;
        totalScore += (columnStats.exactMatches * 10 + columnStats.wordBoundaryMatches * 5 + columnStats.partialMatches * 1) * 1;

        if (columnStats.snippets.length > 0 && relevantResults.length < 10) {
          relevantResults.push({
            field: 'column',
            location: `${schemaName}.${tableName}.${columnName}`,
            snippet: columnStats.snippets[0],
            matchType: columnStats.exactMatches > 0 ? 'exact' : 'partial'
          });
        }
      }
    }

    if (totalMatches > 0) {
      const maxPossible = 30 * 3;
      const score = Math.min(totalScore / maxPossible, 1.0);

      results.push({
        schema: schemaItem,
        score,
        matchCount: totalMatches,
        relevantResults: relevantResults.slice(0, 10)
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Core search logic for database schemas.
 * Auto-detects: queries starting with '$' use JSONPath, others use weighted string search.
 */
export async function searchDatabaseSchema(
  schemas: any[],
  query?: string
): Promise<{
  success: boolean;
  schema?: any;
  results?: SchemaSearchResult[];
  queryType: 'none' | 'jsonpath' | 'string';
  tableCount: number;
}> {
  if (!query) {
    return {
      success: true,
      schema: schemas,
      queryType: 'none',
      tableCount: schemas.reduce((acc: number, s: any) =>
        acc + (s.tables?.length || 0), 0
      )
    };
  }

  const isJSONPath = query.startsWith('$');

  if (isJSONPath) {
    try {
      const pathResults = JSONPath({
        path: query,
        json: schemas,
        resultType: 'all'
      });

      const enrichedResults = pathResults.map((item: any) => {
        const value = item.value;
        const path = item.path;

        const schemaMatch = path.match(/\$\[(\d+)\]/);
        const tableMatch = path.match(/\['tables'\]\[(\d+)\]/);

        if (schemaMatch) {
          const schemaIdx = parseInt(schemaMatch[1]);
          const schemaName = schemas[schemaIdx]?.schema;

          if (typeof value === 'object' && value !== null) {
            const enriched: any = { ...value };
            if (schemaName) enriched._schema = schemaName;

            if (tableMatch) {
              const tableIdx = parseInt(tableMatch[1]);
              const tableName = schemas[schemaIdx]?.tables?.[tableIdx]?.table;
              if (tableName) enriched._table = tableName;
            }
            return enriched;
          }
        }
        return value;
      });

      const tableCount = Array.isArray(enrichedResults)
        ? enrichedResults.reduce((acc: number, item: any) => {
            if (item?.tables) return acc + item.tables.length;
            return acc;
          }, 0)
        : 0;

      return {
        success: true,
        schema: enrichedResults,
        queryType: 'jsonpath',
        tableCount
      };
    } catch (error) {
      throw new Error(`Invalid JSONPath query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  const searchResults = await searchSchemas(schemas, query);

  return {
    success: true,
    results: searchResults,
    queryType: 'string',
    tableCount: searchResults.reduce((acc, r) =>
      acc + (r.schema.tables?.length || 0), 0
    )
  };
}
