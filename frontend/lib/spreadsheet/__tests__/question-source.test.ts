import { describe, expect, it } from 'vitest';
import type { QuestionContent, SpreadsheetSource } from '@/lib/types';
import { getQuestionExecution } from '../question-source';

const content = (overrides: Partial<QuestionContent> = {}): QuestionContent => ({
  description: null,
  query: 'SELECT 1',
  vizSettings: null,
  parameters: null,
  parameterValues: null,
  connection_name: 'main',
  cachePolicy: null,
  semanticQuery: null,
  viz: null,
  ...overrides,
});

const spreadsheet: SpreadsheetSource = {
  version: 1,
  columns: [{ name: 'a', type: 'auto' }],
  rows: [['1']],
};

describe('getQuestionExecution', () => {
  it('resolves a valid spreadsheet source to a spreadsheet execution', () => {
    const execution = getQuestionExecution(content({ spreadsheet, query: '', connection_name: '' }));
    expect(execution).toMatchObject({ kind: 'spreadsheet', spreadsheet });
  });

  it('resolves a query-backed question to a query execution', () => {
    const execution = getQuestionExecution(content());
    expect(execution).toMatchObject({ kind: 'query', query: 'SELECT 1', database: 'main' });
  });

  it('falls back to the query when the spreadsheet is malformed (MINUSX-BI-3Q/3R)', () => {
    const execution = getQuestionExecution(content({
      spreadsheet: { version: 1, rows: [['a']] } as unknown as SpreadsheetSource,
    }));
    expect(execution).toMatchObject({ kind: 'query', query: 'SELECT 1', database: 'main' });
  });

  it('returns null when the spreadsheet is malformed and there is no query', () => {
    const execution = getQuestionExecution(content({
      spreadsheet: { version: 1, rows: [['a']] } as unknown as SpreadsheetSource,
      query: '',
      connection_name: '',
    }));
    expect(execution).toBeNull();
  });
});
