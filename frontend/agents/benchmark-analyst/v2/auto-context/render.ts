import 'server-only';

import type { AutoContextPayload } from './finish-tool';
import { truncateRow } from './truncate';

/** Pure markdown rendering of the agent's structured AutoContext payload.
 *  Budget-enforced: drops trailing tables / examples when the running total
 *  would exceed `maxChars`. Always emits at least a header so downstream
 *  consumers see a stable shape. */
export function renderAutoContextPayload(
  payload: AutoContextPayload,
  maxChars: number,
): string {
  const header = '# Auto-discovered schema context';
  const blocks: string[] = [header];
  let total = header.length;

  const mdEscape = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

  for (const t of payload.tables) {
    const block = renderTable(t, mdEscape);
    const cost = block.length + 2; // join newlines
    if (total + cost > maxChars) break;
    blocks.push(block);
    total += cost;
  }

  if (payload.examples.length > 0) {
    const examplesHeader = '# Example queries';
    if (total + examplesHeader.length + 2 <= maxChars) {
      blocks.push(examplesHeader);
      total += examplesHeader.length + 2;
      for (let i = 0; i < payload.examples.length; i++) {
        const block = renderExample(payload.examples[i], i);
        const cost = block.length + 2;
        if (total + cost > maxChars) break;
        blocks.push(block);
        total += cost;
      }
    }
  }

  return blocks.join('\n\n');
}

function renderTable(
  t: AutoContextPayload['tables'][number],
  mdEscape: (s: string) => string,
): string {
  const lines: string[] = [];
  lines.push(`## ${t.connection}.${t.schema}.${t.table}`);
  if (t.tableNote) lines.push('', t.tableNote);

  if (t.columns.length > 0) {
    lines.push('', '| column | note |', '|---|---|');
    for (const c of t.columns) {
      if (!c.note) continue;
      lines.push(`| ${c.name} | ${mdEscape(c.note)} |`);
    }
  }

  if (t.joins.length > 0) {
    lines.push('', 'Joins:');
    for (const j of t.joins) {
      lines.push(`- ${j.fromColumn} → ${j.toTable}.${j.toColumn} — ${mdEscape(j.evidence)}`);
    }
  }
  return lines.join('\n');
}

function renderExample(e: AutoContextPayload['examples'][number], i: number): string {
  const lines: string[] = [];
  lines.push(`### Example ${i + 1}: ${e.description}`);
  lines.push('```sql');
  lines.push(`-- connection: ${e.connection}`);
  lines.push(e.query);
  lines.push('```');
  if (e.rows.length > 0) {
    lines.push('Result:');
    for (const r of e.rows) lines.push(`- ${JSON.stringify(truncateRow(r as Record<string, unknown>))}`);
  }
  return lines.join('\n');
}
