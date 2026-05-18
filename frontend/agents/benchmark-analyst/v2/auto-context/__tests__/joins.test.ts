/**
 * Tests for joins.ts — cross-table join discovery.
 *
 * The pure pieces (overlap computation, prefix stripping) are tested
 * directly; `discoverJoins` is tested with a mocked sample fetcher so
 * we don't need a live DB.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ColumnMeta } from '@/lib/connections/base';
import {
  computeOverlap,
  commonPrefix,
  proposeJoinCandidates,
  verifyJoin,
  discoverJoins,
} from '../joins';
import type { FlatColumn } from '../schema';

const col = (
  connection: string,
  schema: string,
  table: string,
  column: string,
  type: string,
): FlatColumn => ({ connection, schema, table, column, type });

const metaKey = (c: FlatColumn) => `${c.connection}.${c.schema}.${c.table}.${c.column}`;

describe('computeOverlap', () => {
  it('returns fraction of intersection over min size', () => {
    expect(computeOverlap(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c'])).toBe(1.0); // 3/3
    expect(computeOverlap(['a', 'b'], ['b', 'c'])).toBe(0.5); // 1/2
  });

  it('returns 0 on empty intersection', () => {
    expect(computeOverlap(['a', 'b'], ['x', 'y'])).toBe(0);
  });

  it('returns 0 when either side is empty', () => {
    expect(computeOverlap([], ['a'])).toBe(0);
    expect(computeOverlap(['a'], [])).toBe(0);
  });

  it('dedups within each side before computing', () => {
    expect(computeOverlap(['a', 'a', 'a'], ['a'])).toBe(1.0);
  });
});

describe('commonPrefix', () => {
  it('returns the longest common prefix shared by every value', () => {
    expect(commonPrefix(['businessid_1', 'businessid_2', 'businessid_3'])).toBe('businessid_');
    expect(commonPrefix(['abc', 'abd', 'abe'])).toBe('ab');
  });

  it('returns empty string when values diverge', () => {
    expect(commonPrefix(['alpha', 'beta'])).toBe('');
  });

  it('handles single-value and empty inputs', () => {
    expect(commonPrefix([])).toBe('');
    expect(commonPrefix(['solo'])).toBe('solo');
  });
});

describe('proposeJoinCandidates', () => {
  const usersId = col('db', 'public', 'users', 'id', 'INTEGER');
  const ordersUid = col('db', 'public', 'orders', 'user_id', 'INTEGER');
  const ordersAmt = col('db', 'public', 'orders', 'amount', 'NUMERIC');
  const ordersStatus = col('db', 'public', 'orders', 'status', 'VARCHAR');
  const ordersNote = col('db', 'public', 'orders', 'note', 'VARCHAR');
  const usersBool = col('db', 'public', 'users', 'active', 'BOOLEAN');
  const ordersBool = col('db', 'public', 'orders', 'paid', 'BOOLEAN');
  const usersTs = col('db', 'public', 'users', 'created_at', 'TIMESTAMP');
  const ordersTs = col('db', 'public', 'orders', 'created_at', 'TIMESTAMP');

  it('proposes same-type pairs of distinct columns', () => {
    const candidates = proposeJoinCandidates([usersId, ordersUid], new Map());
    expect(candidates).toHaveLength(1);
    expect(candidates[0][0].column + '↔' + candidates[0][1].column).toMatch(/id↔user_id|user_id↔id/);
  });

  it('rejects pairs of different types', () => {
    const candidates = proposeJoinCandidates([usersId, ordersAmt], new Map());
    expect(candidates).toHaveLength(0);
  });

  it('rejects bool and timestamp types entirely', () => {
    expect(proposeJoinCandidates([usersBool, ordersBool], new Map())).toHaveLength(0);
    expect(proposeJoinCandidates([usersTs, ordersTs], new Map())).toHaveLength(0);
  });

  it('rejects text-pairs with low nDistinct (status-enum joins)', () => {
    const stats = new Map<string, ColumnMeta>([
      [metaKey(ordersStatus), { category: 'categorical', nDistinct: 3 }],
      [metaKey(ordersNote), { category: 'categorical', nDistinct: 4 }],
    ]);
    expect(proposeJoinCandidates([ordersStatus, ordersNote], stats)).toHaveLength(0);
  });

  it('admits text-pairs with high nDistinct', () => {
    const a = col('db', 's', 't1', 'fk', 'VARCHAR');
    const b = col('db', 's', 't2', 'fk', 'VARCHAR');
    const stats = new Map<string, ColumnMeta>([
      [metaKey(a), { category: 'text', nDistinct: 1000 }],
      [metaKey(b), { category: 'text', nDistinct: 800 }],
    ]);
    expect(proposeJoinCandidates([a, b], stats)).toHaveLength(1);
  });

  it('admits text-pairs missing stats (defaults to candidate)', () => {
    const a = col('db', 's', 't1', 'fk', 'VARCHAR');
    const b = col('db', 's', 't2', 'fk', 'VARCHAR');
    expect(proposeJoinCandidates([a, b], new Map())).toHaveLength(1);
  });

  it('skips same-column-of-same-table (a column never joins to itself)', () => {
    expect(proposeJoinCandidates([usersId, usersId], new Map())).toHaveLength(0);
  });

  it('skips ALL same-table joins (within-table column overlap is never a meaningful FK)', () => {
    // Two distinct columns on the same table — engagement-counter shape.
    const usefulCol = col('db', 'public', 'users', 'useful', 'INTEGER');
    const funnyCol = col('db', 'public', 'users', 'funny', 'INTEGER');
    expect(proposeJoinCandidates([usefulCol, funnyCol], new Map())).toHaveLength(0);
  });

  it('rejects integer-pairs with low nDistinct (status / count noise)', () => {
    // Both sides have nDistinct=2 — booleans, status enums, etc.
    const isOpen = col('db', 's', 'business', 'is_open', 'INTEGER');
    const isActive = col('db', 's', 'review', 'is_active', 'INTEGER');
    const stats = new Map<string, ColumnMeta>([
      [metaKey(isOpen), { category: 'numeric', nDistinct: 2 }],
      [metaKey(isActive), { category: 'numeric', nDistinct: 2 }],
    ]);
    expect(proposeJoinCandidates([isOpen, isActive], stats)).toHaveLength(0);
  });

  it('admits integer-pairs whose BOTH sides have nDistinct > 100 (real surrogate-key FK shape)', () => {
    const userIdA = col('db', 's', 't1', 'user_id', 'INTEGER');
    const userIdB = col('db', 's', 't2', 'user_id', 'INTEGER');
    const stats = new Map<string, ColumnMeta>([
      [metaKey(userIdA), { category: 'numeric', nDistinct: 5000 }],
      [metaKey(userIdB), { category: 'numeric', nDistinct: 5000 }],
    ]);
    expect(proposeJoinCandidates([userIdA, userIdB], stats)).toHaveLength(1);
  });

  it('canonicalises pairs (each pair appears once, not twice)', () => {
    const candidates = proposeJoinCandidates([usersId, ordersUid], new Map());
    expect(candidates).toHaveLength(1);
  });
});

describe('verifyJoin', () => {
  const A = col('db', 's', 't1', 'a', 'VARCHAR');
  const B = col('db', 's', 't2', 'b', 'VARCHAR');

  it('returns "direct" when raw overlap is above threshold', () => {
    const result = verifyJoin(A, B, ['x1', 'x2', 'x3'], ['x1', 'x2', 'x9']);
    expect(result?.kind).toBe('direct');
    expect(result?.overlap).toBeGreaterThan(0.5);
  });

  it('returns null when raw overlap is below threshold and prefix-strip does not help', () => {
    expect(verifyJoin(A, B, ['x', 'y', 'z'], ['a', 'b', 'c'])).toBeNull();
  });

  it('detects prefix-mismatch FK after stripping common prefixes', () => {
    const result = verifyJoin(
      A,
      B,
      ['businessid_1', 'businessid_2', 'businessid_3'],
      ['businessref_1', 'businessref_2', 'businessref_3'],
    );
    expect(result?.kind).toBe('prefix-strip');
    expect(result?.overlap).toBe(1.0);
  });

  it('rejects narrative text via max-length guard', () => {
    const long = 'x'.repeat(300);
    expect(verifyJoin(A, B, [long, long + '1'], [long, long + '1'])).toBeNull();
  });

  it('passes max-length guard when values are short SHA-like strings', () => {
    const sha = (i: number) => `${i}`.padStart(40, 'a');
    expect(verifyJoin(A, B, [sha(1), sha(2)], [sha(1), sha(3)])?.kind).toBe('direct');
  });
});

describe('discoverJoins', () => {
  it('happy path — discovers a verified join', async () => {
    const filesId = col('db', 'public', 'files', 'id', 'VARCHAR');
    const contentsId = col('db', 'public', 'contents', 'id', 'VARCHAR');
    const fetch = vi.fn(async (c: FlatColumn) => {
      if (c.table === 'files') return ['sha1', 'sha2', 'sha3', 'sha4', 'sha5'];
      return ['sha1', 'sha2'];
    });

    const findings = await discoverJoins([filesId, contentsId], new Map(), fetch);
    expect(findings).toHaveLength(1);
    expect(findings[0].overlap).toBeGreaterThan(0.5);
    expect(findings[0].kind).toBe('direct');
  });

  it('deduplicates sample fetches per column', async () => {
    const a = col('db', 's', 't1', 'fk', 'VARCHAR');
    const b = col('db', 's', 't2', 'fk', 'VARCHAR');
    const c = col('db', 's', 't3', 'fk', 'VARCHAR');
    // 3 cols → 3 pairs (a-b, a-c, b-c); each column fetched only once.
    const fetch = vi.fn(async () => ['x1', 'x2', 'x3']);
    await discoverJoins([a, b, c], new Map(), fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('survives per-column fetch errors without crashing', async () => {
    const a = col('db', 's', 't1', 'a', 'VARCHAR');
    const b = col('db', 's', 't2', 'b', 'VARCHAR');
    const fetch = vi.fn(async (c: FlatColumn) => {
      if (c.table === 't1') throw new Error('connection blip');
      return ['x'];
    });
    const findings = await discoverJoins([a, b], new Map(), fetch);
    expect(findings).toHaveLength(0); // can't verify without samples
  });
});
