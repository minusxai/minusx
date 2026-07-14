// ============================================================================
// Evals/tests domain types — split out of lib/types.ts (thin barrel there
// re-exports everything here; see lib/types.ts for the barrel).
// ============================================================================

// ============================================================================
// Unified Test types (reused by alerts + context evals)
// ============================================================================

/**
 * Row index: 0 = first, -1 = last, -2 = second-from-last, etc.
 * undefined defaults to 0 (first row).
 */
export type RowIndex = number;

/** What is being tested */
export type TestSubject =
  | {
      type: 'llm';
      prompt: string;
      /** Where to run the prompt — explore workspace or a specific file context */
      context: { type: 'explore' } | { type: 'file'; file_id: number };
      connection_id?: string;
    }
  | {
      type: 'query';
      source?: 'question';  // default when omitted (backward compat)
      question_id: number;
      column?: string;   // which column to extract (defaults to first column)
      row?: RowIndex;    // which row to read (default: 0 = first)
    }
  | {
      type: 'query';
      source: 'inline';
      sql: string;
      connection_name: string;
      column?: string;
      row?: RowIndex;
    };

/** binary only supports '='; string supports '~' (regex) and '='; number supports all */
export type TestAnswerType = 'binary' | 'string' | 'number';
export type TestOperator = '~' | '=' | '<' | '>' | '<=' | '>=';

/** The expected value to compare against */
export type TestValue =
  | { type: 'constant'; value: string | number | boolean }
  | { type: 'query'; source?: 'question'; question_id: number; column?: string; row?: RowIndex }
  | { type: 'query'; source: 'inline'; sql: string; connection_name: string; column?: string; row?: RowIndex }
  /** LLM tests only: test passes iff the agent calls CannotAnswer */
  | { type: 'cannot_answer' };

export interface Test {
  type: 'llm' | 'query';
  subject: TestSubject;
  answerType: TestAnswerType;
  operator: TestOperator;
  value: TestValue;
}

/** Result of executing a single Test */
export interface TestRunResult {
  test: Test;
  passed: boolean;
  actualValue?: string | number | boolean | null;
  expectedValue?: string | number | boolean | null;
  error?: string;
  /** Agent tool-call trace, present for LLM tests. Typed as unknown[] to avoid circular import. */
  log?: unknown[];
}
