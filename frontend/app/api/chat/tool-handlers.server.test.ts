/**
 * Integration tests for SearchDBSchema tool handler
 * Tests the core search logic with realistic schema data
 */

import { searchDatabaseSchema } from './tool-handlers.server';

// Sample schema data mimicking DuckDB AdventureWorks structure
const mockSchemas = [
  {
    schema: 'Sales',
    tables: [
      {
        table: 'Customer',
        columns: [
          { name: 'CustomerID', type: 'BIGINT' },
          { name: 'PersonID', type: 'BIGINT' },
          { name: 'TerritoryID', type: 'BIGINT' },
          { name: 'AccountNumber', type: 'VARCHAR' },
          { name: 'ModifiedDate', type: 'TIMESTAMP' }
        ]
      },
      {
        table: 'SalesTerritory',
        columns: [
          { name: 'TerritoryID', type: 'BIGINT' },
          { name: 'Name', type: 'VARCHAR' },
          { name: 'CountryRegionCode', type: 'VARCHAR' },
          { name: 'Group', type: 'VARCHAR' },
          { name: 'SalesYTD', type: 'DOUBLE' }
        ]
      },
      {
        table: 'SalesOrderHeader',
        columns: [
          { name: 'SalesOrderID', type: 'BIGINT' },
          { name: 'OrderDate', type: 'TIMESTAMP' },
          { name: 'CustomerID', type: 'BIGINT' },
          { name: 'TotalDue', type: 'DOUBLE' }
        ]
      }
    ]
  },
  {
    schema: 'Person',
    tables: [
      {
        table: 'Person',
        columns: [
          { name: 'BusinessEntityID', type: 'BIGINT' },
          { name: 'PersonType', type: 'VARCHAR' },
          { name: 'FirstName', type: 'VARCHAR' },
          { name: 'LastName', type: 'VARCHAR' },
          { name: 'EmailPromotion', type: 'BIGINT' }
        ]
      },
      {
        table: 'EmailAddress',
        columns: [
          { name: 'BusinessEntityID', type: 'BIGINT' },
          { name: 'EmailAddressID', type: 'BIGINT' },
          { name: 'EmailAddress', type: 'VARCHAR' },
          { name: 'ModifiedDate', type: 'TIMESTAMP' }
        ]
      }
    ]
  },
  {
    schema: 'Production',
    tables: [
      {
        table: 'Product',
        columns: [
          { name: 'ProductID', type: 'BIGINT' },
          { name: 'Name', type: 'VARCHAR' },
          { name: 'ProductNumber', type: 'VARCHAR' },
          { name: 'Color', type: 'VARCHAR' },
          { name: 'ListPrice', type: 'DOUBLE' }
        ]
      }
    ]
  }
];

describe('searchDatabaseSchema', () => {
  /**
   * Test 1: String search finds matches across all levels (schema/table/column)
   * Tests weighted scoring and relevantResults
   */
  it('should search across schemas, tables, and columns with weighted scoring', async () => {
    const result = await searchDatabaseSchema(mockSchemas, 'Territory');

    expect(result.success).toBe(true);
    expect(result.queryType).toBe('string');
    expect(result.results).toBeDefined();
    expect(result.results!.length).toBeGreaterThan(0);

    // Should find matches in:
    // 1. Table name: "SalesTerritory" (weight 2)
    // 2. Column names: "TerritoryID" in multiple tables (weight 1)
    const topResult = result.results![0];
    expect(topResult.score).toBeGreaterThan(0);
    expect(topResult.matchCount).toBeGreaterThan(0);
    expect(topResult.relevantResults).toBeDefined();
    expect(topResult.relevantResults.length).toBeGreaterThan(0);

    // Should have location information showing where matches were found
    const hasTableMatch = topResult.relevantResults.some(r => r.field === 'table');
    const hasColumnMatch = topResult.relevantResults.some(r => r.field === 'column');
    expect(hasTableMatch || hasColumnMatch).toBe(true);

    // Location should be in format: "schema.table" or "schema.table.column"
    const firstMatch = topResult.relevantResults[0];
    expect(firstMatch.location).toContain('.');
    expect(firstMatch.snippet).toBeTruthy();
  });

  /**
   * Test 2: JSONPath query for structural filtering
   * Tests extracting specific elements by structure, not by name
   */
  it('should execute JSONPath queries to filter by structure', async () => {
    // Get all VARCHAR columns across all schemas
    const result = await searchDatabaseSchema(mockSchemas, '$..columns[?(@.type=="VARCHAR")]');

    expect(result.success).toBe(true);
    expect(result.queryType).toBe('jsonpath');
    expect(result.schema).toBeDefined();
    expect(Array.isArray(result.schema)).toBe(true);

    // Should return only VARCHAR columns
    const varcharColumns = result.schema as Array<{ name: string; type: string }>;
    expect(varcharColumns.length).toBeGreaterThan(0);
    expect(varcharColumns.every(col => col.type === 'VARCHAR')).toBe(true);

    // Should include columns like 'Name', 'FirstName', 'LastName', 'EmailAddress', etc.
    const columnNames = varcharColumns.map(col => col.name);
    expect(columnNames).toContain('Name');
    expect(columnNames).toContain('FirstName');
  });

  /**
   * Test 3: JSONPath preserves schema/table context
   * Tests that extracted columns include _schema and _table metadata
   */
  it('should enrich JSONPath results with schema and table context', async () => {
    // Find all columns with "ID" in the name (common pattern for primary/foreign keys)
    const result = await searchDatabaseSchema(mockSchemas, '$..columns[?(@.name.match(/ID$/i))]');

    expect(result.success).toBe(true);
    expect(result.queryType).toBe('jsonpath');
    expect(Array.isArray(result.schema)).toBe(true);

    const idColumns = result.schema as Array<{
      name: string;
      type: string;
      _schema?: string;
      _table?: string;
    }>;
    expect(idColumns.length).toBeGreaterThan(0);

    // All columns should end with "ID"
    expect(idColumns.every(col => col.name.endsWith('ID'))).toBe(true);

    // Should include CustomerID, TerritoryID, ProductID, etc.
    const columnNames = idColumns.map(col => col.name);
    expect(columnNames).toContain('CustomerID');
    expect(columnNames).toContain('TerritoryID');
    expect(columnNames).toContain('ProductID');

    // NEW: Verify context is preserved
    const customerIdCol = idColumns.find(col => col.name === 'CustomerID');
    expect(customerIdCol).toBeDefined();
    expect(customerIdCol?._schema).toBe('Sales');
    expect(customerIdCol?._table).toBe('Customer');

    // Verify another column has correct context
    const territoryIdCol = idColumns.find(
      col => col.name === 'TerritoryID' && col._table === 'SalesTerritory'
    );
    expect(territoryIdCol).toBeDefined();
    expect(territoryIdCol?._schema).toBe('Sales');
  });

  /**
   * Test 4: No query returns full schema
   */
  it('should return full schema when no query provided', async () => {
    const result = await searchDatabaseSchema(mockSchemas);

    expect(result.success).toBe(true);
    expect(result.queryType).toBe('none');
    expect(result.schema).toEqual(mockSchemas);
    expect(result.tableCount).toBe(6); // 3 + 2 + 1 tables
  });
});
