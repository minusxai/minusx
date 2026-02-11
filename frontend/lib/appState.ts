/**
 * App State - Combines file content with runtime state
 *
 * Provides functions that merge:
 * - File content (from filesSlice)
 * - Runtime UI state (from various slices like queryResultsSlice)
 */

import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '@/store/store';
import { selectMergedContent } from '@/store/filesSlice';
import { selectQueryResult } from '@/store/queryResultsSlice';
import { selectSelectedRun } from '@/store/reportRunsSlice';
import { QuestionContent, DocumentContent, FileType, DbFile, AssetReference, QueryResult, QuestionParameter, ReportContent } from '@/lib/types';
''
/**
 * Common fields for all app states
 */
export interface BaseAppState {
  pageType: FileType | 'explore';
  fileId?: number;  // Optional - folders and explore don't have file IDs
  path: string;
}

interface ReferencedQuestion {
  type: 'question';
  fileId: number;
  path: string;
  alias: string;
  query: string;
  database_name?: string;
  parameters?: QuestionParameter[];
}

/**
 * Question app state - file content + query execution state
 */
export interface QuestionAppState extends QuestionContent, BaseAppState {
  pageType: 'question';
  fileId: number;  // Required for questions
  // Runtime state from queryResultsSlice
  queryData?: any;
  loading?: boolean;
  error?: string | null;
  // Referenced questions (for composed questions) - similar to dashboard's questionStates
  referencedQuestions?: Record<number, ReferencedQuestion>;
}

/**
 * Dashboard app state - dashboard content with augmented question data
 */
export interface DashboardAppState extends DocumentContent, BaseAppState {
  pageType: 'dashboard';
  fileId: number;  // Required for dashboards
  // Augmented question data - maps question ID to augmented question state
  questionStates?: Record<number, QuestionAppState>;
}

/**
 * Folder app state - folder path + files in the folder
 */
export interface FolderAppState extends BaseAppState {
  pageType: 'folder';
  files: Array<{
    id: number;
    name: string;
    type: FileType;
    path: string;
  }>;
}

/**
 * Explore app state - for ad-hoc exploration without a file
 */
export interface ExploreAppState extends BaseAppState {
  pageType: 'explore';
}

/**
 * Report app state - report configuration and references
 */
export interface ReportAppState extends BaseAppState {
  pageType: 'report';
  fileId: number;
  schedule?: { cron: string; timezone: string };
  references?: Array<{ reference: { type: 'question' | 'dashboard'; id: number }; prompt: string }>;
  reportPrompt?: string;
  emails?: string[];
  // Selected run content (if a run is selected)
  selectedRun?: {
    id: number;
    startedAt: string;
    completedAt?: string;
    status: 'pending' | 'running' | 'success' | 'failed';
    generatedReport?: string;
    error?: string;
  };
}

/**
 * Generic app state for other file types (notebook, connection, etc.)
 */
export interface GenericAppState extends BaseAppState {
  [key: string]: unknown;
}

/**
 * App state union - all typed page states
 */
export type AppState = QuestionAppState | DashboardAppState | FolderAppState | ExploreAppState | ReportAppState | GenericAppState;

/**
 * Transform query result from object rows to CSV-like array rows
 * Converts: [{ "name": "John", "age": 30 }]
 * To: [["John", 30]]
 * This saves tokens by avoiding repetition of column names
 *
 * Note: Currently unused but kept for potential future optimization
 */
// function transformQueryResultToCSV(queryResult: QueryResult | undefined): QueryResult | undefined {
//   if (!queryResult) return undefined;

//   const { columns, types, rows } = queryResult;

//   // Transform rows from objects to arrays
//   const csvRows = rows.map(row =>
//     columns.map(col => row[col])
//   );

//   return {
//     columns,
//     types,
//     rows: csvRows as any[] // Cast to match QueryResult type
//   };
// }

/**
 * Transform query result to markdown table format
 * Useful for displaying results in chat/AI interfaces
 */
export function transformQueryResultToMarkdown(queryResult: QueryResult | undefined): QueryResult | undefined {
  if (!queryResult) return undefined;

  const { columns, types, rows } = queryResult;

  if (columns.length === 0 || rows.length === 0) return undefined;

  // Header row
  const header = `| ${columns.join(' | ')} |`;
  const separator = `| ${columns.map(() => '---').join(' | ')} |`;

  // Data rows (handle both object and array formats)
  const dataRows = rows.map(row => {
    const values = Array.isArray(row)
      ? row
      : columns.map(col => row[col]);
    return `| ${values.map(v => v ?? 'null').join(' | ')} |`;
  });

  const truncated = dataRows.length > 20;
  const displayRows = truncated ? dataRows.slice(0, 20) : dataRows;
  const truncationMessage = truncated ? `\n(Truncated to 20 rows. ${dataRows.length - 20} more rows not shown.)` : '';

  return {
    columns,
    types,
    rows: [header, separator, ...displayRows].join('\n') + truncationMessage as any
  };
}

/**
 * Memoized selector for app state - use this with useAppSelector
 * Prevents unnecessary re-renders by using createSelector
 */
export const selectAppState = createSelector(
  [
    (state: RootState, fileId: number) => state.files.files[fileId],
    (state: RootState, fileId: number) => selectMergedContent(state, fileId),
    (state: RootState, _fileId: number) => state
  ],
  (file, mergedContent, state): AppState | undefined => {
    if (!file || !mergedContent) return undefined;
    // This will still create new objects, but createSelector will only recompute
    // when the input values actually change
    return augmentAppState(state, file.type, mergedContent, file.id, file.path);
  }
);

/**
 * Augment app state based on file type
 * Adds runtime state specific to each page type
 */
function augmentAppState(
  state: RootState,
  fileType: FileType,
  content: DbFile['content'],
  fileId: number,
  path: string
): AppState {
  switch (fileType) {
    case 'question':
      return {
        pageType: 'question',
        fileId,
        path,
        ...augmentQuestionAppState(state, content as QuestionContent)
      } as QuestionAppState;

    case 'dashboard':
      return {
        pageType: 'dashboard',
        fileId,
        path,
        ...augmentDashboardAppState(state, content as DocumentContent)
      } as DashboardAppState;

    case 'report':
      return {
        pageType: 'report',
        fileId,
        path,
        ...content,
        ...augmentReportAppState(state, fileId)
      } as ReportAppState;

    default:
      // Generic app state for other file types
      return { pageType: fileType, fileId, path, ...content } as GenericAppState;
  }
}

/**
 * Augment question app state with query execution results
 */
function augmentQuestionAppState(
  state: RootState,
  content: QuestionContent
): Omit<QuestionAppState, keyof BaseAppState> {
  // Extract query execution args from content
  const query = content.query;
  const database = content.database_name || '';
  const params = content.parameters?.reduce((acc, param) => {
    acc[param.name] = param.value;
    return acc;
  }, {} as Record<string, any>) || {};

  // Get query result from queryResultsSlice
  const queryResult = selectQueryResult(state, query, params, database);

  // Transform query result to CSV format (saves tokens)
//   const transformedData = transformQueryResultToCSV(queryResult?.data);
  const transformedData = transformQueryResultToMarkdown(queryResult?.data);

  // Include referenced question states (for composed questions)
  const referencedQuestions: Record<number, ReferencedQuestion> = {};
  content.references?.forEach(ref => {
    const refFile = state.files.files[ref.id];
    if (refFile && refFile.type === 'question') {
      const refContent = selectMergedContent(state, ref.id) as QuestionContent;
      if (refContent) {
        referencedQuestions[ref.id] = {
          type: 'question',
          fileId: ref.id,
          path: refFile.path,
          alias: ref.alias,  // Include alias for @reference syntax
          query: refContent.query,
          database_name: refContent.database_name,
          parameters: refContent.parameters,
        };
      }
    }
  });

  return {
    ...content,
    queryData: transformedData,
    loading: queryResult?.loading,
    error: queryResult?.error,
    referencedQuestions  // Add referenced questions
  };
}

/**
 * Augment dashboard app state with question content and query execution results
 */
function augmentDashboardAppState(
  state: RootState,
  content: DocumentContent
): Omit<DashboardAppState, 'pageType' | 'fileId' | 'path'> {
  const questionStates: Record<number, QuestionAppState> = {};

  // Process each asset in the dashboard
  content.assets?.forEach((asset: AssetReference) => {
    // Only process question assets (FileReference with type='question')
    if (asset.type === 'question' && 'id' in asset) {
      const questionId = asset.id;

      // Get question content from Redux
      const questionFile = state.files.files[questionId];
      if (questionFile && questionFile.type === 'question') {
        const questionContent = selectMergedContent(state, questionId) as QuestionContent;
        if (questionContent) {
          // Augment with query results (include base state for nested questions)
          questionStates[questionId] = {
            pageType: 'question',
            fileId: questionId,
            path: questionFile.path,
            ...augmentQuestionAppState(state, questionContent)
          };
        }
      }
    }
  });

  return {
    ...content,
    questionStates
  };
}

/**
 * Augment report app state with selected run content
 */
function augmentReportAppState(
  state: RootState,
  fileId: number
): Partial<ReportAppState> {
  const selectedRun = selectSelectedRun(state, fileId);

  if (!selectedRun) {
    return {};
  }

  return {
    selectedRun: {
      id: selectedRun.id,
      startedAt: selectedRun.content.startedAt,
      completedAt: selectedRun.content.completedAt,
      status: selectedRun.content.status,
      generatedReport: selectedRun.content.generatedReport,
      error: selectedRun.content.error,
    }
  };
}
