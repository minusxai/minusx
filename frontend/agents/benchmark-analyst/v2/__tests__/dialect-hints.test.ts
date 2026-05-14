import {
  DIALECT_HINTS,
  renderDialectHints,
  extractDialects,
} from '../dialect-hints';

describe('DIALECT_HINTS', () => {
  it('has hints for common dialects', () => {
    expect(DIALECT_HINTS.duckdb).toBeDefined();
    expect(DIALECT_HINTS.duckdb.hints.length).toBeGreaterThan(0);
    expect(DIALECT_HINTS.postgresql).toBeDefined();
    expect(DIALECT_HINTS.mongo).toBeDefined();
    expect(DIALECT_HINTS.bigquery).toBeDefined();
    expect(DIALECT_HINTS.sqlite).toBeDefined();
  });

  it('has meaningful hints for DuckDB', () => {
    const duckdbHints = DIALECT_HINTS.duckdb.hints.join(' ');
    expect(duckdbHints).toContain('jaro_winkler_similarity');
    expect(duckdbHints).toContain('SUMMARIZE');
  });

  it('has MongoDB-specific hints', () => {
    const mongoHints = DIALECT_HINTS.mongo.hints.join(' ');
    expect(mongoHints).toContain('aggregation pipeline');
    expect(mongoHints).toContain('$match');
    expect(mongoHints).toContain('$label.column');
  });
});

describe('renderDialectHints', () => {
  it('renders hints for present dialects only', () => {
    const hints = renderDialectHints(new Set(['duckdb', 'postgresql']));

    expect(hints).toContain('### DUCKDB');
    expect(hints).toContain('### POSTGRESQL');
    expect(hints).not.toContain('### MONGO');
    expect(hints).not.toContain('### BIGQUERY');
  });

  it('returns empty string for no dialects', () => {
    const hints = renderDialectHints(new Set());
    expect(hints).toBe('');
  });

  it('returns empty string for unknown dialects', () => {
    const hints = renderDialectHints(new Set(['unknowndialect']));
    expect(hints).toBe('');
  });

  it('includes section header', () => {
    const hints = renderDialectHints(new Set(['duckdb']));
    expect(hints).toContain('## Dialect-Specific Tips');
  });

  it('formats hints as bullet points', () => {
    const hints = renderDialectHints(new Set(['duckdb']));
    expect(hints).toMatch(/^## Dialect-Specific Tips\n\n### DUCKDB\n- /m);
  });
});

describe('extractDialects', () => {
  it('extracts unique dialects from connections', () => {
    const connections = [
      { dialect: 'duckdb' },
      { dialect: 'duckdb' },
      { dialect: 'postgresql' },
      { dialect: 'mongo' },
    ];

    const dialects = extractDialects(connections);

    expect(dialects.size).toBe(3);
    expect(dialects.has('duckdb')).toBe(true);
    expect(dialects.has('postgresql')).toBe(true);
    expect(dialects.has('mongo')).toBe(true);
  });

  it('returns empty set for empty connections', () => {
    const dialects = extractDialects([]);
    expect(dialects.size).toBe(0);
  });
});
