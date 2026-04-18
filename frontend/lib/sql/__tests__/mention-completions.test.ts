/**
 * Tests for getMentionCompletionsLocal.
 * Ported from Python get_mention_completions in backend/sql_utils/autocomplete.py.
 */
import { getMentionCompletionsLocal, type AvailableQuestion } from '../mention-completions';
import type { DatabaseWithSchema } from '@/lib/types';

const schemaData: DatabaseWithSchema[] = [
  {
    databaseName: 'test_db',
    schemas: [
      {
        schema: 'public',
        tables: [
          { table: 'users', columns: [{ name: 'id', type: 'int' }] },
          { table: 'orders', columns: [{ name: 'id', type: 'int' }] },
          { table: 'user_events', columns: [{ name: 'id', type: 'int' }] },
        ],
      },
      {
        schema: 'analytics',
        tables: [
          { table: 'events', columns: [{ name: 'id', type: 'int' }] },
        ],
      },
    ],
  },
];

const questions: AvailableQuestion[] = [
  { id: 1, name: 'Revenue by Month', alias: 'revenue_by_month_1', type: 'question' },
  { id: 2, name: 'User Growth', alias: 'user_growth_2', type: 'question' },
  { id: 3, name: 'Sales Dashboard', alias: 'sales_dashboard_3', type: 'dashboard' },
];

describe('getMentionCompletionsLocal', () => {
  // --- Table mentions (mentionType = "all") ---

  it('returns all tables when prefix is empty and mentionType is "all"', () => {
    const result = getMentionCompletionsLocal('', schemaData, questions, 'all');
    const names = result.map(s => s.name);
    expect(names).toContain('users');
    expect(names).toContain('orders');
    expect(names).toContain('events');
    expect(names).toContain('user_events');
  });

  it('includes questions and dashboards when mentionType is "all"', () => {
    const result = getMentionCompletionsLocal('', schemaData, questions, 'all');
    const names = result.map(s => s.name);
    expect(names).toContain('Revenue by Month');
    expect(names).toContain('Sales Dashboard');
  });

  it('filters tables by prefix', () => {
    const result = getMentionCompletionsLocal('user', schemaData, questions, 'all');
    const names = result.map(s => s.name);
    expect(names).toContain('users');
    expect(names).toContain('user_events');
    expect(names).not.toContain('orders');
    expect(names).not.toContain('events');
  });

  it('filters by qualified name (schema.table)', () => {
    const result = getMentionCompletionsLocal('analytics', schemaData, questions, 'all');
    const names = result.map(s => s.name);
    expect(names).toContain('events'); // analytics.events matches
    expect(names).not.toContain('users');
  });

  it('filters questions by prefix', () => {
    const result = getMentionCompletionsLocal('revenue', schemaData, questions, 'all');
    const qNames = result.filter(s => s.type === 'question').map(s => s.name);
    expect(qNames).toContain('Revenue by Month');
    expect(qNames).not.toContain('User Growth');
  });

  it('filters questions by alias prefix', () => {
    const result = getMentionCompletionsLocal('user_growth', schemaData, questions, 'all');
    const qNames = result.filter(s => s.type === 'question').map(s => s.name);
    expect(qNames).toContain('User Growth');
  });

  // --- Questions-only (mentionType = "questions") ---

  it('excludes tables when mentionType is "questions"', () => {
    const result = getMentionCompletionsLocal('', schemaData, questions, 'questions');
    const types = new Set(result.map(s => s.type));
    expect(types).not.toContain('table');
    expect(types).toContain('question');
    expect(types).toContain('dashboard');
  });

  it('returns all questions/dashboards with empty prefix', () => {
    const result = getMentionCompletionsLocal('', schemaData, questions, 'questions');
    expect(result).toHaveLength(3);
  });

  // --- Insert text format ---

  it('table insert_text is @schema.table', () => {
    const result = getMentionCompletionsLocal('users', schemaData, [], 'all');
    const usersItem = result.find(s => s.name === 'users');
    expect(usersItem).toBeDefined();
    expect(usersItem!.insert_text).toBe('@public.users');
  });

  it('question insert_text uses @@ prefix', () => {
    const result = getMentionCompletionsLocal('revenue', [], questions, 'all');
    const revItem = result.find(s => s.name === 'Revenue by Month');
    expect(revItem).toBeDefined();
    expect(revItem!.insert_text).toBe('@@revenue_by_month_1');
  });

  // --- Edge cases ---

  it('handles empty schema data', () => {
    const result = getMentionCompletionsLocal('', [], questions, 'all');
    expect(result.length).toBe(3); // only questions
  });

  it('handles empty questions', () => {
    const result = getMentionCompletionsLocal('', schemaData, [], 'all');
    const types = new Set(result.map(s => s.type));
    expect(types).toContain('table');
    expect(types).not.toContain('question');
  });

  it('handles no matches', () => {
    const result = getMentionCompletionsLocal('zzzzz', schemaData, questions, 'all');
    expect(result).toHaveLength(0);
  });

  it('case-insensitive filtering', () => {
    const result = getMentionCompletionsLocal('USERS', schemaData, [], 'all');
    expect(result.map(s => s.name)).toContain('users');
  });
});
