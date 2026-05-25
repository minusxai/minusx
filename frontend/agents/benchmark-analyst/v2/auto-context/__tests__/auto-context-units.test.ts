// AUTO-MERGED test file (see git history for the original per-feature files).
// Merged to amortize the per-file module-import cost across one harness load.

import type { CatalogTables } from '../../catalog';
import { AutoContextAgent, SubmitSchemaInfo, assignCatalogIds, parseAnnotations, renderCatalogForAgent, renderGeneratedContext, verifyJoinsMechanically } from '../auto-context';
import type { JoinProbe } from '../auto-context';
import { fetchTableSample, pickDiverseRows } from '../samples';
import { flattenCatalogColumns } from '../schema';
import type { FlatColumn } from '../schema';
import { DEFAULT_MAX_VALUE_CHARS, truncateRow, truncateValue, truncateValues } from '../truncate';
import type { ColumnMeta, NodeConnector, QueryResult } from '@/lib/connections/base';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { ConversationLogEntry } from '@/orchestrator/types';
import { validateParameters } from '@/orchestrator/utils';

describe('auto-context', () => {
/**
 * Tests for the consolidated `auto-context.ts` module. Slices are added as
 * the module is built (TDD). Initial slice: ID assignment over a catalog
 * schema.
 */








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

  // ── Graded degradation: shed stats before dropping any table ──────────
  // The input's job is to let the agent SEE every table/column so it can
  // annotate the whole schema. Dropping a table blinds the agent to it
  // permanently, so stats (top values first, then the rest) are shed
  // before any table is dropped.

  const verboseStats = (schema: FlatColumn[]): Map<string, ColumnMeta> => {
    const longTop = Array.from({ length: 5 }, (_, i) => ({
      value: `TOPVAL_${'x'.repeat(40)}_${i}`, count: 1, fraction: 0.1,
    }));
    return new Map(schema.map((c) => [
      colKey(c),
      { category: 'text', nDistinct: 10, nullCount: 2, topValues: longTop } as ColumnMeta,
    ]));
  };

  it('sheds top values before dropping tables — all tables kept, top values gone, nDistinct kept', () => {
    const schema = ['t0', 't1', 't2'].map((t) => col('db', 's', t, 'c', 'VARCHAR'));
    const idMap = assignCatalogIds(schema);
    const stats = verboseStats(schema);
    // Budget too small for full (verbose top values) but ample for the
    // no-top render of all three tables.
    const out = renderCatalogForAgent(schema, idMap, stats, new Map(), 300);
    expect(out).toContain('t0');
    expect(out).toContain('t1');
    expect(out).toContain('t2');
    expect(out).not.toContain('TOPVAL_');     // top values shed
    expect(out).toContain('nDistinct=10');    // cheaper stats retained
    expect(out).not.toMatch(/Note:/);         // no table dropped
  });

  it('sheds ALL stats before dropping tables when no-top still overflows', () => {
    const schema = ['t0', 't1', 't2'].map((t) => col('db', 's', t, 'c', 'VARCHAR'));
    const idMap = assignCatalogIds(schema);
    const stats = verboseStats(schema);
    // Budget fits the bare skeleton of all three but not the no-top stats.
    const out = renderCatalogForAgent(schema, idMap, stats, new Map(), 130);
    expect(out).toContain('t0');
    expect(out).toContain('t1');
    expect(out).toContain('t2');
    expect(out).not.toContain('TOPVAL_');
    expect(out).not.toContain('nDistinct');   // all stats shed
    expect(out).toContain('VARCHAR');         // structure (names+types) kept
    expect(out).not.toMatch(/Note:/);
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

  // ── Graded degradation (output): annotations are the irrecoverable value ──
  // Descriptions + verified joins are what AutoContext spent an LLM call to
  // produce; the analyst can re-derive stats and column lists via
  // SearchDBSchema/ExecuteQuery. So under budget pressure we shed stats,
  // then unannotated columns, then whole tables — annotations survive last.

  const bigSchema: FlatColumn[] = [
    col('db', 'main', 'users', 'id'),
    col('db', 'main', 'users', 'email', 'VARCHAR'),
    ...Array.from({ length: 20 }, (_, i) => col('db', 'main', 'users', `f${i}`, 'VARCHAR')),
    col('db', 'main', 'orders', 'user_id'),
    col('db', 'main', 'logs', 'lg0', 'VARCHAR'),
    col('db', 'main', 'logs', 'lg1', 'VARCHAR'),
    col('db', 'main', 'logs', 'lg2', 'VARCHAR'),
  ];
  const bigIdMap = assignCatalogIds(bigSchema);
  const verboseStats = (s: FlatColumn[]): Map<string, ColumnMeta> =>
    new Map(s.map((c) => [
      colKey(c),
      {
        category: 'text', nDistinct: 10, nullCount: 2,
        topValues: Array.from({ length: 5 }, (_, i) => ({
          value: `TOP_${'y'.repeat(40)}_${i}`, count: 1, fraction: 0.1,
        })),
      } as ColumnMeta,
    ]));
  const bigPayload = {
    annotations: [
      { id: bigIdMap.byPath('db.main.users.email')!.id, description: 'User email address' },
      { id: bigIdMap.byPath('db.main.orders.user_id')!.id, join: { to: bigIdMap.byPath('db.main.users.id')!.id } },
    ],
  };

  it('sheds the stats column first, keeping every column plus descriptions and joins', () => {
    const out = renderGeneratedContext(bigSchema, bigIdMap, verboseStats(bigSchema), new Map(), bigPayload, 2500);
    expect(out).toContain('User email address');
    expect(out).toMatch(/user_id[^\n]*→[^\n]*users\.id/);
    expect(out).not.toContain('nDistinct'); // stats column shed
    expect(out).toContain('f19');           // every column still listed
    expect(out).not.toMatch(/Note:/);
  });

  it('keeps only annotated columns and collapses the rest when no-stats still overflows', () => {
    const out = renderGeneratedContext(bigSchema, bigIdMap, verboseStats(bigSchema), new Map(), bigPayload, 500);
    expect(out).toContain('User email address');                 // annotated col kept
    expect(out).toMatch(/user_id[^\n]*→[^\n]*users\.id/);         // verified join kept
    expect(out).not.toContain('f19');                            // unannotated collapsed
    expect(out).toContain('SearchDBSchema');                     // recovery hint
    expect(out).not.toMatch(/Note:/);
  });

  it('drops trailing tables with a recovery note when even the essential tier overflows', () => {
    const out = renderGeneratedContext(bigSchema, bigIdMap, verboseStats(bigSchema), new Map(), bigPayload, 120);
    expect(out).toMatch(/Note:/);
    expect(out).toContain('SearchDBSchema');
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
});

describe('samples', () => {
/**
 * Tests for samples.ts — pulling representative rows from a table and
 * narrowing them down to a length-diverse subset that surfaces format
 * variants in narrative text columns.
 *
 * `pickDiverseRows` is pure (sort + index pick); `fetchTableSample` is
 * exercised against a mocked NodeConnector.
 */





const row = (
  id: number,
  description: string,
  status: string = 'active',
): Record<string, unknown> => ({ id, description, status });

const qr = (rows: Record<string, unknown>[]): QueryResult => ({
  columns: Object.keys(rows[0] ?? {}),
  types: Object.keys(rows[0] ?? {}).map(() => 'TEXT'),
  rows,
  finalQuery: '<test>',
});

describe('pickDiverseRows', () => {
  it('returns the whole pool when pool size is <= n', () => {
    const pool = [row(1, 'a'), row(2, 'b')];
    expect(pickDiverseRows(pool, 5, ['description'])).toEqual(pool);
  });

  it('returns n random-ordered rows when no text columns are flagged', () => {
    const pool = [row(1, 'a'), row(2, 'bb'), row(3, 'ccc'), row(4, 'dddd'), row(5, 'eeeee')];
    expect(pickDiverseRows(pool, 3, [])).toHaveLength(3);
  });

  it('picks rows that span the length range of the flagged column', () => {
    // Description lengths: 1, 5, 50, 200, 400. Asking for 3 → should cover the extremes.
    const pool = [
      row(1, 'x'),
      row(2, 'small'),
      row(3, 'a'.repeat(50)),
      row(4, 'a'.repeat(200)),
      row(5, 'a'.repeat(400)),
    ];
    const out = pickDiverseRows(pool, 3, ['description']);
    expect(out).toHaveLength(3);

    const lengths = out
      .map((r) => (typeof r.description === 'string' ? r.description.length : 0))
      .sort((a, b) => a - b);
    // The shortest and longest must both be represented in a length-stratified pick.
    expect(lengths[0]).toBe(1);
    expect(lengths[lengths.length - 1]).toBe(400);
  });

  it('handles missing values in the flagged column gracefully', () => {
    const pool = [{ id: 1 }, row(2, 'b'), row(3, 'ccc')];
    expect(pickDiverseRows(pool, 2, ['description'])).toHaveLength(2);
  });

  it('returns empty array when pool is empty', () => {
    expect(pickDiverseRows([], 5, ['description'])).toEqual([]);
  });
});

describe('fetchTableSample', () => {
  const fakeConn = (rows: Record<string, unknown>[]): NodeConnector =>
    ({
      query: vi.fn(async () => qr(rows)),
    }) as unknown as NodeConnector;

  it('returns rows from the connector via dialect-correct sampling SQL', async () => {
    const rows = [row(1, 'short'), row(2, 'longer description here')];
    const conn = fakeConn(rows);
    const out = await fetchTableSample(conn, 'public', 'orders', 'duckdb', [], { sampleSize: 2 });
    expect(out).toEqual(rows);
  });

  it('issues a $sample pipeline for mongo connections', async () => {
    const conn = fakeConn([row(1, 'x')]);
    await fetchTableSample(conn, 'mydb', 'users', 'mongo', [], { sampleSize: 1 });
    const queryArg = (conn.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const parsed = JSON.parse(queryArg);
    expect(parsed.collection).toBe('users');
    expect(parsed.pipeline?.[0]?.$sample).toBeDefined();
  });

  it('narrows down the supersample to the requested size when text columns are flagged', async () => {
    // Connector returns 20 rows; we ask for 5 with one text column flagged.
    const big = Array.from({ length: 20 }, (_, i) => row(i, 'x'.repeat((i + 1) * 3)));
    const conn = fakeConn(big);
    const out = await fetchTableSample(conn, 'public', 'docs', 'duckdb', ['description'], {
      sampleSize: 5,
      superSampleSize: 20,
    });
    expect(out).toHaveLength(5);
  });

  it('returns empty array on connector errors', async () => {
    const conn = {
      query: vi.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as NodeConnector;
    expect(await fetchTableSample(conn, 'public', 't', 'duckdb', [])).toEqual([]);
  });
});
});

describe('schema', () => {
/**
 * Tests for schema.ts — the flat-schema projection over the catalog.
 *
 * `flattenCatalogColumns` is pure (no DB, no async). It projects the
 * `catalog.columns` rows into `FlatColumn[]` and is the cheap on-ramp the
 * filter step uses to decide whether to filter on the user question.
 */





function makeCatalog(columnsRows: Record<string, unknown>[]): CatalogTables {
  const empty = { columns: [], types: [], rows: [] };
  return {
    connections: empty,
    schemas: empty,
    tables: empty,
    columns: {
      columns: ['connection_name', 'schema_name', 'table_name', 'column_name', 'data_type'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR'],
      rows: columnsRows,
    },
    indexes: empty,
    column_stats: empty,
    sample_rows: empty,
    sample_notes: empty,
  };
}

describe('flattenCatalogColumns', () => {
  it('projects catalog.columns rows into a flat FlatColumn list', () => {
    const catalog = makeCatalog([
      { connection_name: 'db', schema_name: 'public', table_name: 'users', column_name: 'id', data_type: 'INTEGER' },
      { connection_name: 'db', schema_name: 'public', table_name: 'users', column_name: 'email', data_type: 'VARCHAR' },
      { connection_name: 'db', schema_name: 'public', table_name: 'orders', column_name: 'total', data_type: 'NUMERIC' },
    ]);

    expect(flattenCatalogColumns(catalog)).toEqual([
      { connection: 'db', schema: 'public', table: 'users', column: 'id', type: 'INTEGER' },
      { connection: 'db', schema: 'public', table: 'users', column: 'email', type: 'VARCHAR' },
      { connection: 'db', schema: 'public', table: 'orders', column: 'total', type: 'NUMERIC' },
    ]);
  });

  it('preserves the order of catalog.columns.rows', () => {
    const catalog = makeCatalog([
      { connection_name: 'db', schema_name: 's', table_name: 't', column_name: 'a', data_type: 'X' },
      { connection_name: 'db', schema_name: 's', table_name: 't', column_name: 'b', data_type: 'Y' },
    ]);

    const out = flattenCatalogColumns(catalog);
    expect(out.map((c) => c.column)).toEqual(['a', 'b']);
  });

  it('returns an empty array when no columns are present', () => {
    expect(flattenCatalogColumns(makeCatalog([]))).toEqual([]);
  });

  it('handles multiple connections + schemas in the same catalog', () => {
    const catalog = makeCatalog([
      { connection_name: 'primary', schema_name: 'public', table_name: 'users', column_name: 'id', data_type: 'INTEGER' },
      { connection_name: 'archive', schema_name: 'historic', table_name: 'logs', column_name: 'ts', data_type: 'TIMESTAMP' },
    ]);

    const out = flattenCatalogColumns(catalog);
    expect(out).toHaveLength(2);
    expect(out[0].connection).toBe('primary');
    expect(out[1].connection).toBe('archive');
    expect(out[1].schema).toBe('historic');
  });
});
});

describe('truncate', () => {
/**
 * Tests for truncate.ts — the per-value cap that prevents blob-heavy
 * columns (README content, commit messages, narrative descriptions)
 * from blowing past the lighter-model's context window when AutoContext
 * serialises sample rows into its LLM prompts.
 */




describe('truncateValue', () => {
  it('passes short strings through unchanged', () => {
    expect(truncateValue('hello')).toBe('hello');
  });

  it('passes non-string values through unchanged', () => {
    expect(truncateValue(42)).toBe(42);
    expect(truncateValue(true)).toBe(true);
    expect(truncateValue(null)).toBeNull();
    expect(truncateValue(undefined)).toBeUndefined();
    expect(truncateValue({ a: 1 })).toEqual({ a: 1 });
  });

  it('truncates strings longer than the cap and appends a size marker', () => {
    const big = 'x'.repeat(DEFAULT_MAX_VALUE_CHARS + 1000);
    const out = truncateValue(big);
    expect(typeof out).toBe('string');
    const s = out as string;
    expect(s.length).toBeLessThan(big.length);
    expect(s.startsWith('x'.repeat(DEFAULT_MAX_VALUE_CHARS))).toBe(true);
    expect(s).toMatch(/\+1000 more chars/);
  });

  it('honours a custom maxChars limit', () => {
    const out = truncateValue('abcdefghij', 4) as string;
    expect(out).toMatch(/^abcd…<\+6 more chars>$/);
  });
});

describe('truncateRow', () => {
  it('truncates only the long string fields in a row', () => {
    const row = {
      id: 1,
      name: 'short name',
      content: 'x'.repeat(DEFAULT_MAX_VALUE_CHARS + 500),
      tag: null,
    };
    const out = truncateRow(row);
    expect(out.id).toBe(1);
    expect(out.name).toBe('short name');
    expect(out.tag).toBeNull();
    expect((out.content as string).length).toBeLessThan((row.content as string).length);
  });
});

describe('truncateValues', () => {
  it('returns the array with each element individually truncated', () => {
    const arr = ['short', 'x'.repeat(DEFAULT_MAX_VALUE_CHARS + 100), 42];
    const out = truncateValues(arr);
    expect(out[0]).toBe('short');
    expect(typeof out[1]).toBe('string');
    expect((out[1] as string).length).toBeLessThan((arr[1] as string).length);
    expect(out[2]).toBe(42);
  });
});
});
