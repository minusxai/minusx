/**
 * Build a synthetic catalog (6 tables) from connection schemas for
 * SearchDBSchema queries. The catalog contains structure + stats/profiles,
 * not sample data.
 */

import type { SchemaEntry, SchemaColumn, ColumnMeta } from '@/lib/connections/base';
import type { ConnectionInfo } from '../types';

// Catalog table schemas
export interface CatalogConnection {
  name: string;
  dialect: string;
  description: string;
}

export interface CatalogSchema {
  connection: string;
  schema_name: string;
}

export interface CatalogTable {
  connection: string;
  schema_name: string;
  table_name: string;
  row_count?: number;
}

export interface CatalogColumn {
  connection: string;
  schema_name: string;
  table_name: string;
  column_name: string;
  data_type: string;
  ordinal_position: number;
}

export interface CatalogIndex {
  connection: string;
  schema_name: string;
  table_name: string;
  index_name: string;
  columns: string;
  is_unique: boolean;
}

export interface CatalogColumnStats {
  connection: string;
  schema_name: string;
  table_name: string;
  column_name: string;
  category?: string;
  description?: string;
  null_count?: number;
  n_distinct?: number;
  min?: number | string;
  max?: number | string;
  avg?: number;
  min_date?: string;
  max_date?: string;
  top_values?: string; // JSON array
}

export interface CatalogData {
  connections: CatalogConnection[];
  schemas: CatalogSchema[];
  tables: CatalogTable[];
  columns: CatalogColumn[];
  indexes: CatalogIndex[];
  column_stats: CatalogColumnStats[];
}

/**
 * Build catalog data from connections and their schemas.
 */
export function buildCatalog(
  connections: ConnectionInfo[],
  schemasByConnection: Map<string, SchemaEntry[]>,
): CatalogData {
  const catalogConnections: CatalogConnection[] = [];
  const catalogSchemas: CatalogSchema[] = [];
  const catalogTables: CatalogTable[] = [];
  const catalogColumns: CatalogColumn[] = [];
  const catalogIndexes: CatalogIndex[] = [];
  const catalogColumnStats: CatalogColumnStats[] = [];

  for (const conn of connections) {
    // Add connection
    catalogConnections.push({
      name: conn.name,
      dialect: conn.dialect,
      description: conn.description ?? '',
    });

    const schemas = schemasByConnection.get(conn.name) ?? [];

    for (const schemaEntry of schemas) {
      // Add schema
      catalogSchemas.push({
        connection: conn.name,
        schema_name: schemaEntry.schema,
      });

      for (const table of schemaEntry.tables) {
        // Add table
        catalogTables.push({
          connection: conn.name,
          schema_name: schemaEntry.schema,
          table_name: table.table,
          row_count: undefined, // SchemaTable doesn't carry row_count
        });

        // Add columns
        for (let i = 0; i < table.columns.length; i++) {
          const col = table.columns[i] as SchemaColumn;
          catalogColumns.push({
            connection: conn.name,
            schema_name: schemaEntry.schema,
            table_name: table.table,
            column_name: col.name,
            data_type: col.type,
            ordinal_position: i + 1,
          });

          // Add column stats if present
          if (col.meta) {
            const meta = col.meta as ColumnMeta;
            const stats: CatalogColumnStats = {
              connection: conn.name,
              schema_name: schemaEntry.schema,
              table_name: table.table,
              column_name: col.name,
            };

            if (meta.category) stats.category = meta.category;
            if (meta.description) stats.description = meta.description;
            if (meta.nullCount != null) stats.null_count = meta.nullCount;
            if (meta.nDistinct != null) stats.n_distinct = meta.nDistinct;
            if (meta.min != null) stats.min = meta.min;
            if (meta.max != null) stats.max = meta.max;
            if (meta.avg != null) stats.avg = meta.avg;
            if (meta.minDate) stats.min_date = meta.minDate;
            if (meta.maxDate) stats.max_date = meta.maxDate;
            if (meta.topValues && meta.topValues.length > 0) {
              stats.top_values = JSON.stringify(meta.topValues);
            }

            // Only add if there's actually stats data
            if (Object.keys(stats).length > 4) {
              catalogColumnStats.push(stats);
            }
          }
        }

        // Add indexes
        if (table.indexes) {
          for (const idx of table.indexes) {
            catalogIndexes.push({
              connection: conn.name,
              schema_name: schemaEntry.schema,
              table_name: table.table,
              index_name: idx.name,
              columns: idx.columns.join(', '),
              is_unique: idx.unique,
            });
          }
        }
      }
    }
  }

  return {
    connections: catalogConnections,
    schemas: catalogSchemas,
    tables: catalogTables,
    columns: catalogColumns,
    indexes: catalogIndexes,
    column_stats: catalogColumnStats,
  };
}

/**
 * Convert catalog data to markdown tables for LLM context.
 */
export function catalogToMarkdown(catalog: CatalogData): string {
  const sections: string[] = [];

  // Connections
  if (catalog.connections.length > 0) {
    sections.push('## Connections\n');
    sections.push('| name | dialect | description |');
    sections.push('|---|---|---|');
    for (const c of catalog.connections) {
      sections.push(`| ${c.name} | ${c.dialect} | ${c.description || ''} |`);
    }
    sections.push('');
  }

  // Tables with columns
  if (catalog.tables.length > 0) {
    sections.push('## Tables\n');
    sections.push('| connection | schema | table | row_count |');
    sections.push('|---|---|---|---|');
    for (const t of catalog.tables) {
      sections.push(`| ${t.connection} | ${t.schema_name} | ${t.table_name} | ${t.row_count ?? '?'} |`);
    }
    sections.push('');
  }

  // Columns
  if (catalog.columns.length > 0) {
    sections.push('## Columns\n');
    sections.push('| connection | schema | table | column | type |');
    sections.push('|---|---|---|---|---|');
    for (const c of catalog.columns) {
      sections.push(`| ${c.connection} | ${c.schema_name} | ${c.table_name} | ${c.column_name} | ${c.data_type} |`);
    }
    sections.push('');
  }

  return sections.join('\n');
}
