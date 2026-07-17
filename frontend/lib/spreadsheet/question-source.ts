import type { QuestionContent, SpreadsheetSource } from '@/lib/types';
import { buildQueryParamValues } from '@/lib/sql/sql-params';
import { getSpreadsheetExecution } from './materialize';

export type QuestionExecution =
  | {
      kind: 'spreadsheet';
      query: string;
      params: Record<string, never>;
      database: '';
      spreadsheet: SpreadsheetSource;
    }
  | {
      kind: 'query';
      query: string;
      params: Record<string, unknown>;
      database: string;
    };

/** Resolve the mutually-exclusive question source into its existing cache coordinates. */
export function getQuestionExecution(
  content: QuestionContent | null | undefined,
  inheritedParams: Record<string, unknown> = {},
): QuestionExecution | null {
  if (!content) return null;
  if (content.spreadsheet) {
    const execution = getSpreadsheetExecution(content.spreadsheet);
    return { kind: 'spreadsheet', ...execution, spreadsheet: content.spreadsheet };
  }
  if (!content.query || !content.connection_name) return null;
  return {
    kind: 'query',
    query: content.query,
    params: buildQueryParamValues(content.parameters ?? [], content.parameterValues ?? {}, inheritedParams),
    database: content.connection_name,
  };
}
