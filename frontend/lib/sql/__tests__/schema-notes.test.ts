import { describe, it, expect } from 'vitest';
import { getDocumentationForUser } from '../context-docs';
import type { ContextContent, ContextVersion } from '@/lib/types';

/** Minimal context with one published version carrying docs, annotations, and metrics. */
function makeContext(overrides: Partial<ContextVersion> = {}): ContextContent {
  return {
    published: { all: 1 },
    versions: [
      {
        version: 1,
        whitelist: '*',
        docs: [{ content: 'Some narrative docs.' }],
        createdAt: '2026-01-01',
        createdBy: 1,
        ...overrides,
      },
    ],
  } as ContextContent;
}

describe('getDocumentationForUser — Schema Notes', () => {
  it('appends table/column descriptions and metrics for the agent', () => {
    const ctx = makeContext({
      annotations: [
        { schema: 'public', table: 'orders', description: 'Customer orders', columns: [{ name: 'amount', description: 'Order total in USD' }] },
      ],
      metrics: [
        { name: 'Monthly Revenue', schema: 'public', table: 'orders', description: 'Completed-order revenue per month', sql: 'SELECT sum(amount) FROM orders' },
      ],
    });

    const doc = getDocumentationForUser(ctx, 1)!;
    expect(doc).toContain('Some narrative docs.');
    expect(doc).toContain('## Schema Notes');
    expect(doc).toContain('- public.orders — Customer orders');
    expect(doc).toContain('- amount: Order total in USD');
    expect(doc).toContain('### Metrics');
    expect(doc).toContain('- Monthly Revenue [public.orders] — Completed-order revenue per month');
    expect(doc).toContain('SELECT sum(amount) FROM orders');
  });

  it('omits the Schema Notes section when there are no annotations or metrics', () => {
    const doc = getDocumentationForUser(makeContext(), 1)!;
    expect(doc).toContain('Some narrative docs.');
    expect(doc).not.toContain('Schema Notes');
  });

  it('includes inherited annotations + metrics (fullAnnotations / fullMetrics)', () => {
    const ctx = makeContext();
    ctx.fullAnnotations = [{ schema: 'public', table: 'users', description: 'App users' }];
    ctx.fullMetrics = [{ name: 'Active Users', schema: 'public', table: 'users' }];

    const doc = getDocumentationForUser(ctx, 1)!;
    expect(doc).toContain('- public.users — App users');
    expect(doc).toContain('- Active Users [public.users]');
  });
});
