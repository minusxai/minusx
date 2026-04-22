import { getDatasetContextStatus } from '../dataset-context-status';

describe('getDatasetContextStatus', () => {
  it('returns not in context when whitelistedSchemas is undefined (no context exists)', () => {
    const result = getDatasetContextStatus('public', 10, undefined);
    expect(result).toEqual({
      inContext: false,
      totalTableCount: 10,
      fullyWhitelisted: false,
    });
  });

  it('returns not in context when whitelistedSchemas is empty (context exists but connection not whitelisted)', () => {
    const result = getDatasetContextStatus('public', 5, []);
    expect(result).toEqual({
      inContext: false,
      totalTableCount: 5,
      fullyWhitelisted: false,
    });
  });

  it('returns not in context when schema is not in the whitelist', () => {
    const result = getDatasetContextStatus('ships', 3, [
      { schema: 'public', tables: [{ table: 'users' }] },
    ]);
    expect(result).toEqual({
      inContext: false,
      totalTableCount: 3,
      fullyWhitelisted: false,
    });
  });

  it('returns in context + fully whitelisted when schema is whitelisted with no table filter', () => {
    // children: undefined at the schema level means all tables are exposed
    const result = getDatasetContextStatus('public', 10, [
      { schema: 'public', tables: [] },
    ]);
    expect(result).toEqual({
      inContext: true,
      whitelistedTableCount: 10,
      totalTableCount: 10,
      fullyWhitelisted: true,
    });
  });

  it('returns in context + fully whitelisted when schema has undefined tables', () => {
    const result = getDatasetContextStatus('public', 5, [
      { schema: 'public' },
    ]);
    expect(result).toEqual({
      inContext: true,
      whitelistedTableCount: 5,
      totalTableCount: 5,
      fullyWhitelisted: true,
    });
  });

  it('returns in context + fully whitelisted when all tables are whitelisted', () => {
    const result = getDatasetContextStatus('ships', 2, [
      { schema: 'ships', tables: [{ table: 'arrivals' }, { table: 'departures' }] },
    ]);
    expect(result).toEqual({
      inContext: true,
      whitelistedTableCount: 2,
      totalTableCount: 2,
      fullyWhitelisted: true,
    });
  });

  it('returns in context + partially whitelisted when some tables are whitelisted', () => {
    const result = getDatasetContextStatus('public', 10, [
      { schema: 'public', tables: [{ table: 'users' }, { table: 'orders' }] },
    ]);
    expect(result).toEqual({
      inContext: true,
      whitelistedTableCount: 2,
      totalTableCount: 10,
      fullyWhitelisted: false,
    });
  });

  it('handles multiple schemas and finds the correct one', () => {
    const whitelisted = [
      { schema: 'public', tables: [{ table: 'users' }] },
      { schema: 'ships', tables: [] },
      { schema: 'marketing', tables: [{ table: 'campaigns' }, { table: 'spend' }] },
    ];

    const publicResult = getDatasetContextStatus('public', 35, whitelisted);
    expect(publicResult.inContext).toBe(true);
    expect(publicResult.fullyWhitelisted).toBe(false);
    expect(publicResult.whitelistedTableCount).toBe(1);

    const shipsResult = getDatasetContextStatus('ships', 1, whitelisted);
    expect(shipsResult.inContext).toBe(true);
    expect(shipsResult.fullyWhitelisted).toBe(true);

    const marketingResult = getDatasetContextStatus('marketing', 2, whitelisted);
    expect(marketingResult.inContext).toBe(true);
    expect(marketingResult.fullyWhitelisted).toBe(true);
    expect(marketingResult.whitelistedTableCount).toBe(2);

    const missingResult = getDatasetContextStatus('analytics', 5, whitelisted);
    expect(missingResult.inContext).toBe(false);
  });
});
