import { AnalyticsFileType, FileType } from './ui/file-metadata';
import type { FileState } from '@/store/filesSlice';
// Generated from backend/tasks/agents/analyst/file_schema.py
// Regenerate: cd frontend && npm run generate-types
import type {
  QuestionContent, FileReference, InlineAsset, VizSettings,
} from './types.gen';

// Re-export FileType for convenience
export type { FileType };

// Re-export FileState for convenience
export type { FileState };
export type {
  AggregationFunction, FormulaOperator, VisualizationType, ParameterType,
  PivotValueConfig, PivotFormula, PivotConfig, ColumnFormatConfig, VizSettings, AxisConfig, AxisScale, VisualizationStyleConfig, ChartAnnotation,
  QuestionParameter, QuestionReference,
  QuestionContent,
  FileReference, InlineAsset,
  DashboardContent, DashboardLayout, DashboardLayoutItem,
  AtlasQuestionFile, AtlasDashboardFile,
} from './types.gen';

// Re-export SQL IR types
export type {
  QueryIR,
  CompoundQueryIR,
  CompoundOperator,
  AnyQueryIR,
  SelectColumn,
  TableReference,
  JoinClause,
  JoinCondition,
  FilterGroup,
  FilterCondition,
  GroupByItem,
  GroupByClause,
  OrderByClause,
} from './sql/ir-types';
export { isCompoundQueryIR } from './sql/ir-types';

/**
 * Base entity interface shared by all database entities
 * Provides common fields for all stored entities
 */
export interface BaseEntity {
  id: number;
  created_at: string;
  updated_at: string;
}

/**
 * Base file metadata interface shared by all file-related types
 * Extends BaseEntity with file-specific fields
 */
export interface BaseFileMetadata extends BaseEntity {
  name: string;
  path: string;
  type: FileType;
  references: number[];  // Phase 6: Array of file IDs this file references (cached from content)
  version: number;            // OCC version counter (incremented on each update); default 1
  last_edit_id: string | null;  // Last edit idempotency key (for OCC); null if not set
}

// Document-based architecture types
export type QuestionContainer = AnalyticsFileType | 'explore' | 'sidebar';


// Named alias for the discriminated union (inlined in generated DashboardContent.assets)
export type AssetReference = FileReference | InlineAsset;

// Type guards for AssetReference
export function isFileReference(asset: AssetReference): asset is FileReference {
  return asset.type === 'question';
}

export function isInlineAsset(asset: AssetReference): asset is InlineAsset {
  return ['text', 'image', 'divider'].includes(asset.type);
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface NotebookLayout {
  // Reserved for future overrides
}

export interface PresentationSlide {
  rectangles: Rectangle[];  // Canvas elements with positioning and styling
  arrows: Arrow[];          // Connections between rectangles
}

export interface PresentationLayout {
  canvasWidth: number;
  canvasHeight: number;
  slides: PresentationSlide[];
  theme?: string;
}

export interface ReportLayout {
  pageSize?: 'letter' | 'a4';
}

export interface QueryResult {
  columns: string[];
  types: string[];
  rows: Record<string, any>[];
  id?: string;        // query hash for delta deduplication
  cachedAt?: number;  // Unix timestamp (ms) when result was cached; absent on cache miss
  finalQuery?: string; // Fully resolved SQL with params inlined (for display)
}

export interface CompressedQueryResult {
  columns: string[];
  types: string[];
  data: string;        // markdown table (possibly character-truncated)
  totalRows: number;   // original full row count
  shownRows: number;   // rows actually present in data (≤ totalRows)
  truncated: boolean;  // true if data was cut short by LIMIT_CHARS
  id?: string;         // query hash (from QueryResult.id)
  error?: string;      // set when query execution failed
}

export interface Rectangle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  assetId: string; // Reference to asset in Document.assets
  zIndex: number;
  shapeType?: 'rectangle' | 'oval' | 'triangle' | 'diamond' | 'arrow' | 'star';
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  textAlign?: 'left' | 'center' | 'right';
  backgroundImage?: string; // URL for background image
  textColor?: string; // Text color for markdown content
}

export interface Arrow {
  id: string;
  fromId: string; // rectangle ID
  toId: string; // rectangle ID
  fromAnchor: 'top' | 'right' | 'bottom' | 'left' | 'center';
  toAnchor: 'top' | 'right' | 'bottom' | 'left' | 'center';
  color: string;
  strokeWidth: number;
}

export interface SlideData {
  version: string;
  canvasWidth: number;
  canvasHeight: number;
  rectangles: Rectangle[];
  arrows: Arrow[];
}

// Chat attachment types
export type Attachment = {
  type: 'text' | 'image';
  name: string;
  content: string;
  metadata?: { pages?: number; wordCount?: number };
};

// Context.md types (database schema whitelisting)
export interface WhitelistItem {
  name: string;              // table or schema name
  type: 'table' | 'schema';
  schema?: string;           // required for tables, omitted for schemas
  childPaths?: string[];     // Optional: which child paths inherit this item (undefined = all children)
}

export interface DocEntry {
  content: string;           // Markdown documentation content
  childPaths?: string[];     // Optional: which child paths inherit this doc
  draft?: boolean;           // Optional: if true, excluded from agent-facing outputs
}

export interface DatabaseContext {
  databaseName: string;
  whitelist: WhitelistItem[];
}

export interface ContextVersion {
  version: number;                   // Version number (non-sequential, gaps allowed)
  databases: DatabaseContext[];      // Schema whitelist for this version
  docs: DocEntry[];                  // Documentation entries with optional childPaths
  createdAt: string;                 // ISO timestamp
  createdBy: number;                 // User ID who created version
  lastEditedAt?: string;             // ISO timestamp of last edit
  lastEditedBy?: number;             // User ID who last edited
  description?: string;              // Optional version notes (editable)
}

export interface PublishedVersions {
  all: number;  // Single published version for all users (REQUIRED)
}

// Eval types for context quality testing
export type EvalAppState = { type: 'explore' } | { type: 'file'; file_id: number };

export interface BinaryAssertion {
  type: 'binary';
  answer: boolean;
  cannot_answer?: true;    // if set, expected answer is CannotAnswer (overrides answer)
}

export interface NumberAssertion {
  type: 'number_match';
  answer: number;          // static expected value (used when question_id not set)
  question_id?: number;    // if set, run this question at eval time and use first cell as expected
  column?: string;         // column name to read from question result (defaults to first column)
  cannot_answer?: true;    // if set, expected answer is CannotAnswer (overrides answer/question_id)
}

export type EvalAssertion = BinaryAssertion | NumberAssertion;

export interface EvalItem {
  question: string;
  assertion: EvalAssertion;
  app_state: EvalAppState;
  connection_id?: string;  // per-eval connection override (falls back to context default)
}

export interface ContextContent extends BaseFileContent {
  // Versioning (NEW - replaces legacy top-level storage)
  versions?: ContextVersion[];
  published: PublishedVersions;  // Required - always has published.all

  // Computed fields (added by loader, not stored in DB)
  fullSchema?: DatabaseWithSchema[];  // Computed by loader - inherited schema
  fullDocs?: DocEntry[];              // Computed by loader - inherited docs

  // Working fields (exposed by container for editing current version)
  databases?: DatabaseContext[];      // Current version's whitelist (container only)
  docs?: DocEntry[];                  // Current version's docs (container only)

  // Evals (stored at content level, independent of versions)
  evals?: Test[];
  /** Optional cron schedule for automatic eval runs */
  schedule?: AlertSchedule;
  recipients?: AlertRecipient[];
  /** Scheduling gate: 'live' = runs on schedule, 'draft' = manual only (default when absent) */
  status?: 'live' | 'draft';
}

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface UserState {
  twofa_phone_otp_enabled?: boolean;
  twofa_sms_enabled?: boolean;      // Future
  twofa_email_enabled?: boolean;    // Future
  // Other user preferences can be added here
}

export interface User {
  id?: number;               // user ID from database (added in Phase 1)
  name: string;              // full name of the user
  email: string;
  phone?: string;            // optional phone number (used for Phone 2FA delivery)
  home_folder?: string;      // relative path to home folder (e.g., "sales/team-a" or "" for mode root) - admins always get "" (mode-scoped)
  password_hash?: string;    // optional bcrypt hashed password
  role: UserRole;            // user role: admin (full access), editor (same as non-admin initially), viewer (same as non-admin initially) - NOT NULL in database
}

/**
 * Context information for a file path
 * Always returns consistent shape whether context exists or not
 */
export interface ContextInfo {
  contextId: number | undefined;          // ID of context file (undefined if no context)
  databases: DatabaseWithSchema[];        // Whitelisted schemas (or all if no context)
  documentation: string | undefined;      // Context docs (undefined if no context)
  hasContext: boolean;                    // True if context file found
  contextLoading: boolean;                // True if context file is loading
}

export interface UsersContent extends BaseFileContent {
  users: User[];             // array of users (both regular and admins)
}

export interface FolderContent extends BaseFileContent {
  description?: string;      // optional folder description
}

export type ConfigChannel =
  | { type: 'slack'; name: string; webhook_url: string; properties?: Record<string, unknown> }
  | { type: 'email'; name: string; address: string }
  | { type: 'phone'; name: string; address: string };

export interface SlackBotConfig {
  type: 'slack';
  name: string;
  install_mode: 'manifest_manual' | 'oauth';
  bot_token: string;
  signing_secret?: string;
  team_id?: string;
  team_name?: string;
  bot_user_id?: string;
  app_id?: string;
  enterprise_id?: string;
  installed_at?: string;
  installed_by?: string;
  enabled?: boolean;
  scopes?: string[];
}

export type ConfigBot = SlackBotConfig;

export interface ConfigContent extends BaseFileContent {
  branding?: {
    logoLight?: string;
    logoDark?: string;
    displayName?: string;
    agentName?: string;
    favicon?: string;
  };
  links?: {
    docsUrl?: string;
    supportUrl?: string;
    githubIssuesUrl?: string;
  };
  messaging?: {
    webhooks: MessagingWebhook[];
  };
  channels?: ConfigChannel[];
  error_delivery?: AlertRecipient[];
  bots?: ConfigBot[];
  // Future: other config sections can be added here
}

export interface SessionRecordingMetadata {
  userId: string;
  sessionStartTime: string;       // ISO timestamp
  sessionEndTime?: string;        // ISO timestamp (null if active)
  duration: number;                // Seconds
  eventCount: number;              // Number of rrweb events
  pageType: FileType | 'explore'; // Context where started
  compressed: true;                // Always compressed
  recordedAt: string;              // Creation timestamp
  uncompressedSize?: number;       // Original size in bytes
  compressedSize?: number;         // Compressed size in bytes
}

export interface SessionRecordingFileContent extends BaseFileContent {
  metadata: SessionRecordingMetadata;
  events: string;  // Base64-encoded gzipped JSON array of RRWebEvent[]
}

/**
 * Styles content - CSS styling for company branding
 */
export interface StylesContent extends BaseFileContent {
  styles: string;  // Raw CSS string
}

/**
 * Messaging webhook — explicit HTTP config (url/method/headers/body)
 */
export interface MessagingWebhookHttp {
  type: 'phone_otp' | 'email_otp' | 'email_alert' | 'phone_alert' | 'slack_alert';
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  body?: string | Record<string, any>;
}

/**
 * Messaging webhook — keyword alias resolved server-side at send time.
 * Clients only see the keyword; credentials are never in the config.
 * Only valid type+keyword combinations are allowed.
 */
export type MessagingWebhookKeyword =
  | { type: 'email_otp';   keyword: 'EMAIL_DEFAULT' }
  | { type: 'email_alert'; keyword: 'EMAIL_DEFAULT' }
  | { type: 'slack_alert'; keyword: 'SLACK_DEFAULT' };

export type MessagingWebhook = MessagingWebhookHttp | MessagingWebhookKeyword;

export interface SchemaInfo {
  name: string;
  tables: string[];
}

export interface SchemaTableResponse {
  schemas: SchemaInfo[];
}

/**
 * Base interface for all file content types
 * Content is now fully decoupled from metadata (name, path)
 * Name is stored only in file.name (DB column), not in content
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BaseFileContent {
  // Empty base - each content type defines its own fields
}

export interface DocumentContent extends BaseFileContent {
  description?: string;
  assets: AssetReference[];
  layout?: any;  // Type-specific layout (DashboardLayout, etc.)
  parameterValues?: Record<string, any>;  // Persisted parameter values (saved with file)
}

/**
 * Report Content
 * Scheduled reports that run queries and generate insights via LLM
 */

/** Reference to a question or dashboard for the report */
export interface ReportQuestionReference {
  type: 'question' | 'dashboard';
  id: number;
}

/** A reference in the report - combines a data source with a text prompt */
export interface ReportReference {
  reference: ReportQuestionReference;  // Which question/dashboard to run
  prompt: string;                       // What to ask about the data
}

/** Report schedule with cron expression and timezone */
export interface ReportSchedule {
  cron: string;      // Cron expression (e.g., "0 9 * * 1" = Monday 9am)
  timezone: string;  // IANA timezone (e.g., "America/New_York")
}

export interface ReportContent extends BaseFileContent {
  description?: string;

  // Scheduling gate: 'live' = runs on schedule, 'draft' = manual only (default when absent)
  status?: 'live' | 'draft';

  // When to run
  schedule: ReportSchedule;

  // What to analyze - list of references (questions/dashboards) with prompts
  references: ReportReference[];

  // Overall report instructions - how to synthesize all reference analyses
  reportPrompt?: string;

  // Where to send
  recipients: AlertRecipient[];
}

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

// Alert types
export type AlertSelector = 'first' | 'last' | 'all';
export type AlertFunction =
  // For first/last (single row)
  | 'value'        // raw numeric value
  | 'diff'         // difference vs adjacent row
  | 'pct_change'   // % change vs adjacent row
  | 'months_ago'   // calendar months between value and now
  | 'days_ago'     // calendar days between value and now
  | 'years_ago'    // years between value and now
  // For all (aggregate)
  | 'count'        // row count (no column needed)
  | 'sum'          // sum of column
  | 'avg'          // average of column
  | 'min'          // min of column
  | 'max';         // max of column
export type ComparisonOperator = '>' | '<' | '=' | '>=' | '<=' | '!=';

export interface AlertCondition {
  selector: AlertSelector;
  column?: string;          // Required for all functions except 'count'
  function: AlertFunction;
  operator: ComparisonOperator;
  threshold: number;
}

export interface AlertSchedule {
  cron: string;
  timezone: string;
}

export type AlertRecipient =
  | { channel: 'email_alert'; address: string }
  | { channel: 'phone_alert'; address: string }
  | { channel: 'slack_alert'; address: string };  // address = Slack channel name e.g. '#alerts'

export interface AlertContent extends BaseFileContent {
  description?: string;
  schedule: AlertSchedule;
  tests: Test[];                         // replaces: questionId + condition
  notifyOn?: 'any_fail' | 'all_fail';   // when to fire notification (default: 'any_fail')
  recipients?: AlertRecipient[];
  status?: 'live' | 'draft';
}

// Job run types (from job_runs table)
export type JobRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILURE' | 'TIMEOUT';
export type JobRunSource = 'manual' | 'cron';

export interface JobRun {
  id: number;
  created_at: string;
  completed_at: string | null;
  job_id: string;
  job_type: string;
  company_id: number;
  output_file_id: number | null;    // ID of the result file (e.g. alert_run); navigate via /f/{output_file_id}
  output_file_type: string | null;  // Type of the result file (e.g. 'alert_run')
  status: JobRunStatus;
  error: string | null;
  timeout: number;
  source: JobRunSource;
}

/** @deprecated Use RunFileContent with output: AlertOutput instead */
export interface AlertRunContent extends BaseFileContent {
  alertId: number;
  alertName: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'triggered' | 'not_triggered' | 'failed';
  actualValue: number | null;
  threshold: number;
  operator: ComparisonOperator;
  selector: AlertSelector;
  function: AlertFunction;
  column?: string;
  error?: string;
}

// Alert-specific output stored inside RunFileContent.output
export interface AlertOutput {
  alertId: number;
  alertName: string;
  status: 'triggered' | 'not_triggered' | 'error';
  testResults: TestRunResult[];
  triggeredBy: TestRunResult[];  // subset that failed (caused trigger)
}

export type RunMessage =
  | { type: 'email_alert';  content: string; metadata: { to: string; subject: string } }
  | { type: 'phone_alert';  content: string; metadata: { to: string; title?: string; desc?: string; link?: string; summary?: string } }
  | { type: 'slack_alert';  content: string; metadata: { channel: string; webhook_url: string; properties?: Record<string, unknown> } };

export interface MessageAttemptLog {
  attemptedAt: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  requestBody?: string;
  responseBody?: string;
}

export type RunMessageRecord = RunMessage & {
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  sentAt?: string;
  deliveryError?: string;
  logs?: MessageAttemptLog[];
};

// Generic run file content — the stored type for alert_run files in Phase 2+
export interface RunFileContent extends BaseFileContent {
  job_type: string;
  status: 'running' | 'success' | 'failure';
  startedAt: string;
  completedAt?: string;
  error?: string;
  output?: Record<string, any>;
  messages?: RunMessageRecord[];
}

// What handlers return
export interface JobHandlerResult {
  output: Record<string, any>;
  messages: RunMessage[];
  /** Optional override: if 'failure', route marks the run as FAILURE even though handler didn't throw */
  status?: 'success' | 'failure';
}

// ============================================================================
// Unified Test types (reused by transforms, and in future by alerts + evals)
// ============================================================================

/**
 * Python-style row index: 0 = first, -1 = last, -2 = second-from-last, etc.
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
      database_name: string;
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
  | { type: 'query'; source: 'inline'; sql: string; database_name: string; column?: string; row?: RowIndex }
  /** LLM tests only: test passes iff the agent calls CannotAnswer */
  | { type: 'cannot_answer' };

export interface Test {
  type: 'llm' | 'query';
  subject: TestSubject;
  answerType: TestAnswerType;
  operator: TestOperator;
  value: TestValue;
  label?: string;  // optional display name shown in run results
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

// ============================================================================
// Transformation types
// ============================================================================

export interface TransformOutput {
  schema_name: string;
  view: string;
}

export interface Transform {
  question: number;      // file ID of the source question
  output: TransformOutput;
  tests?: Test[];        // tests to run after this transform executes
}

export interface TransformationContent extends BaseFileContent {
  description?: string;
  transforms: Transform[];
  schedule?: AlertSchedule;
  recipients?: AlertRecipient[];
  /** Scheduling gate: 'live' = runs on schedule, 'draft' = manual only (default when absent) */
  status?: 'live' | 'draft';
}

// Per-transform execution result (stored inside RunFileContent.output)
export interface TransformResult {
  questionId: number;
  questionName: string;
  schema: string;
  view: string;
  sql: string;
  status: 'success' | 'error' | 'skipped';  // 'skipped' in test_only run mode
  error?: string;
  testResults?: TestRunResult[];  // results of any tests attached to this transform step
}

export type TransformRunMode = 'full' | 'test_only';

export interface TransformationOutput {
  results: TransformResult[];
  runMode?: TransformRunMode;  // defaults to 'full' if absent
}

// Context eval run output stored inside RunFileContent.output
export interface ContextOutput {
  results: TestRunResult[];
}

// What handlers receive
export interface JobRunnerInput {
  runFileId: number;
  jobId: string;
  jobType: string;
  file: any;
  previousRuns: JobRun[];
  runMode?: TransformRunMode;  // for transformation jobs: 'full' (default) or 'test_only'
}

/**
 * Database file entity
 * Extends BaseFileMetadata with content and multi-tenant support
 * content can be null for metadata-only loads (Phase 2: Partial Loading)
 */
export interface DbFile extends BaseFileMetadata {
  content: QuestionContent | DocumentContent | ContextContent | ConnectionContent | ConnectorContent | UsersContent | FolderContent | ConfigContent | SessionRecordingFileContent | StylesContent | ReportContent | ReportRunContent | AlertContent | AlertRunContent | RunFileContent | TransformationContent | null;
  company_id: number;     // NOT NULL column in DB
}

/**
 * Database connection entity
 * Extends BaseEntity with connection-specific fields
 */
export interface DatabaseConnection extends BaseEntity {
  name: string;
  type: 'duckdb' | 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena';
  config: Record<string, any>;  // Safe config fields only (no sensitive data)
}

export interface DatabaseConnectionCreate {
  name: string;
  type: 'duckdb' | 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena';
  config: Record<string, any>;
}

/**
 * Access token entity for public file sharing
 * Allows unauthenticated access to specific files by viewing as a designated user
 */
export interface AccessToken extends BaseEntity {
  token: string;                  // UUID for public access URL
  file_id: number;                // File to expose (question, dashboard, or folder)
  view_as_user_id: number;        // User whose permissions to use
  company_id: number;             // Multi-tenant isolation
  created_by_user_id: number;     // Admin who created this token
  expires_at: string;             // ISO timestamp (required, default 30 days)
  is_active: boolean;             // Manual revocation flag
}

/**
 * Access token analytics log entry
 */
export interface AccessTokenLog {
  id: number;
  token_id: number;
  accessed_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

/**
 * Aggregated token analytics
 */
export interface AccessTokenAnalytics {
  token_id: number;
  access_count: number;
  last_accessed_at: string | null;
  first_accessed_at: string | null;
}

/**
 * Input for creating a new access token
 */
export interface AccessTokenCreate {
  file_id: number;
  view_as_user_id: number;
  expires_at?: string;  // Optional, defaults to 30 days from now
}

export interface DatabaseSchema {
  schemas: Array<{
    schema: string;
    tables: Array<{
      table: string;
      columns: Array<{
        name: string;
        type: string;
      }>;
    }>;
  }>;
  updated_at: string;  // ISO timestamp - when schema was last fetched (required)
}

export interface DatabaseWithSchema {
  databaseName: string;
  schemas: DatabaseSchema['schemas'];
  updated_at?: string;  // ISO timestamp - optional for backward compatibility during transition
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  schema?: DatabaseSchema | null;  // Optional schema returned on successful test
}

// CSV file metadata stored in CSV connection config
export interface CsvFileInfo {
  filename: string;
  table_name: string;
  row_count: number;
  columns: { name: string; type: string }[];
}

// CSV connection config type
export interface CsvConnectionConfig {
  generated_db_path: string;
  files: CsvFileInfo[];
}

// Google Sheets connection config type
export interface GoogleSheetsConnectionConfig {
  spreadsheet_url: string;
  spreadsheet_id: string;
  generated_db_path: string;
  files: CsvFileInfo[];  // Reuses CsvFileInfo for sheet metadata
}

// Connection file content type (stored as file in /database/)
export interface ConnectionContent extends BaseFileContent {
  type: 'duckdb' | 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena';
  config: Record<string, any>;
  description?: string;
  schema?: DatabaseSchema;  // Added by connection loader via introspection
}

// Connector (Meltano/Singer pipeline) types (stored as file in /connectors/)
export interface TapFacebookConfig {
  access_token: string;
  account_id: string;
  start_date?: string;
  end_date?: string;
  include_deleted?: boolean;
  insights_buffer_days?: number;
}

export interface TargetConfig {
  connection_name: string;  // Reference to existing connection
  schema?: string;          // Target schema (default: "facebook")
}

export interface PipelineConfig {
  tap: {
    name: 'tap-facebook';
    config: TapFacebookConfig;
  };
  target: TargetConfig;
}

export interface PipelineRunResult {
  execution_id: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  started_at?: string;
  completed_at?: string;
  records_processed: number;
  duration_seconds?: number;
  error?: string;
  logs?: {
    tap_stderr?: string;
    target_stdout?: string;
    target_stderr?: string;
  };
}

export interface ConnectorContent extends BaseFileContent {
  pipelineConfig: PipelineConfig;
  description?: string;
  enabled?: boolean;
  lastRun?: PipelineRunResult;
}

// AI Chat types (OpenAI-compatible)
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;           // Tool name (e.g., "GetMetadata", "ExecuteSQL")
    arguments: Record<string, any>;  // Always an object - HTTP response handles JSON serialization
    child_tasks_batch?: Array<Array<{  // Child results grouped by run_id (optional, runtime only, not persisted)
      tool_call_id: string;
      agent: string;
      args: any;
      result: any;
    }>>;
  };
  _parent_unique_id?: string;  // For child tools spawned by parent (not in OpenAI spec)
}

// Tool call details — structured metadata for UI rendering (not sent to LLM)
export interface ToolCallDetails {
  success: boolean;
  error?: string;
  message?: string;  // human-readable status message
}

export interface EditFileDetails extends ToolCallDetails {
  diff: string;
}

export interface ClarifyDetails extends ToolCallDetails {
  selection?: any;  // the user's selection (for highlighting chosen option)
}

export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string | any;    // Can be string or object
  details?: ToolCallDetails;  // Structured metadata for UI rendering (not sent to LLM)
}

/**
 * Convert a ToolMessage to typed details for display components.
 * Prefers structured `details` (new); falls back to parsing `content` (old conversations
 * and server-side Python tools that don't populate `details`).
 * Spreading parsed content allows tool-specific fields (e.g. `selection`) through.
 */
export function contentToDetails<T extends ToolCallDetails>(toolMessage: ToolMessage): T {
  if (toolMessage.details) return toolMessage.details as T;
  try {
    const parsed = typeof toolMessage.content === 'string'
      ? JSON.parse(toolMessage.content)
      : (toolMessage.content ?? {});
    return { success: false, ...parsed } as T;
  } catch {
    return { success: false } as T;
  }
}

export type CompletedToolCall = [ToolCall, ToolMessage];
export type ToolCallRound = CompletedToolCall[];

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'debug';
  content: string | null;
  tool_calls?: ToolCall[];  // Assistant messages can have tool_calls (OpenAI spec)
  tool_call_id?: string;    // Tool messages reference their call (OpenAI spec)
  completed_tool_calls?: ToolCallRound[];  // Processed/collapsed format for rendering
  timestamp?: number;
}

export interface ConversationState {
  conversationID: number;  // File ID (changed from string)
  messages: ChatMessage[];
  currentTasksId: string | null;
}

// Tool names (centralized)
export const ToolNames = {
  SEARCH_DB_SCHEMA: 'SearchDBSchema',
  TALK_TO_USER: 'TalkToUser',
  ANALYST_AGENT: 'AnalystAgent',
  ATLAS_ANALYST_AGENT: 'AtlasAnalystAgent',
  TEST_AGENT: 'TestAgent',
  EXECUTE_QUERY: 'ExecuteQuery',
  ONBOARDING_CONTEXT_AGENT: 'OnboardingContextAgent',
  ONBOARDING_DASHBOARD_AGENT: 'OnboardingDashboardAgent',
  SLACK_AGENT: 'SlackAgent',
} as const;

export type ToolName = typeof ToolNames[keyof typeof ToolNames];

/**
 * Conversation Management Types
 * For file-based conversation storage with orchestration tasks
 */

/**
 * Task interface from Python backend orchestration system
 */
export interface OrchestrationTask {
  id: number;
  parent_id: number | null;
  run_id: string;
  unique_id: string;
  agent: string;
  args: any;
  result: any;
  debug: any;
  child_ids: number[][];
  previous_task_id?: string;  // Link to previous root task
}

/**
 * Conversation metadata
 */
export type ConversationSource =
  | { type: 'slack'; teamId: string; channelId: string; threadTs: string; channelName?: string }
  | { type: 'mcp'; sessionId: string };

export interface ConversationMetadata {
  userId: string;
  name: string;  // Auto-generated from first user message (truncated to 50 chars)
  createdAt: string;
  updatedAt: string;
  logLength?: number;  // Track log length for conflict detection
  forkedFrom?: number;  // Track conversation lineage (file ID of parent)
  source?: ConversationSource;  // Set when conversation originates from an external integration
}

/**
 * Conversation log entry types (matching Python backend)
 */
export interface TaskLogEntry {
  _type: 'task';
  _parent_unique_id?: string | null;
  _previous_unique_id?: string | null;
  _run_id: string;
  agent: string;
  args: any;
  unique_id: string;
  created_at: string;  // ISO timestamp
}

export interface TaskResultEntry {
  _type: 'task_result';
  _task_unique_id: string;
  result: string | any | null;
  created_at: string;  // ISO timestamp
  details?: ToolCallDetails;  // UI-only: preserved across reloads, ignored by Python backend
}

export interface TaskDebugEntry {
  _type: 'task_debug';
  _task_unique_id: string;
  duration: number;
  llmDebug: any[];
  extra?: any;
  created_at: string;  // ISO timestamp
}

export type ConversationLogEntry = TaskLogEntry | TaskResultEntry | TaskDebugEntry;

/**
 * LLM debug information for a single LLM API call
 * Extracted from TaskDebugEntry.llmDebug array
 */
export interface LLMDebugInfo {
  model: string;
  duration: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
  completion_tokens_details?: any;
  prompt_tokens_details?: any;
  finish_reason?: string;
  lllm_call_id?: string;
  lllm_overhead_time_ms?: number;
}

/**
 * Debug information for a single task/message
 * Built from TaskDebugEntry for display purposes
 */
export interface MessageDebugInfo {
  task_unique_id: string;
  duration: number;
  llmDebug: LLMDebugInfo[];
  extra?: any;
  created_at: string;
}

/**
 * Map from tool_call_id (unique_id) to debug info
 * Used for quick lookup when rendering messages
 */
export type DebugMap = Record<string, MessageDebugInfo>;

/**
 * Conversation file structure
 * Stored in /logs/conversations/{userId}/{conversationId}-{name}.chat.json
 */
export interface ConversationFileContent extends BaseFileContent {
  metadata: ConversationMetadata;
  log: ConversationLogEntry[];
}

export interface DisplayProps {
  toolCallTuple: CompletedToolCall;
  databaseName?: string;
  isCompact?: boolean;
  showThinking: boolean;
  markdownContext?: 'sidebar' | 'mainpage';
}

// ============================================================================
// Phase 1: Unified File System API Types
// ============================================================================


export interface AugmentedFile {
  fileState: FileState;        // The requested file (always defined when item exists in Redux)
  references: FileState[];     // Referenced files belonging to this file
  queryResults: QueryResult[]; // Query results for this file and its references (raw, untruncated)
}

/**
 * CompressedFileState — pre-merged view of a FileState for model consumption.
 * content = { ...content, ...persistableChanges } so oldMatch is just a copy.
 */
export interface CompressedFileState {
  id: number;
  name: string;   // effective name (metadataChanges.name ?? name)
  path: string;   // effective path  (metadataChanges.path ?? path)
  type: FileType;
  isDirty: boolean;             // true if unpublished changes exist
  queryResultId?: string;        // computed hash of query+params+database (questions only)
  content: FileState['content']; // merged: { ...content, ...persistableChanges }
}

export interface CompressedAugmentedFile {
  fileState: CompressedFileState;
  references: CompressedFileState[];
  queryResults: CompressedQueryResult[];
}

/**
 * EditFile Tool - Range-based file editing
 */
export interface EditFileInput {
  fileId: number;
  from: number;      // Start line number (1-indexed, inclusive)
  to: number;        // End line number (1-indexed, inclusive)
  newContent: string; // Replacement content for the range
}

export interface EditFileOutput {
  success: true;
  diff: string;                // Unified diff showing the change
  fileState: FileState;        // Updated file state with changes
  references: FileState[];     // Updated references (if any changed)
  queryResults: QueryResult[]; // Updated query results (if query changed)
}

export interface EditFileError {
  success: false;
  error: string;
  validationErrors?: Array<{
    field: string;
    message: string;
  }>;
}


/**
 * ExecuteQuery Tool - Standalone query execution
 */
export interface ExecuteQueryInput {
  query: string;
  connectionId: string;         // Connection name/ID
  parameters?: Record<string, any>;
}

export interface ExecuteQueryOutput extends QueryResult {
  // Extends QueryResult (columns, types, rows) with optional error
  error?: string;
}

export interface ExecuteQueryDetails extends ToolCallDetails {
  queryResult?: QueryResult;  // new messages: raw rows/columns for UI rendering
  // Old-message compat: contentToDetails spreads content fields through
  columns?: string[];
  types?: string[];
  rows?: Record<string, any>[];
  data?: string;  // Markdown table from compressQueryResult (present in historical messages)
}
