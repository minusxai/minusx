import { V2BenchmarkAnalystAgent } from '../v2-agent';
import { SearchDBSchemaV2 } from '../search-db-schema';
import { ExecuteQueryV2 } from '../execute-query';
import { Explore } from '../explore';
import { FetchHandle } from '../fetch-handle';

describe('V2BenchmarkAnalystAgent', () => {
  it('has distinct schema name', () => {
    expect(V2BenchmarkAnalystAgent.schema.name).toBe('V2BenchmarkAnalystAgent');
    expect(V2BenchmarkAnalystAgent.schema.description).toContain('V2');
    expect(V2BenchmarkAnalystAgent.schema.description).toContain('handle-based');
  });

  it('advertises exactly 4 tools', () => {
    expect(V2BenchmarkAnalystAgent.tools).toHaveLength(4);
  });

  it('includes SearchDBSchema tool', () => {
    const tool = V2BenchmarkAnalystAgent.tools.find(t => t.name === 'SearchDBSchema');
    expect(tool).toBeDefined();
    expect(tool).toBe(SearchDBSchemaV2.schema);
  });

  it('includes ExecuteQuery tool', () => {
    const tool = V2BenchmarkAnalystAgent.tools.find(t => t.name === 'ExecuteQuery');
    expect(tool).toBeDefined();
    expect(tool).toBe(ExecuteQueryV2.schema);
  });

  it('includes Explore tool', () => {
    const tool = V2BenchmarkAnalystAgent.tools.find(t => t.name === 'Explore');
    expect(tool).toBeDefined();
    expect(tool).toBe(Explore.schema);
  });

  it('includes fetchHandle tool', () => {
    const tool = V2BenchmarkAnalystAgent.tools.find(t => t.name === 'fetchHandle');
    expect(tool).toBeDefined();
    expect(tool).toBe(FetchHandle.schema);
  });

  it('has userMessage parameter', () => {
    const { parameters } = V2BenchmarkAnalystAgent.schema;
    expect(parameters).toBeDefined();
    // Check that it has userMessage property
    expect((parameters as unknown as { properties: Record<string, unknown> }).properties.userMessage).toBeDefined();
  });
});

describe('V2 Tool schemas', () => {
  describe('SearchDBSchemaV2', () => {
    it('has correct name', () => {
      expect(SearchDBSchemaV2.schema.name).toBe('SearchDBSchema');
    });

    it('describes catalog tables', () => {
      const desc = SearchDBSchemaV2.schema.description;
      expect(desc).toContain('connections');
      expect(desc).toContain('tables');
      expect(desc).toContain('columns');
      expect(desc).toContain('indexes');
      expect(desc).toContain('column_stats');
    });

    it('has queries parameter', () => {
      const params = SearchDBSchemaV2.schema.parameters as unknown as { properties: Record<string, unknown> };
      expect(params.properties.queries).toBeDefined();
    });
  });

  describe('ExecuteQueryV2', () => {
    it('has correct name', () => {
      expect(ExecuteQueryV2.schema.name).toBe('ExecuteQuery');
    });

    it('describes handle-based results', () => {
      const desc = ExecuteQueryV2.schema.description;
      expect(desc).toContain('handle');
      expect(desc).toContain('fetchHandle');
    });

    it('describes sequential mode', () => {
      const desc = ExecuteQueryV2.schema.description;
      expect(desc).toContain('sequential');
      expect(desc).toContain('$label');
    });
  });

  describe('Explore', () => {
    it('has correct name', () => {
      expect(Explore.schema.name).toBe('Explore');
    });

    it('describes cross-table search', () => {
      const desc = Explore.schema.description;
      expect(desc).toContain("don't know");
      expect(desc).toContain('table');
    });

    it('has filter parameter with match', () => {
      const params = Explore.schema.parameters as unknown as { properties: Record<string, { properties: Record<string, unknown> }> };
      expect(params.properties.filter).toBeDefined();
    });
  });

  describe('FetchHandle', () => {
    it('has correct name', () => {
      expect(FetchHandle.schema.name).toBe('fetchHandle');
    });

    it('describes pagination', () => {
      const desc = FetchHandle.schema.description;
      expect(desc).toContain('paginate');
    });

    it('has handle, offset, length parameters', () => {
      const params = FetchHandle.schema.parameters as unknown as { properties: Record<string, unknown> };
      expect(params.properties.handle).toBeDefined();
      expect(params.properties.offset).toBeDefined();
      expect(params.properties.length).toBeDefined();
    });
  });
});
