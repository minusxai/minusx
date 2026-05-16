// Tests for V2BenchmarkAnalystAgent: tools, system prompt with dialect hints
import { describe, it, expect, vi } from 'vitest';
import { V2BenchmarkAnalystAgent } from '../v2-agent';
import { SearchDBSchemaV2 } from '../search-db-schema';
import { ExecuteQueryV2 } from '../execute-query';
import { ExploreV2 } from '../explore';
import { FetchHandleV2 } from '../fetch-handle';
import type { BenchmarkAnalystContext } from '../../types';

// Test helper to access protected getSystemPrompt
class TestableV2Agent extends V2BenchmarkAnalystAgent {
  public getPrompt(): string {
    return this.getSystemPrompt();
  }
}

describe('V2BenchmarkAnalystAgent', () => {
  describe('tools', () => {
    it('advertises exactly 4 tools', () => {
      expect(V2BenchmarkAnalystAgent.tools).toHaveLength(4);
    });

    it('includes SearchDBSchema (V2)', () => {
      const names = V2BenchmarkAnalystAgent.tools.map((t) => t.name);
      expect(names).toContain('SearchDBSchema');
    });

    it('includes ExecuteQuery (V2)', () => {
      const names = V2BenchmarkAnalystAgent.tools.map((t) => t.name);
      expect(names).toContain('ExecuteQuery');
    });

    it('includes Explore (V2)', () => {
      const names = V2BenchmarkAnalystAgent.tools.map((t) => t.name);
      expect(names).toContain('Explore');
    });

    it('includes fetchHandle', () => {
      const names = V2BenchmarkAnalystAgent.tools.map((t) => t.name);
      expect(names).toContain('fetchHandle');
    });

    it('does NOT include old tools (ListDBConnections, FuzzyMatch, ExploreDataset)', () => {
      const names = V2BenchmarkAnalystAgent.tools.map((t) => t.name);
      expect(names).not.toContain('ListDBConnections');
      expect(names).not.toContain('FuzzyMatch');
      expect(names).not.toContain('ExploreDataset');
    });
  });

  describe('schema', () => {
    it('has distinct schema name', () => {
      expect(V2BenchmarkAnalystAgent.schema.name).toBe('V2BenchmarkAnalystAgent');
    });
  });

  describe('system prompt', () => {
    it('renders dialect hints only for present dialects', () => {
      const ctx: BenchmarkAnalystContext = {
        connections: [
          { name: 'duck', dialect: 'duckdb', description: '', config: {} },
          { name: 'pg', dialect: 'postgresql', description: '', config: {} },
        ],
        contextDocs: '',
      };

      const agent = new TestableV2Agent(
        {} as never,
        { userMessage: 'test' },
        ctx,
        'test-id',
      );

      const prompt = agent.getPrompt();

      // Test the dialect-hints section specifically — the broader prompt may
      // legitimately mention other dialects in examples (e.g. the SQL→Mongo
      // sequential-mode example). What MUST be conditional is the
      // per-dialect rendering inside `## Dialect-Specific Features`.
      const hintsSection = prompt.split('## Dialect-Specific Features')[1]?.split('## Analysis Guidelines')[0] ?? '';

      expect(hintsSection).toContain('### DUCKDB');
      expect(hintsSection).toContain('### POSTGRESQL');
      expect(hintsSection).not.toContain('### MONGO');
      expect(hintsSection).not.toContain('### BIGQUERY');
    });

    it('includes mongo hints when mongo connection is present', () => {
      const ctx: BenchmarkAnalystContext = {
        connections: [
          { name: 'mongo_db', dialect: 'mongo', description: '', config: {} },
        ],
        contextDocs: '',
      };

      const agent = new TestableV2Agent(
        {} as never,
        { userMessage: 'test' },
        ctx,
        'test-id',
      );

      const prompt = agent.getPrompt();

      // Tighten the assertion to the dialect-hints section — the prompt
      // mentions mongo in examples unconditionally; what's conditional is
      // the `### MONGO` hint rendered from DIALECT_HINTS.
      const hintsSection = prompt.split('## Dialect-Specific Features')[1]?.split('## Analysis Guidelines')[0] ?? '';
      expect(hintsSection).toContain('### MONGO');
      expect(hintsSection).toContain('aggregation');
    });

    it('explains the handle model', () => {
      const ctx: BenchmarkAnalystContext = {
        connections: [
          { name: 'db', dialect: 'duckdb', description: '', config: {} },
        ],
        contextDocs: '',
      };

      const agent = new TestableV2Agent(
        {} as never,
        { userMessage: 'test' },
        ctx,
        'test-id',
      );

      const prompt = agent.getPrompt();

      expect(prompt).toContain('handle');
      expect(prompt).toContain('FROM handle_');
    });

    it('explains the catalog tables', () => {
      const ctx: BenchmarkAnalystContext = {
        connections: [
          { name: 'db', dialect: 'duckdb', description: '', config: {} },
        ],
        contextDocs: '',
      };

      const agent = new TestableV2Agent(
        {} as never,
        { userMessage: 'test' },
        ctx,
        'test-id',
      );

      const prompt = agent.getPrompt();

      expect(prompt).toContain('catalog');
      expect(prompt).toContain('connections');
      expect(prompt).toContain('tables');
      expect(prompt).toContain('columns');
      expect(prompt).toContain('column_stats');
    });

    it('explains sequential batches and $label.column', () => {
      const ctx: BenchmarkAnalystContext = {
        connections: [],
        contextDocs: '',
      };

      const agent = new TestableV2Agent(
        {} as never,
        { userMessage: 'test' },
        ctx,
        'test-id',
      );

      const prompt = agent.getPrompt();

      expect(prompt).toContain('sequential');
      expect(prompt).toContain('$label');
    });

    it('includes contextDocs in prompt', () => {
      const ctx: BenchmarkAnalystContext = {
        connections: [],
        contextDocs: '## Revenue Table\nContains daily revenue.',
      };

      const agent = new TestableV2Agent(
        {} as never,
        { userMessage: 'test' },
        ctx,
        'test-id',
      );

      const prompt = agent.getPrompt();

      expect(prompt).toContain('Revenue Table');
      expect(prompt).toContain('daily revenue');
    });
  });

  describe('model', () => {
    it('has a model configured', () => {
      expect(V2BenchmarkAnalystAgent.model).toBeDefined();
    });
  });
});
