/**
 * mergeWhitelist — union semantics for the onboarding wizard.
 *
 * The wizard used to OVERWRITE a context's whitelist when a new dataset was added,
 * which silently narrowed access and broke every dashboard built on the other
 * connections/schemas. Merging must only ever EXPAND access, never remove it.
 */
import { describe, it, expect } from 'vitest';
import { mergeWhitelist } from '../context-utils';
import type { WhitelistNode } from '@/lib/types';

const conn = (name: string, children?: WhitelistNode[]): WhitelistNode => ({
  name, type: 'connection', children,
});
const schema = (name: string, children?: WhitelistNode[]): WhitelistNode => ({
  name, type: 'schema', children,
});
const table = (name: string): WhitelistNode => ({ name, type: 'table' });

describe('mergeWhitelist', () => {
  it("keeps '*' as '*' (everything already exposed — never narrow)", () => {
    const incoming = [conn('static', [schema('new_data')])];
    expect(mergeWhitelist('*', incoming)).toBe('*');
  });

  it('appends a brand-new connection node, preserving existing connections', () => {
    const existing = [conn('warehouse', [schema('analytics')])];
    const incoming = [conn('static', [schema('new_csv')])];
    const result = mergeWhitelist(existing, incoming);
    expect(result).toEqual([
      conn('warehouse', [schema('analytics')]),
      conn('static', [schema('new_csv')]),
    ]);
  });

  it('unions schemas within the same connection (existing schema preserved)', () => {
    const existing = [conn('static', [schema('dataset_a')])];
    const incoming = [conn('static', [schema('dataset_b')])];
    const result = mergeWhitelist(existing, incoming);
    expect(result).toEqual([conn('static', [schema('dataset_a'), schema('dataset_b')])]);
  });

  it('undefined children (expose-all) wins over a restricted list', () => {
    const existing = [conn('static', undefined)]; // expose all of static
    const incoming = [conn('static', [schema('dataset_b')])];
    const result = mergeWhitelist(existing, incoming);
    expect(result).toEqual([conn('static', undefined)]);
  });

  it('unions table children within a shared schema', () => {
    const existing = [conn('static', [schema('data', [table('sales')])])];
    const incoming = [conn('static', [schema('data', [table('orders')])])];
    const result = mergeWhitelist(existing, incoming);
    expect(result).toEqual([
      conn('static', [schema('data', [table('sales'), table('orders')])]),
    ]);
  });

  it('expose-all schema wins over a table-restricted one', () => {
    const existing = [conn('static', [schema('data', undefined)])];
    const incoming = [conn('static', [schema('data', [table('orders')])])];
    const result = mergeWhitelist(existing, incoming);
    expect(result).toEqual([conn('static', [schema('data', undefined)])]);
  });
});
