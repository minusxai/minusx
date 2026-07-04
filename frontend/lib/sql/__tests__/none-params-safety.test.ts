/**
 * Param-NAME safety. `applyNoneParams` builds `new RegExp(':' + name)` from raw param keys, and
 * guests control those keys on public pages — a crafted key was a regex-injection / catastrophic-
 * backtracking (ReDoS) vector, and an over-broad pattern could corrupt the allowlisted SQL.
 * Param names must be validated as identifiers (`/^[A-Za-z_][A-Za-z0-9_]*$/`) and anything else
 * DROPPED before any regex is constructed. Values were always bound; this is purely about names.
 */
import { describe, it, expect } from 'vitest';
import { applyNoneParams, isValidParamName } from '@/lib/sql/none-params';
import { sanitizeGuestParams } from '@/lib/query-cache/guest-query.server';

describe('isValidParamName', () => {
  it('accepts identifier-shaped names', () => {
    for (const name of ['a', 'start_date', '_x', 'A9', 'camelCase']) {
      expect(isValidParamName(name), name).toBe(true);
    }
  });
  it('rejects regex metacharacters and non-identifiers', () => {
    for (const name of ['(a+)+', '.*', 'a b', 'a-b', '9lives', '', 'x\\b|y', 'a$', ':a']) {
      expect(isValidParamName(name), name).toBe(false);
    }
  });
});

describe('applyNoneParams — hostile param names', () => {
  it('drops a regex-metachar param name instead of building a RegExp from it', async () => {
    const { sql, params } = await applyNoneParams(
      'SELECT * FROM t WHERE a >= :min',
      { min: 5, '(a+)+$': null, '.*': null },
      'postgres',
    );
    expect(sql).toContain(':min'); // untouched — hostile keys never became patterns
    expect(params).toEqual({ min: 5 });
  });

  it('does not hang on a catastrophic-backtracking-shaped name (ReDoS guard)', async () => {
    const start = Date.now();
    await applyNoneParams(
      `SELECT * FROM t WHERE x = '${'a'.repeat(80)}'`,
      { ['(a+)+b']: null },
      'postgres',
    );
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('still substitutes NULL for a VALID None param name', async () => {
    const { sql, params } = await applyNoneParams(
      'SELECT :tag AS tag FROM t',
      { tag: null },
      'postgres',
    );
    expect(sql).toContain('NULL');
    expect(sql).not.toContain(':tag');
    expect(params).toEqual({});
  });

  it('drops invalid-named params with real values too (they cannot bind to any :token)', async () => {
    const { params } = await applyNoneParams(
      'SELECT * FROM t WHERE a >= :min',
      { min: 5, 'a b': 'x' },
      'postgres',
    );
    expect(params).toEqual({ min: 5 });
  });
});

describe('sanitizeGuestParams — hostile names dropped at the guest boundary', () => {
  it('keeps valid names, drops invalid ones', () => {
    expect(sanitizeGuestParams({ region: 'west', '(a+)+': 'x', '.*': null, n: 3 }))
      .toEqual({ region: 'west', n: 3 });
  });
});
