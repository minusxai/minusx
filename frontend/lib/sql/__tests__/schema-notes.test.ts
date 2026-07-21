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

describe('getDocumentationForUser — Semantic Models projection', () => {
  const ordersModel = {
    name: 'Orders',
    description: 'Order-grain revenue model',
    connection: 'wh',
    primary: { kind: 'table' as const, schema: 'main', table: 'orders' },
    primaryKey: ['id'],
    references: [
      {
        source: { kind: 'table' as const, schema: 'main', table: 'customers' },
        alias: 'buyer',
        relationship: 'many_to_one' as const,
        on: [{ primaryColumn: 'customer_id', referencedColumn: 'id' }],
      },
      {
        source: { kind: 'table' as const, schema: 'main', table: 'tags' },
        alias: 'tags',
        relationship: 'many_to_many' as const,
        through: {
          source: { kind: 'table' as const, schema: 'main', table: 'order_tags' },
          primaryOn: [{ primaryColumn: 'id', bridgeColumn: 'order_id' }],
          referencedOn: [{ bridgeColumn: 'tag_id', referencedColumn: 'id' }],
        },
      },
    ],
    dimensions: [
      { name: 'Region', source: 'primary', column: 'region' },
      { name: 'Buyer Name', source: 'buyer', column: 'name' },
    ],
    measures: [
      { name: 'Revenue', agg: 'SUM' as const, column: 'amount' },
      { name: 'Orders Count', agg: 'COUNT' as const },
    ],
    metrics: [
      { name: 'AOV', type: 'ratio' as const, numerator: 'Revenue', denominator: 'Orders Count' },
      { name: 'Net Revenue', type: 'sql' as const, sql: 'SUM(primary.amount) - SUM(costs.total)' },
    ],
  };

  it('renders the live version\'s authored models compactly (name, primary, refs, dims, measures, metrics)', () => {
    const ctx = makeContext({ semanticModels: [ordersModel] } as never);
    const doc = getDocumentationForUser(ctx, 1)!;
    expect(doc).toContain('### Semantic Models');
    expect(doc).toContain('Semantic model "Orders" (connection wh, primary main.orders)');
    expect(doc).toContain('Order-grain revenue model');
    expect(doc).toContain('refs: buyer = many_to_one main.customers ON customer_id=id; tags = many_to_many main.tags THROUGH main.order_tags ON id=order_id, tag_id=id');
    expect(doc).toContain('dims: Region=region, Buyer Name=buyer.name');
    expect(doc).toContain('measures: Revenue=SUM(amount), Orders Count=COUNT(*)');
    expect(doc).toContain('metrics: AOV = Revenue / Orders Count, Net Revenue = SUM(primary.amount) - SUM(costs.total)');
  });

  it('includes inherited models (fullSemanticModels) alongside the live version\'s own', () => {
    const ctx = makeContext({ semanticModels: [ordersModel] } as never);
    ctx.fullSemanticModels = [{
      name: 'Users',
      connection: 'wh',
      primary: { kind: 'model', view: 'active_users' },
      dimensions: [{ name: 'Country', source: 'primary', column: 'country' }],
      measures: [{ name: 'Users', agg: 'COUNT_DISTINCT', column: 'user_id' }],
    }];
    const doc = getDocumentationForUser(ctx, 1)!;
    expect(doc).toContain('Semantic model "Users" (connection wh, primary _views.active_users)');
    expect(doc).toContain('measures: Users=COUNT_DISTINCT(user_id)');
    expect(doc).toContain('Semantic model "Orders"');
  });

  it('omits the section when no models exist, and Schema Notes appears for models alone', () => {
    expect(getDocumentationForUser(makeContext(), 1)!).not.toContain('Semantic Models');
    const modelsOnly = makeContext({ semanticModels: [ordersModel] } as never);
    const doc = getDocumentationForUser(modelsOnly, 1)!;
    expect(doc).toContain('## Schema Notes');
    expect(doc).toContain('### Semantic Models');
  });
});
