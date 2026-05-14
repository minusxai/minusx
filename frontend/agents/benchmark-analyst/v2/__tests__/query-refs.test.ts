import { interpolateRefs, interpolateMongoRefs, detectLowLimit } from '../query-refs';

describe('interpolateRefs (SQL)', () => {
  it('replaces $label.column with comma-separated values', () => {
    const labeled = new Map([['revenue', [{ id: 10 }, { id: 20 }, { id: 30 }]]]);
    const sql = 'SELECT * FROM products WHERE id IN ($revenue.id)';
    const result = interpolateRefs(sql, labeled);
    expect(result).toBe('SELECT * FROM products WHERE id IN (10, 20, 30)');
  });

  it('quotes string values with single quotes', () => {
    const labeled = new Map([['names', [{ name: 'Alice' }, { name: 'Bob' }]]]);
    const result = interpolateRefs('WHERE name IN ($names.name)', labeled);
    expect(result).toContain("'Alice'");
    expect(result).toContain("'Bob'");
  });

  it('escapes single quotes in string values', () => {
    const labeled = new Map([['data', [{ val: "O'Brien" }]]]);
    const result = interpolateRefs('WHERE name = $data.val', labeled);
    expect(result).toBe("WHERE name = 'O''Brien'");
  });

  it('returns NULL for unknown label', () => {
    const labeled = new Map<string, Record<string, unknown>[]>();
    const result = interpolateRefs('WHERE id IN ($unknown.id)', labeled);
    expect(result).toBe('WHERE id IN (NULL)');
  });

  it('returns NULL for empty rows', () => {
    const labeled = new Map([['empty', []]]);
    const result = interpolateRefs('WHERE id IN ($empty.id)', labeled);
    expect(result).toBe('WHERE id IN (NULL)');
  });

  it('returns NULL for missing column values', () => {
    const labeled = new Map([['data', [{ other: 1 }]]]);
    const result = interpolateRefs('WHERE id IN ($data.missing)', labeled);
    expect(result).toBe('WHERE id IN (NULL)');
  });

  it('handles multiple references', () => {
    const labeled = new Map([
      ['a', [{ x: 1 }, { x: 2 }]],
      ['b', [{ y: 'foo' }]],
    ]);
    const result = interpolateRefs('WHERE x IN ($a.x) AND y = $b.y', labeled);
    expect(result).toBe("WHERE x IN (1, 2) AND y = 'foo'");
  });
});

describe('interpolateMongoRefs', () => {
  it('replaces quoted "$label.column" token with JSON array', () => {
    const labeled = new Map([['revenue', [{ id: 10 }, { id: 20 }]]]);
    const json = '{"$match":{"id":{"$in":"$revenue.id"}}}';
    const result = interpolateMongoRefs(json, labeled);
    expect(result).toBe('{"$match":{"id":{"$in":[10,20]}}}');
    expect(JSON.parse(result)).toBeDefined(); // valid JSON
  });

  it('replaces unquoted $label.column (SQL habit)', () => {
    const labeled = new Map([['revenue', [{ id: 10 }]]]);
    const json = '{"$in":$revenue.id}';
    const result = interpolateMongoRefs(json, labeled);
    expect(result).toBe('{"$in":[10]}');
    expect(JSON.parse(result)).toBeDefined();
  });

  it('JSON-encodes string values', () => {
    const labeled = new Map([['cities', [{ name: 'NYC' }, { name: 'LA' }]]]);
    const result = interpolateMongoRefs('{"$in":"$cities.name"}', labeled);
    expect(result).toBe('{"$in":["NYC","LA"]}');
  });

  it('leaves unknown label untouched (Mongo field path)', () => {
    const labeled = new Map([['revenue', [{ id: 1 }]]]);
    const json = '{"$project":{"n":"$user.name"}}';
    expect(interpolateMongoRefs(json, labeled)).toBe(json);
  });

  it('interpolates missing column to []', () => {
    const labeled = new Map([['revenue', [{ id: 1 }]]]);
    const result = interpolateMongoRefs('{"$in":"$revenue.missing"}', labeled);
    expect(result).toBe('{"$in":[]}');
  });
});

describe('detectLowLimit', () => {
  describe('SQL', () => {
    it('returns limit if under 1000', () => {
      expect(detectLowLimit('SELECT * FROM t LIMIT 50', false)).toBe(50);
    });

    it('returns null if limit >= 1000', () => {
      expect(detectLowLimit('SELECT * FROM t LIMIT 1000', false)).toBeNull();
      expect(detectLowLimit('SELECT * FROM t LIMIT 5000', false)).toBeNull();
    });

    it('returns null if no LIMIT clause', () => {
      expect(detectLowLimit('SELECT * FROM t', false)).toBeNull();
    });

    it('is case insensitive', () => {
      expect(detectLowLimit('SELECT * FROM t limit 10', false)).toBe(10);
    });
  });

  describe('MongoDB', () => {
    it('returns limit if terminal $limit < 1000', () => {
      const pipeline = JSON.stringify({ collection: 'c', pipeline: [{ $sort: { x: 1 } }, { $limit: 50 }] });
      expect(detectLowLimit(pipeline, true)).toBe(50);
    });

    it('returns null if terminal $limit >= 1000', () => {
      const pipeline = JSON.stringify({ collection: 'c', pipeline: [{ $limit: 1000 }] });
      expect(detectLowLimit(pipeline, true)).toBeNull();
    });

    it('returns null if no $limit stage', () => {
      const pipeline = JSON.stringify({ collection: 'c', pipeline: [{ $match: {} }] });
      expect(detectLowLimit(pipeline, true)).toBeNull();
    });

    it('returns null on unparseable JSON', () => {
      expect(detectLowLimit('not json', true)).toBeNull();
    });

    it('returns null for empty pipeline', () => {
      const pipeline = JSON.stringify({ collection: 'c', pipeline: [] });
      expect(detectLowLimit(pipeline, true)).toBeNull();
    });
  });
});
