/**
 * App State Types
 *
 * Type definitions for page-specific app states.
 * These types are used by getAppState() in lib/api/app-state.ts
 *
 * Note: Augmentation logic moved to lib/api/app-state.ts (centralized with file loading)
 */

import { FileType, QuestionParameter, QuestionContent, DocumentContent } from '@/lib/types';
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
