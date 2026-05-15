// Catalog builder: creates the 6 synthetic catalog tables from connection schemas
// Tables: connections, schemas, tables, columns, indexes, column_stats

import type { SchemaEntry, NodeConnector, QueryResult, ColumnMeta } from '@/lib/connections/base';
import { profileDatabase } from '@/lib/connections/statistics-engine';

export interface CatalogTable {
  columns: string[];
  types: string[];
  rows: Record<string, unknown>[];
}

export interface CatalogTables {
  connections: CatalogTable;
  schemas: CatalogTable;
  tables: CatalogTable;
  columns: CatalogTable;
  indexes: CatalogTable;
  column_stats: CatalogTable;
}

/**
 * Build the synthetic catalog from all connectors.
 * Each connector's schema is fetched and optionally enriched via profileDatabase.
 */
export async function buildCatalog(
  connectors: Map<string, NodeConnector>,
): Promise<CatalogTables> {
  const connectionsRows: Record<string, unknown>[] = [];
  const schemasRows: Record<string, unknown>[] = [];
  const tablesRows: Record<string, unknown>[] = [];
  const columnsRows: Record<string, unknown>[] = [];
  const indexesRows: Record<string, unknown>[] = [];
  const columnStatsRows: Record<string, unknown>[] = [];

  for (const [connName, connector] of connectors) {
    connectionsRows.push({ connection_name: connName });

    let schema: SchemaEntry[];
    try {
      schema = await connector.getSchema();
    } catch (err) {
      console.warn(`Failed to get schema for ${connName}:`, err);
      continue;
    }

    // Check if schema is already enriched (has meta on columns)
    const needsEnrichment = schema.some((s) =>
      s.tables.some((t) =>
        t.columns.some((c) => !c.meta),
      ),
    );

    if (needsEnrichment) {
      try {
        const profile = await profileDatabase(
          'duckdb', // Default to duckdb profiling strategy
          schema,
          async (sql) => connector.query(sql),
        );
        schema = profile.schema;
      } catch (err) {
        console.warn(`Failed to profile ${connName}:`, err);
        // Continue with unenriched schema
      }
    }

    for (const schemaEntry of schema) {
      schemasRows.push({
        connection_name: connName,
        schema_name: schemaEntry.schema,
      });

      for (const table of schemaEntry.tables) {
        tablesRows.push({
          connection_name: connName,
          schema_name: schemaEntry.schema,
          table_name: table.table,
          row_count: null, // Not available from SchemaTable
        });

        for (const col of table.columns) {
          columnsRows.push({
            connection_name: connName,
            schema_name: schemaEntry.schema,
            table_name: table.table,
            column_name: col.name,
            data_type: col.type,
          });

          // Column stats from meta
          if (col.meta) {
            columnStatsRows.push(buildColumnStatsRow(
              connName,
              schemaEntry.schema,
              table.table,
              col.name,
              col.meta,
            ));
          }
        }

        // Indexes
        for (const idx of table.indexes ?? []) {
          indexesRows.push({
            connection_name: connName,
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

  return {
    connections: {
      columns: ['connection_name'],
      types: ['VARCHAR'],
      rows: connectionsRows,
    },
    schemas: {
      columns: ['connection_name', 'schema_name'],
      types: ['VARCHAR', 'VARCHAR'],
      rows: schemasRows,
    },
    tables: {
      columns: ['connection_name', 'schema_name', 'table_name', 'row_count'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'BIGINT'],
      rows: tablesRows,
    },
    columns: {
      columns: ['connection_name', 'schema_name', 'table_name', 'column_name', 'data_type'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR'],
      rows: columnsRows,
    },
    indexes: {
      columns: ['connection_name', 'schema_name', 'table_name', 'index_name', 'columns', 'is_unique'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'BOOLEAN'],
      rows: indexesRows,
    },
    column_stats: {
      columns: [
        'connection_name', 'schema_name', 'table_name', 'column_name',
        'category', 'n_distinct', 'null_count',
        'min_value', 'max_value', 'avg_value',
        'min_date', 'max_date',
        'top_values',
      ],
      types: [
        'VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR',
        'VARCHAR', 'BIGINT', 'BIGINT',
        'DOUBLE', 'DOUBLE', 'DOUBLE',
        'VARCHAR', 'VARCHAR',
        'VARCHAR',
      ],
      rows: columnStatsRows,
    },
  };
}

function buildColumnStatsRow(
  connName: string,
  schemaName: string,
  tableName: string,
  columnName: string,
  meta: ColumnMeta,
): Record<string, unknown> {
  return {
    connection_name: connName,
    schema_name: schemaName,
    table_name: tableName,
    column_name: columnName,
    category: meta.category,
    n_distinct: meta.nDistinct,
    null_count: meta.nullCount,
    min_value: meta.min,
    max_value: meta.max,
    avg_value: meta.avg,
    min_date: meta.minDate,
    max_date: meta.maxDate,
    top_values: meta.topValues ? JSON.stringify(meta.topValues) : null,
  };
}
