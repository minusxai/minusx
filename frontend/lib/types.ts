import { AnalyticsFileType, FileType } from './ui/file-metadata';

// Re-export FileType for convenience
export type { FileType };

// Re-export SQL IR types
export type {
  QueryIR,
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
}

export interface QuestionParameter {
  name: string;
  type: 'text' | 'number' | 'date';
  label?: string;
  value?: string | number;  // Current/default value
}

export interface QuestionReference {
  id: number;        // Referenced question ID
  alias: string;     // Alias for use in SQL (e.g., "users")
}

export interface VizSettings {
  type: 'table' | 'line' | 'bar' | 'area' | 'scatter' | 'funnel' | 'pie' | 'pivot' | 'trend';
  xCols?: string[];
  yCols?: string[];
}

// Document-based architecture types
export type QuestionContainer = AnalyticsFileType | 'explore' | 'sidebar';


// NEW: File references (external files to load)
export interface FileReference {
  type: 'question';  // Can extend to 'dashboard' | 'notebook' later
  id: number;        // Required - integer ID of referenced file (Phase 2 migration)
  slug?: string;     // DEPRECATED: not used anymore
}

// NEW: Inline assets (no external loading)
export interface InlineAsset {
  type: 'text' | 'image' | 'divider';
  id?: string;       // Optional - for internal referencing (e.g., in presentations)
  content?: string;  // Markdown for text, URL for image
}

// MODIFIED: AssetReference is now a union of FileReference and InlineAsset
export type AssetReference = FileReference | InlineAsset;

// Type guards for AssetReference
export function isFileReference(asset: AssetReference): asset is FileReference {
  return asset.type === 'question';
}

export function isInlineAsset(asset: AssetReference): asset is InlineAsset {
  return ['text', 'image', 'divider'].includes(asset.type);
}

export interface DashboardLayoutItem {
  id: number;  // Question ID (integer, Phase 2 migration)
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardLayout {
  columns?: number;
  items?: DashboardLayoutItem[];
}

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
}

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface UserState {
  twofa_whatsapp_enabled?: boolean;
  twofa_sms_enabled?: boolean;      // Future
  twofa_email_enabled?: boolean;    // Future
  // Other user preferences can be added here
}

export interface User {
  id?: number;               // user ID from database (added in Phase 1)
  name: string;              // full name of the user
  email: string;
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
 * Messaging webhook configuration
 * Used in ConfigContent.messaging section
 */
export interface MessagingWebhook {
  type: 'whatsapp' | 'sms' | 'email';
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  body?: Record<string, any>;
}

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
export interface BaseFileContent {
  // Empty base - each content type defines its own fields
}

// Database-backed document types
export interface QuestionContent extends BaseFileContent {
  description?: string;
  query: string;
  vizSettings: VizSettings;
  parameters?: QuestionParameter[];
  database_name: string;  // Database connection name, or empty string if no database available
  references?: QuestionReference[];  // Composed questions (single-level only)
}

export interface DocumentContent extends BaseFileContent {
  description?: string;
  assets: AssetReference[];
  layout?: any;  // Type-specific layout (DashboardLayout, etc.)
  parameterValues?: Record<string, any>;  // Dashboard parameter values (ephemeral, from Redux)
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

  // When to run
  schedule: ReportSchedule;

  // What to analyze - list of references (questions/dashboards) with prompts
  references: ReportReference[];

  // Overall report instructions - how to synthesize all reference analyses
  reportPrompt?: string;

  // Where to send
  emails: string[];
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

/**
 * Database file entity
 * Extends BaseFileMetadata with content and multi-tenant support
 * content can be null for metadata-only loads (Phase 2: Partial Loading)
 */
export interface DbFile extends BaseFileMetadata {
  content: QuestionContent | DocumentContent | ContextContent | ConnectionContent | ConnectorContent | UsersContent | FolderContent | ConfigContent | SessionRecordingFileContent | StylesContent | ReportContent | ReportRunContent | null;
  company_id?: number;     // Always present in DB queries (NOT NULL column), optional for type flexibility
}

/**
 * Database connection entity
 * Extends BaseEntity with connection-specific fields
 */
export interface DatabaseConnection extends BaseEntity {
  name: string;
  type: 'duckdb' | 'bigquery' | 'postgresql' | 'csv' | 'google-sheets';
  config: Record<string, any>;  // Safe config fields only (no sensitive data)
}

export interface DatabaseConnectionCreate {
  name: string;
  type: 'duckdb' | 'bigquery' | 'postgresql' | 'csv' | 'google-sheets';
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
  type: 'duckdb' | 'bigquery' | 'postgresql' | 'csv' | 'google-sheets';
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

export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string | any;    // Can be string or object
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
  EXECUTE_SQL_QUERY: 'ExecuteSQLQuery',
  SEARCH_DB_SCHEMA: 'SearchDBSchema',
  PRESENT_FINAL_ANSWER: 'PresentFinalAnswer',
  TALK_TO_USER: 'TalkToUser',
  ANALYST_AGENT: 'AnalystAgent',
  ATLAS_ANALYST_AGENT: 'AtlasAnalystAgent'
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
export interface ConversationMetadata {
  userId: string;
  name: string;  // Auto-generated from first user message (truncated to 50 chars)
  createdAt: string;
  updatedAt: string;
  logLength?: number;  // Track log length for conflict detection
  forkedFrom?: number;  // Track conversation lineage (file ID of parent)
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
  extra?: any;  // Contains full request/response
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
}
