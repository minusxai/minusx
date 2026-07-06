// ============================================================================
// Reports domain types — split out of lib/types.ts (thin barrel there
// re-exports everything here; see lib/types.ts for the barrel).
// ============================================================================

import type { VizSettings } from '../validation/atlas-schemas';
import type { BaseFileContent } from './files';
import type { ScheduledJobContent } from './jobs';

/**
 * Report Content
 * Scheduled reports that run queries and generate insights via LLM
 */

export type ReportContent = ScheduledJobContent & {
  /** Freeform instruction; the analyst finds the data and writes the report. */
  reportPrompt: string;
};

/**
 * Report Run Content
 * Stored as a separate file (like conversations) for each execution
 */
export interface ReportRunStep {
  name: string;           // Step name (e.g., "execute_query", "generate_report", "send_email")
  startedAt: string;      // ISO timestamp
  completedAt?: string;   // ISO timestamp
  input?: any;            // Input data for debugging
  output?: any;           // Output data for debugging
  error?: string;         // Error message if step failed
}

/** Query result stored from tool call execution */
export interface ReportQueryResult {
  query: string;
  columns: string[];
  types: string[];
  rows: Record<string, any>[];
  vizSettings: VizSettings;
  connectionId?: string;
  fileId?: number;      // if from a reference
  fileName?: string;    // human-readable name
}

export interface ReportRunContent extends BaseFileContent {
  reportId: number;       // Reference to the report file
  reportName: string;     // Snapshot of report name at run time
  startedAt: string;      // ISO timestamp
  completedAt?: string;   // ISO timestamp
  status: 'running' | 'success' | 'failed';
  steps: ReportRunStep[]; // Detailed step outputs for debugging
  generatedReport?: string;  // The final generated report content (markdown)
  queries?: Record<string, ReportQueryResult>;  // Query results keyed by tool call ID for {{query:id}} references
  error?: string;         // Top-level error if any
}

// Report-specific output stored inside RunFileContent.output (for the job_runs system)
export interface ReportOutput {
  reportId: number;
  reportName: string;
  generatedReport?: string;   // markdown
  queries?: Record<string, ReportQueryResult>;
}
