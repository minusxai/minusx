/**
 * The property that makes this worth having: a deployment can insert a coarser level
 * ahead of `mode` and no consumer changes, because consumers ask for a level by name
 * instead of assembling a path.
 */

import {
  buildNamespace,
  namespaced,
  namespacedChannel,
  DEFAULT_ISOLATION,
} from '@/lib/namespace/types';

describe('namespace levels', () => {
  it('joins coarse to fine with a single separator', () => {
    const ns = buildNamespace({ mode: 'org', userId: 42 });

    expect(ns.isolation).toBe('mx');
    expect(ns.mode).toBe('mx/org');
    expect(ns.user).toBe('mx/org/42');
  });

  it('inserting a coarser level shifts every level below it, and nothing else', () => {
    const single = buildNamespace({ mode: 'org', userId: 42 });
    const multi = buildNamespace({ isolation: '123', mode: 'org', userId: 42 });

    // Same shape, same relative structure — only the root differs.
    expect(single.user.split('/').length).toBe(multi.user.split('/').length);
    expect(multi.isolation).toBe('123');
    expect(multi.mode).toBe('123/org');
    expect(multi.user).toBe('123/org/42');
  });

  it('defaults the root to a non-empty value', () => {
    // An empty root would put a leading separator on every key, so each call site
    // would need its own emptiness check — exactly the per-site logic this removes.
    expect(buildNamespace({ mode: 'org', userId: 1 }).isolation).toBe(DEFAULT_ISOLATION);
    expect(namespaced(DEFAULT_ISOLATION, 'uploads/x.png')).not.toContain('//');
  });
});

describe('namespaced()', () => {
  it('prefixes without doubling separators', () => {
    expect(namespaced('mx/org', 'uploads/a.png')).toBe('mx/org/uploads/a.png');
    expect(namespaced('mx/org', '/uploads/a.png')).toBe('mx/org/uploads/a.png');
  });

  it('keeps object keys in path shape, so a store prefix stays a real prefix', () => {
    const key = namespaced(buildNamespace({ isolation: '123', mode: 'org', userId: 7 }).isolation,
      'csvs/tutorial/mxfood/orders.parquet');
    expect(key).toBe('123/csvs/tutorial/mxfood/orders.parquet');
    // A bucket policy on "123/" must match this and nothing outside it.
    expect(key.startsWith('123/')).toBe(true);
  });
});

describe('namespacedChannel()', () => {
  it('avoids separators that would need quoting in an identifier', () => {
    expect(namespacedChannel('123', 'conv_5')).toBe('ns123_conv_5');
    expect(namespacedChannel('mx', 'conv_5')).toBe('nsmx_conv_5');
  });

  it('sanitises anything that is not identifier-safe', () => {
    expect(namespacedChannel('mx/org', 'conv_5')).toBe('nsmx_org_conv_5');
    expect(namespacedChannel('a-b.c', 'x')).toBe('nsa_b_c_x');
  });

  it('never starts with a digit, whatever the isolation value is', () => {
    // An identifier beginning with a digit is a malformed numeric literal to Postgres,
    // so LISTEN throws and the stream silently never subscribes. A numeric isolation
    // value — a workspace id, say — hits this immediately.
    for (const isolation of ['1', '42', '0', '7abc']) {
      const channel = namespacedChannel(isolation, 'conv_7');
      expect(channel, `isolation=${isolation}`).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });

  it('still distinguishes isolations that differ only in digits', () => {
    expect(namespacedChannel('1', 'conv_7')).not.toBe(namespacedChannel('2', 'conv_7'));
  });
});
