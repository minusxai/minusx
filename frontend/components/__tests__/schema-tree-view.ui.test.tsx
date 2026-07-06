import React from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import SchemaTreeView, { type SchemaTreeItem } from '@/components/schema-browser/SchemaTreeView';

describe('SchemaTreeView', () => {
  it('renders without crashing when a table is missing its columns array', () => {
    // Production data can arrive with `columns` undefined even though the type
    // declares it required (Sentry MINUSX-BI-2C: table.columns.length on undefined).
    const schemas = [
      {
        schema: 'public',
        tables: [
          { table: 'orders', columns: [{ name: 'id', type: 'integer' }] },
          // Malformed table: no columns array.
          { table: 'broken' } as SchemaTreeItem['tables'][number],
        ],
      },
    ];

    expect(() =>
      renderWithProviders(
        <SchemaTreeView schemas={schemas} defaultExpandedSchemas showColumns />
      )
    ).not.toThrow();
  });

  it('filters by column search without crashing when a table is missing its columns array', () => {
    const schemas = [
      {
        schema: 'public',
        tables: [{ table: 'broken' } as SchemaTreeItem['tables'][number]],
      },
    ];

    const { getByLabelText } = renderWithProviders(
      <SchemaTreeView schemas={schemas} defaultExpandedSchemas showColumns />
    );

    // A query that matches neither schema nor table name forces the
    // column .some() path (line 230), which also reads table.columns.
    expect(() => {
      const search = getByLabelText('Search schema tree');
      fireEvent.change(search, { target: { value: 'zzz_no_match' } });
    }).not.toThrow();
  });
});
