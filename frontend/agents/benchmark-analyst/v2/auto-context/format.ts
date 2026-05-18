import 'server-only';

import type { ColumnMeta } from '@/lib/connections/base';
import type { Example } from './examples';
import type { JoinForNote } from './notes';
import { truncateRow } from './truncate';

/** Per-column data carried into the renderer — combines mechanical
 *  stats (from `ColumnMeta`) with the LLM-written note. */
export interface AnnotatedColumn {
  name: string;
  type: string;
  meta?: ColumnMeta;
  note?: string;
}

/** Per-table data carried into the renderer. */
export interface AnnotatedTable {
  connection: string;
  schema: string;
  table: string;
  rowCount?: number;
  tableNote?: string;
  columns: AnnotatedColumn[];
  joins: JoinForNote[];
  samples: Record<string, unknown>[];
}

export interface AutoContextRender {
  tables: AnnotatedTable[];
  examples: Example[];
}

// ─── Per-section rendering (pure) ────────────────────────────────────────────

function metaCell(m: ColumnMeta | undefined): string {
  if (!m) return '';
  const bits: string[] = [];
  if (m.nDistinct !== undefined) {
    bits.push(`${m.nDistinct < 50 ? 'low-card' : 'high-card'} (nDistinct=${m.nDistinct})`);
  }
  if (m.nullCount !== undefined && m.nullCount > 0) bits.push(`nullCount=${m.nullCount}`);
  if (m.min !== undefined && m.max !== undefined) bits.push(`min=${m.min}, max=${m.max}`);
  if (m.topValues && m.topValues.length > 0) {
    const top = m.topValues.slice(0, 3).map((t) => JSON.stringify(t.value)).join(', ');
    bits.push(`top=[${top}]`);
  }
  return bits.join('; ');
}

/** Render one table block. Pure. */
function renderTable(t: AnnotatedTable): string {
  const lines: string[] = [];
  const head = `## ${t.connection}.${t.schema}.${t.table}${t.rowCount !== undefined ? ` (${t.rowCount} rows)` : ''}`;
  lines.push(head);

  if (t.tableNote) lines.push('', t.tableNote);

  // Columns table — kept terse to bound token cost. Escape order matters:
  // backslashes first (so we don't double-escape our own escapes), then
  // pipes (which would otherwise break the markdown row), then newlines
  // (which would split a single note across multiple table rows).
  const mdEscape = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  lines.push('', '| column | type | stats | note |', '|---|---|---|---|');
  for (const c of t.columns) {
    lines.push(`| ${c.name} | ${c.type} | ${metaCell(c.meta)} | ${mdEscape(c.note ?? '')} |`);
  }

  if (t.joins.length > 0) {
    lines.push('', 'Joins:');
    for (const j of t.joins) {
      lines.push(`- ${j.fromColumn} → ${j.toTable}.${j.toColumn} (${j.kind}, overlap=${j.overlap.toFixed(2)})`);
    }
  }

  if (t.samples.length > 0) {
    lines.push('', 'Sample rows:');
    // Per-value truncation: keeps blob-heavy columns (README content,
    // commit messages) from dominating the rendered block.
    for (const r of t.samples) lines.push(`- ${JSON.stringify(truncateRow(r))}`);
  }
  return lines.join('\n');
}

/** Render one example block. Pure. */
function renderExample(e: Example, i: number): string {
  const lines: string[] = [];
  lines.push(`### Example ${i + 1}: ${e.description}`);
  lines.push('```sql');
  lines.push(`-- connection: ${e.connection}`);
  lines.push(e.query);
  lines.push('```');
  lines.push('Result:');
  for (const r of e.rows) lines.push(`- ${JSON.stringify(truncateRow(r))}`);
  return lines.join('\n');
}

// ─── Top-level renderer with budget enforcement ──────────────────────────────

/**
 * Render the AutoContext block to markdown under `maxChars`. Tables are
 * included in insertion order (highest priority first); when the budget
 * would be exceeded, trailing tables are dropped. Examples come last
 * and are also subject to the budget.
 *
 * Always emits at least a 1-line header so downstream consumers see a
 * stable shape (handy for tests + cache key inspection).
 */
export function renderAutoContext(data: AutoContextRender, maxChars: number): string {
  const header = '# Auto-discovered schema context';
  const blocks: string[] = [header];
  let total = header.length;

  for (const t of data.tables) {
    const block = '\n\n' + renderTable(t);
    if (total + block.length > maxChars) break;
    blocks.push(renderTable(t));
    total += block.length;
  }

  if (data.examples.length > 0) {
    const examplesHeader = '\n\n# Example queries';
    if (total + examplesHeader.length <= maxChars) {
      blocks.push('# Example queries');
      total += examplesHeader.length;
      for (let i = 0; i < data.examples.length; i++) {
        const block = '\n\n' + renderExample(data.examples[i], i);
        if (total + block.length > maxChars) break;
        blocks.push(renderExample(data.examples[i], i));
        total += block.length;
      }
    }
  }

  return blocks.join('\n\n');
}
