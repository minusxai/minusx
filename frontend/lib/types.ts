import { FileType } from './ui/file-metadata';
import type { FileState } from '@/store/filesSlice';
// Atlas file content types — single source of truth is the TypeBox schemas in
// lib/validation/atlas-schemas.ts.
import type {
  ChoroplethConfig, PointsConfig, LinesConfig, HeatmapConfig,
} from './validation/atlas-schemas';

// Re-export FileType for convenience
export type { FileType };

// Re-export FileState for convenience
export type { FileState };
export type {
  AggregationFunction, FormulaOperator, VisualizationType, ParameterType,
  PivotValueConfig, PivotFormula, PivotConfig, ColumnFormatConfig, ConditionalFormatRule, VizSettings, AxisConfig, AxisScale, VisualizationStyleConfig, ChartAnnotation, TrendConfig, TrendCompareMode, SingleValueConfig,
  QuestionParameter, QuestionReference,
  QuestionContent,
  FileReference, InlineAsset,
  DashboardContent, DashboardLayout, DashboardLayoutItem,
  StoryContent,
  NotebookContent, NotebookCell, NotebookSqlCell, NotebookTextCell,
  AtlasQuestionFile, AtlasDashboardFile, AtlasStoryFile, AtlasNotebookFile,
  ChoroplethConfig, PointsConfig, LinesConfig, HeatmapConfig,
} from './validation/atlas-schemas';

// Geo config: discriminated union of sub-type-specific configs (null stripped — VizSettings.geoConfig handles nullability)
export type GeoConfig = ChoroplethConfig | PointsConfig | LinesConfig | HeatmapConfig;
export type GeoSubType = 'choropleth' | 'points' | 'lines' | 'heatmap';

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

/** Make specific keys of T optional while keeping the rest unchanged. */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// ============================================================================
// Domain modules under lib/types/ — this file is a thin barrel that
// re-exports everything so the ~385 existing `@/lib/types` imports across the
// codebase never need to change. Edit the domain module, not here.
// ============================================================================

// Files/documents domain — see lib/types/files.ts
export type {
  BaseEntity, BaseFileMetadata, AssetReference,
  QueryResult, CompressedQueryResult,
  BaseFileContent, DocumentContent, FolderContent, StylesContent,
  SessionRecordingMetadata, SessionRecordingFileContent, DbFile,
} from './types/files';
export { isInlineAsset } from './types/files';

// Connections domain — see lib/types/connections.ts
export type {
  DatabaseConnection, DatabaseSchema, DatabaseWithSchema,
  TestConnectionResult, CsvFileInfo, CsvConnectionConfig,
  ConnectionContent, TapFacebookConfig, TargetConfig, PipelineConfig, PipelineRunResult,
  ConnectorContent, FullQuery,
} from './types/connections';
export { connectionTypeToDialect } from './types/connections';

// Jobs/transforms domain — see lib/types/jobs.ts
export type {
  JobSchedule, AlertRecipient, ScheduledJobContent, JobRunStatus, JobRunSource, JobRun,
  RunMessage, MessageAttemptLog, RunMessageRecord, RunFileContent, JobHandlerResult,
  TransformOutput, Transform, TransformationContent, TransformResult,
  TransformRunMode, TransformationOutput, ContextOutput, JobRunnerInput,
} from './types/jobs';

// Alerts domain — see lib/types/alerts.ts
export type {
  AlertSelector, AlertFunction, ComparisonOperator,
  DeliveredRecipient, AlertContent, AlertRunContent, AlertOutput,
} from './types/alerts';

// Reports domain — see lib/types/reports.ts
export type {
  ReportContent, ReportRunStep, ReportQueryResult, ReportRunContent, ReportOutput,
} from './types/reports';

// Context domain — see lib/types/context.ts
export type {
  WhitelistNode, Whitelist, WhitelistItem, DocEntry, MetricDef, ColumnAnnotation,
  TableAnnotation, SkillEntry, DatabaseContext, ContextVersion, PublishedVersions,
  ContextContent, ResolvedContextDoc, ResolvedContextDocs, ContextInfo,
} from './types/context';

// Chat/conversation domain — see lib/types/chat.ts
export type {
  Attachment, ChatMentionData, SkillMention, SlashCommand,
  AgentSkillSelection, AgentUserSkillCatalogItem,
  ToolCall, ToolCallDetails, EditFileDetails, ScreenshotDetails, ClarifyDetails,
  ToolMessage, CompletedToolCall,
  ConversationSource, ConversationMetadata,
  TaskLogEntry, TaskResultEntry, TaskDebugEntry, ConversationLogEntry,
  LLMDebugInfo, MessageDebugInfo, ErrorLogEntry, ConversationFileContent,
  ChatViewMode, DisplayProps, AugmentedFile, CompressedFileState, CompressedAugmentedFile,
  ReadFilesResult,
  ExecuteQueryInput, ExecuteQueryDetails,
} from './types/chat';
export { contentToDetails, ToolNames } from './types/chat';

// Evals/tests domain — see lib/types/evals.ts
export type {
  RowIndex, TestSubject, TestAnswerType, TestOperator, TestValue, Test, TestRunResult,
} from './types/evals';

// Users domain — see lib/types/users.ts
export type { UserRole, UserState, User, UsersContent } from './types/users';

// Messaging/config domain — see lib/types/messaging.ts
export type {
  ConfigChannel, SlackBotConfig, ConfigBot, ConfigContent,
  MessagingWebhookHttp, MessagingWebhookKeyword, MessagingWebhook,
} from './types/messaging';
