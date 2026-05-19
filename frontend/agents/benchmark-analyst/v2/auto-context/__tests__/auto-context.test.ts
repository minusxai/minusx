/**
 * Tests for the consolidated `auto-context.ts` module. Slices are added as
 * the module is built (TDD). Initial slice: ID assignment over a catalog
 * schema.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ColumnMeta } from '@/lib/connections/base';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { validateParameters } from '@/orchestrator/utils';
import type { FlatColumn } from '../schema';
import type { ConversationLogEntry } from '@/orchestrator/types';
import {
  assignCatalogIds,
  AutoContextAgent,
  parseAnnotations,
  renderCatalogForAgent,
  renderGeneratedContext,
  SubmitSchemaInfo,
  verifyJoinsMechanically,
  type JoinProbe,
} from '../auto-context';

const col = (
  connection: string,
  schema: string,
  table: string,
  column: string,
  type = 'INTEGER',
): FlatColumn => ({ connection, schema, table, column, type });

describe('assignCatalogIds', () => {
  it('assigns short alphanumeric IDs (g/s/t/c prefix) for every catalog element', () => {
    const schema: FlatColumn[] = [
      col('db1', 'public', 'users', 'id'),
      col('db1', 'public', 'users', 'email', 'VARCHAR'),
      col('db1', 'public', 'orders', 'id'),
      col('db1', 'public', 'orders', 'user_id'),
    ];
    const idMap = assignCatalogIds(schema);

    const all = idMap.all();
    // 1 connection + 1 schema + 2 tables + 4 columns = 8 entries
    expect(all).toHaveLength(8);

    for (const entry of all) {
      expect(entry.id).toMatch(/^[gstc][0-9]+$/);
    }
    expect(all.filter((e) => e.type === 'connection')).toHaveLength(1);
    expect(all.filter((e) => e.type === 'schema')).toHaveLength(1);
    expect(all.filter((e) => e.type === 'table')).toHaveLength(2);
    expect(all.filter((e) => e.type === 'column')).toHaveLength(4);
  });

  it('supports bidirectional lookup by id and by canonical path', () => {
    const schema: FlatColumn[] = [col('db', 'main', 'users', 'email', 'VARCHAR')];
    const idMap = assignCatalogIds(schema);

    const connectionEntry = idMap.byPath('db');
    const schemaEntry = idMap.byPath('db.main');
    const tableEntry = idMap.byPath('db.main.users');
    const columnEntry = idMap.byPath('db.main.users.email');

    expect(connectionEntry?.type).toBe('connection');
    expect(schemaEntry?.type).toBe('schema');
    expect(tableEntry?.type).toBe('table');
    expect(columnEntry?.type).toBe('column');

    // byId round-trip
    expect(idMap.byId(connectionEntry!.id)).toBe(connectionEntry);
    expect(idMap.byId(columnEntry!.id)).toBe(columnEntry);

    // Unknown lookups return undefined
    expect(idMap.byPath('nope')).toBeUndefined();
    expect(idMap.byId('zzz999')).toBeUndefined();
  });

  it('produces deterministic IDs across invocations for the same input', () => {
    const schema: FlatColumn[] = [
      col('db1', 'public', 'users', 'id'),
      col('db1', 'public', 'users', 'email'),
      col('db2', 'main', 'orders', 'id'),
    ];
    const a = assignCatalogIds(schema);
    const b = assignCatalogIds(schema);
    for (const entry of a.all()) {
      const matching = b.byPath(canonicalPath(entry));
      expect(matching?.id).toBe(entry.id);
    }
  });

  it('namespaces schemas under connections (same schema name in two connections → distinct IDs)', () => {
    const schema: FlatColumn[] = [
      col('db1', 'public', 'users', 'id'),
      col('db2', 'public', 'orders', 'id'),
    ];
    const idMap = assignCatalogIds(schema);
    const schemas = idMap.all().filter((e) => e.type === 'schema');
    expect(schemas).toHaveLength(2);
    expect(schemas[0].id).not.toBe(schemas[1].id);
    // Both have the same `schema` name but distinct paths
    expect(idMap.byPath('db1.public')).toBeDefined();
    expect(idMap.byPath('db2.public')).toBeDefined();
    expect(idMap.byPath('db1.public')!.id).not.toBe(idMap.byPath('db2.public')!.id);
  });
});

function canonicalPath(entry: { connection: string; schema?: string; table?: string; column?: string }): string {
  return [entry.connection, entry.schema, entry.table, entry.column].filter(Boolean).join('.');
}

const colKey = (c: FlatColumn) => `${c.connection}.${c.schema}.${c.table}.${c.column}`;
const tableKey = (c: FlatColumn) => `${c.connection}.${c.schema}.${c.table}`;

describe('renderCatalogForAgent', () => {
  it('renders connections, schemas, tables, columns with their IDs visible', () => {
    const schema: FlatColumn[] = [
      col('db1', 'public', 'users', 'id'),
      col('db1', 'public', 'users', 'email', 'VARCHAR'),
    ];
    const idMap = assignCatalogIds(schema);
    const out = renderCatalogForAgent(schema, idMap, new Map(), new Map(), 100_000);

    // Each ID category appears in the output with a bracket prefix.
    expect(out).toMatch(/\[g0\]\s+db1/);
    expect(out).toMatch(/\[s0\]\s+public/);
    expect(out).toMatch(/\[t0\]\s+users/);
    expect(out).toMatch(/\[c0\]\s+id/);
    expect(out).toMatch(/\[c1\]\s+email/);
  });

  it('includes per-column type + ColumnMeta stats inline', () => {
    const c = col('db', 'main', 'users', 'email', 'VARCHAR');
    const stats = new Map<string, ColumnMeta>([
      [colKey(c), { category: 'text', nDistinct: 1000, nullCount: 5, topValues: [{ value: 'a@b', count: 10, fraction: 0.01 }] }],
    ]);
    const rowCounts = new Map<string, number>([[tableKey(c), 12345]]);
    const idMap = assignCatalogIds([c]);
    const out = renderCatalogForAgent([c], idMap, stats, rowCounts, 100_000);
    expect(out).toContain('VARCHAR');
    expect(out).toContain('nDistinct=1000');
    expect(out).toContain('nullCount=5');
    expect(out).toContain('12345');
    expect(out).toContain('a@b');
  });

  it('does NOT render sample rows (agent fetches via ExecuteQuery if needed)', () => {
    const c = col('db', 'main', 'users', 'email', 'VARCHAR');
    const idMap = assignCatalogIds([c]);
    const out = renderCatalogForAgent([c], idMap, new Map(), new Map(), 100_000);
    expect(out).not.toMatch(/sample rows?/i);
  });

  it('drops trailing tables and prepends a bounded note when maxChars is exceeded', () => {
    const schema: FlatColumn[] = Array.from({ length: 8 }, (_, i) =>
      col('db', 's', `t${i}`, 'c1', 'VARCHAR'),
    );
    const idMap = assignCatalogIds(schema);
    // Tight budget: only a couple of tables fit.
    const out = renderCatalogForAgent(schema, idMap, new Map(), new Map(), 250);
    expect(out).toMatch(/^> Note:.*bounded/m);
    expect(out).toContain('t0');
    expect(out).not.toContain('t7');
  });
});

describe('SubmitSchemaInfo tool', () => {
  it('accepts a valid annotations payload and stashes it under details.payload', async () => {
    const orch = new Orchestrator([SubmitSchemaInfo]);
    const validation = validateParameters(SubmitSchemaInfo.schema.parameters, {
      annotations: [
        { id: 'c0', description: 'comma-separated city list, e.g. "palo alto, san mateo"' },
        { id: 'c1', join: { to: 'c0' } },
      ],
    });
    expect(validation.ok).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = new SubmitSchemaInfo(orch, validation.ok ? validation.value : {} as any, {} as any);
    const result = await tool.run();
    expect(result.isError).toBe(false);
    expect(result.details).toBeDefined();
    expect((result.details as { type: string }).type).toBe('auto_context');
    const payload = (result.details as { payload: { annotations: unknown[] } }).payload;
    expect(payload.annotations).toHaveLength(2);
  });

  it('rejects annotations whose id does not match the pattern', () => {
    const validation = validateParameters(SubmitSchemaInfo.schema.parameters, {
      annotations: [{ id: 'INVALID_ID_WITH_CAPS', description: 'nope' }],
    });
    expect(validation.ok).toBe(false);
  });

  it('rejects join.to whose id does not match the pattern', () => {
    const validation = validateParameters(SubmitSchemaInfo.schema.parameters, {
      annotations: [{ id: 'c0', join: { to: 'BAD_TARGET' } }],
    });
    expect(validation.ok).toBe(false);
  });

  it('accepts annotations that have neither description nor join (treated as no-op)', () => {
    const validation = validateParameters(SubmitSchemaInfo.schema.parameters, {
      annotations: [{ id: 'c0' }],
    });
    // The TypeBox schema permits it; agent-side validation strips entries
    // with no useful payload at the merge step.
    expect(validation.ok).toBe(true);
  });
});

describe('parseAnnotations', () => {
  // Build a tiny log with a SubmitSchemaInfo toolResult under an agent id.
  function logWithPayload(agentId: string, payload: unknown): ConversationLogEntry[] {
    return [
      {
        role: 'toolResult',
        toolCallId: 'sub-1',
        toolName: 'SubmitSchemaInfo',
        content: [{ type: 'text', text: 'AutoContext submitted' }],
        isError: false,
        details: { type: 'auto_context', payload },
        timestamp: Date.now(),
        parent_id: agentId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ];
  }

  it('extracts the payload from the SubmitSchemaInfo toolResult under the agent id', () => {
    const schema: FlatColumn[] = [
      col('db', 'main', 'users', 'id'),
      col('db', 'main', 'users', 'email', 'VARCHAR'),
    ];
    const idMap = assignCatalogIds(schema);
    // c0 = users.id, c1 = users.email per traversal order
    const log = logWithPayload('agent-X', {
      annotations: [
        { id: 'c0', description: 'primary key' },
        { id: 'c1', description: 'email address' },
      ],
    });
    const result = parseAnnotations(log, 'agent-X', idMap);
    expect(result).not.toBeNull();
    expect(result!.annotations).toHaveLength(2);
  });

  it('drops annotations whose id is not in the IdMap (defensive — agent might hallucinate)', () => {
    const schema: FlatColumn[] = [col('db', 'main', 'users', 'id')];
    const idMap = assignCatalogIds(schema);
    const log = logWithPayload('a', {
      annotations: [
        { id: 'c0', description: 'real' },
        { id: 'c999', description: 'hallucinated' },
      ],
    });
    const result = parseAnnotations(log, 'a', idMap);
    expect(result!.annotations).toHaveLength(1);
    expect(result!.annotations[0].id).toBe('c0');
  });

  it('drops join.to references that do not resolve to a real id', () => {
    const schema: FlatColumn[] = [
      col('db', 'main', 'users', 'id'),
      col('db', 'main', 'orders', 'user_id'),
    ];
    const idMap = assignCatalogIds(schema);
    // c0 = users.id, c1 = orders.user_id
    const log = logWithPayload('a', {
      annotations: [
        { id: 'c0' },
        { id: 'c1', join: { to: 'c0' } },           // valid
        { id: 'c0', join: { to: 'c999' } },         // hallucinated target
      ],
    });
    const result = parseAnnotations(log, 'a', idMap);
    // c0 first appearance has no useful content (no description, no join) → dropped
    // c1 with valid join → kept
    // c0 with bad join → join dropped, no description, no remaining content → dropped
    expect(result!.annotations).toHaveLength(1);
    expect(result!.annotations[0].id).toBe('c1');
    expect(result!.annotations[0].join?.to).toBe('c0');
  });

  it('drops annotations with neither description nor join (no useful payload)', () => {
    const schema: FlatColumn[] = [col('db', 'main', 'users', 'id')];
    const idMap = assignCatalogIds(schema);
    const log = logWithPayload('a', {
      annotations: [
        { id: 'c0' }, // empty
        { id: 'c0', description: '' }, // empty string description
      ],
    });
    const result = parseAnnotations(log, 'a', idMap);
    expect(result!.annotations).toHaveLength(0);
  });

  it('returns null when there is no SubmitSchemaInfo result for the given agent id', () => {
    const schema: FlatColumn[] = [col('db', 'main', 'users', 'id')];
    const idMap = assignCatalogIds(schema);
    const log = logWithPayload('different-agent', { annotations: [{ id: 'c0', description: 'x' }] });
    const result = parseAnnotations(log, 'agent-X', idMap);
    expect(result).toBeNull();
  });

  it('returns null when the details shape is wrong (no payload)', () => {
    const log: ConversationLogEntry[] = [
      {
        role: 'toolResult', toolCallId: 'sub', toolName: 'SubmitSchemaInfo',
        content: [{ type: 'text', text: 'submitted' }], isError: false,
        timestamp: Date.now(), parent_id: 'a',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ];
    const idMap = assignCatalogIds([col('db', 'main', 'users', 'id')]);
    const result = parseAnnotations(log, 'a', idMap);
    expect(result).toBeNull();
  });
});

describe('verifyJoinsMechanically', () => {
  // Tiny schema with two columns we can join on.
  const schema: FlatColumn[] = [
    col('db', 'main', 'users', 'id'),       // c0
    col('db', 'main', 'users', 'email'),    // c1
    col('db', 'main', 'orders', 'user_id'), // c2
    col('other', 'pub', 'tracking', 'uid'), // c3 (cross-connection target)
  ];

  it('keeps joins whose probe returns ok=true', async () => {
    const idMap = assignCatalogIds(schema);
    const probe: JoinProbe = vi.fn().mockResolvedValue({ ok: true });
    const result = await verifyJoinsMechanically(
      {
        annotations: [
          { id: 'c2', join: { to: 'c0' } },  // orders.user_id → users.id
        ],
      },
      idMap,
      probe,
    );
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].join?.to).toBe('c0');
  });

  it('drops the join entry (but keeps description) when probe returns ok=false', async () => {
    const idMap = assignCatalogIds(schema);
    const probe: JoinProbe = vi.fn().mockResolvedValue({ ok: false });
    const result = await verifyJoinsMechanically(
      {
        annotations: [
          { id: 'c2', description: 'user reference', join: { to: 'c0' } },
        ],
      },
      idMap,
      probe,
    );
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].description).toBe('user reference');
    expect(result.annotations[0].join).toBeUndefined();
  });

  it('drops the entire annotation when only the join existed and probe failed', async () => {
    const idMap = assignCatalogIds(schema);
    const probe: JoinProbe = vi.fn().mockResolvedValue({ ok: false });
    const result = await verifyJoinsMechanically(
      {
        annotations: [
          { id: 'c2', join: { to: 'c0' } },
        ],
      },
      idMap,
      probe,
    );
    expect(result.annotations).toHaveLength(0);
  });

  it('drops joins where probe throws (treats as 0 rows)', async () => {
    const idMap = assignCatalogIds(schema);
    const probe: JoinProbe = vi.fn().mockRejectedValue(new Error('SQL error'));
    const result = await verifyJoinsMechanically(
      {
        annotations: [
          { id: 'c2', join: { to: 'c0' } },
        ],
      },
      idMap,
      probe,
    );
    expect(result.annotations).toHaveLength(0);
  });

  it('passes canonical endpoint paths to the probe callback', async () => {
    const idMap = assignCatalogIds(schema);
    const probe: JoinProbe = vi.fn().mockResolvedValue({ ok: true });
    await verifyJoinsMechanically(
      { annotations: [{ id: 'c2', join: { to: 'c0' } }] },
      idMap,
      probe,
    );
    expect(probe).toHaveBeenCalledTimes(1);
    const args = (probe as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[0]).toEqual({ connection: 'db', schema: 'main', table: 'orders', column: 'user_id' });
    expect(args[1]).toEqual({ connection: 'db', schema: 'main', table: 'users', column: 'id' });
  });

  it('preserves annotations that have no join (description-only) untouched', async () => {
    const idMap = assignCatalogIds(schema);
    const probe: JoinProbe = vi.fn();
    const result = await verifyJoinsMechanically(
      {
        annotations: [
          { id: 'c1', description: 'email address' },
        ],
      },
      idMap,
      probe,
    );
    expect(result.annotations).toHaveLength(1);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('renderGeneratedContext', () => {
  const schema: FlatColumn[] = [
    col('db', 'main', 'users', 'id'),               // c0
    col('db', 'main', 'users', 'email', 'VARCHAR'), // c1
    col('db', 'main', 'orders', 'user_id'),         // c2
  ];

  it('renders one Markdown block with table sections and column tables', () => {
    const idMap = assignCatalogIds(schema);
    const out = renderGeneratedContext(schema, idMap, new Map(), new Map(), { annotations: [] });
    expect(out).toContain('## db.main.users');
    expect(out).toContain('## db.main.orders');
    // Column rows present
    expect(out).toMatch(/\bid\b/);
    expect(out).toMatch(/\bemail\b/);
    expect(out).toMatch(/\buser_id\b/);
  });

  it('attaches column descriptions inline by id', () => {
    const idMap = assignCatalogIds(schema);
    const out = renderGeneratedContext(
      schema, idMap, new Map(), new Map(),
      {
        annotations: [
          { id: 'c1', description: 'User email address' },
        ],
      },
    );
    // The description appears in the email row.
    const lines = out.split('\n');
    const emailLine = lines.find((l) => /\bemail\b/.test(l) && l.includes('VARCHAR'));
    expect(emailLine).toBeDefined();
    expect(emailLine!).toContain('User email address');
  });

  it('renders verified joins with target reference (table.column form)', () => {
    const idMap = assignCatalogIds(schema);
    const out = renderGeneratedContext(
      schema, idMap, new Map(), new Map(),
      {
        annotations: [
          { id: 'c2', join: { to: 'c0' } }, // orders.user_id → users.id
        ],
      },
    );
    expect(out).toMatch(/user_id[^\n]*→[^\n]*users\.id/);
  });

  it('attaches table-level descriptions next to the table header', () => {
    const idMap = assignCatalogIds(schema);
    const tableId = idMap.byPath('db.main.users')!.id;
    const out = renderGeneratedContext(
      schema, idMap, new Map(), new Map(),
      { annotations: [{ id: tableId, description: 'User reference table' }] },
    );
    expect(out).toContain('User reference table');
  });

  it('renders stats from ColumnMeta', () => {
    const idMap = assignCatalogIds(schema);
    const stats = new Map<string, ColumnMeta>([
      ['db.main.users.email', { category: 'text', nDistinct: 4242, nullCount: 7 }],
    ]);
    const rows = new Map<string, number>([['db.main.users', 12345]]);
    const out = renderGeneratedContext(schema, idMap, stats, rows, { annotations: [] });
    expect(out).toContain('12345');
    expect(out).toContain('nDistinct=4242');
    expect(out).toContain('nullCount=7');
  });
});

describe('AutoContextAgent', () => {
  it('has SubmitSchemaInfo and ChainedExecuteQuery in its tools list', () => {
    const toolNames = AutoContextAgent.tools.map((t) => t.name);
    expect(toolNames).toContain(SubmitSchemaInfo.schema.name);
    expect(toolNames).toContain('ExecuteQuery'); // ChainedExecuteQuery's schema name
  });

  it('schema name is "AutoContextAgent"', () => {
    expect(AutoContextAgent.schema.name).toBe('AutoContextAgent');
  });

  it('has a bumped maxTokens callOption so the structured payload does not get truncated', () => {
    const opts = AutoContextAgent.callOptions as { maxTokens?: number } | undefined;
    expect(opts?.maxTokens).toBeDefined();
    expect(opts!.maxTokens!).toBeGreaterThanOrEqual(8192);
  });
});
