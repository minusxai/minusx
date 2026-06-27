import { describe, it, expect } from 'vitest';
import { budgetAnnotationNotes } from '@/lib/sql/schema-filter';
import { resolveContextDocs } from '@/lib/sql/schema-filter';
import type { ContextContent, TableAnnotation } from '@/lib/types';

function annTables(n: number, colsPer: number): TableAnnotation[] {
  return Array.from({ length: n }, (_, i) => ({
    schema: 'public',
    table: `table_${i}`,
    description: `Description for table ${i} that is reasonably long to consume budget`,
    columns: Array.from({ length: colsPer }, (_, c) => ({
      name: `col_${c}`,
      description: `Column ${c} description text`,
    })),
  }));
}

describe('budgetAnnotationNotes', () => {
  it('includes every block when under budget and drops nothing', () => {
    const { lines, droppedTables, droppedColumns } = budgetAnnotationNotes(annTables(2, 1), 100_000);
    expect(droppedTables).toBe(0);
    expect(droppedColumns).toBe(0);
    expect(lines.join('\n')).toContain('- public.table_0 — Description for table 0');
    expect(lines.join('\n')).toContain('  - col_0: Column 0 description text');
  });

  it('skips tables with no description and no annotated columns (not counted as dropped)', () => {
    const anns: TableAnnotation[] = [
      { schema: 'public', table: 'bare', columns: [{ name: 'x' }] },
      { schema: 'public', table: 'real', description: 'has a note' },
    ];
    const { lines, droppedTables } = budgetAnnotationNotes(anns, 100_000);
    expect(droppedTables).toBe(0);
    expect(lines.join('\n')).toContain('real');
    expect(lines.join('\n')).not.toContain('bare');
  });

  it('caps a rogue context and reports dropped tables AND columns', () => {
    const { lines, droppedTables, droppedColumns } = budgetAnnotationNotes(annTables(1000, 5), 500);
    expect(droppedTables).toBeGreaterThan(0);
    expect(droppedColumns).toBeGreaterThan(0);
    // kept portion stays within ~budget (allow one overshoot block).
    expect(lines.join('\n').length).toBeLessThan(1200);
  });

  it('qualifies the head with [connection] when the annotation specifies one', () => {
    const anns: TableAnnotation[] = [
      { connection: 'main_db', schema: 'public', table: 'orders', description: 'Customer orders', columns: [{ name: 'amount', description: 'cents' }] },
      { schema: 'public', table: 'users', description: 'App users' }, // no connection
    ];
    const { lines } = budgetAnnotationNotes(anns, 100_000);
    const text = lines.join('\n');
    expect(text).toContain('- [main_db] public.orders — Customer orders');
    // Column line is NOT connection-qualified — indentation conveys hierarchy.
    expect(text).toContain('  - amount: cents');
    // No connection → no prefix (unchanged format).
    expect(text).toContain('- public.users — App users');
    expect(text).not.toContain('[undefined]');
  });

  it('keeps each table block atomic — never a head without its columns', () => {
    const { lines } = budgetAnnotationNotes(annTables(50, 3), 400);
    // Every column sub-line must be preceded somewhere by at least one head line.
    const heads = lines.filter((l) => l.startsWith('- '));
    const cols = lines.filter((l) => l.startsWith('  - '));
    expect(heads.length).toBeGreaterThan(0);
    // columns count must be a multiple-ish of kept heads (3 cols per kept table)
    expect(cols.length).toBe(heads.length * 3);
  });
});

describe('buildSchemaNotes truncation (via resolveContextDocs)', () => {
  it('appends a SearchDBSchema truncation note when annotations overflow', () => {
    const ctx: ContextContent = {
      fullAnnotations: annTables(2000, 4),
      fullMetrics: [],
    } as unknown as ContextContent;
    const { schemaNotes } = resolveContextDocs(ctx, 1);
    expect(schemaNotes).toContain('## Schema Notes');
    expect(schemaNotes).toMatch(/more annotated table/i);
    expect(schemaNotes).toContain('SearchDBSchema');
  });

  it('does not append a note when annotations fit', () => {
    const ctx: ContextContent = {
      fullAnnotations: annTables(2, 1),
      fullMetrics: [],
    } as unknown as ContextContent;
    const { schemaNotes } = resolveContextDocs(ctx, 1);
    expect(schemaNotes).toContain('## Schema Notes');
    expect(schemaNotes).not.toMatch(/more annotated table/i);
  });
});
