// ============================================================================
// Files/documents domain types — split out of lib/types.ts (thin barrel there
// re-exports everything here; see lib/types.ts for the barrel).
// ============================================================================

import { AnalyticsFileType, FileType } from '../ui/file-metadata';
import type { FileReference, InlineAsset, QuestionContent, StoryContent, NotebookContent } from '../validation/atlas-schemas';
import type { ContextContent } from './context';
import type { ConnectionContent, ConnectorContent } from './connections';
import type { UsersContent } from './users';
import type { ConfigContent } from './messaging';
import type { ReportContent, ReportRunContent } from './reports';
import type { AlertContent, AlertRunContent } from './alerts';
import type { RunFileContent, TransformationContent } from './jobs';

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
  draft?: boolean;               // true until first real save (invisible in listings); undefined = false
  meta?: Record<string, unknown> | null;  // arbitrary file-level metadata (future use)
}

// Document-based architecture types
export type QuestionContainer = AnalyticsFileType | 'explore' | 'sidebar';


// Named alias for the discriminated union (inlined in generated DashboardContent.assets)
export type AssetReference = FileReference | InlineAsset;

// Type guards for AssetReference
export function isInlineAsset(asset: AssetReference): asset is InlineAsset {
  return ['text', 'image', 'divider'].includes(asset.type);
}

export interface QueryResult {
  columns: string[];
  types: string[];
  rows: Record<string, any>[];
  id?: string;        // query hash for delta deduplication
  cachedAt?: number;  // Unix timestamp (ms) when result was cached; absent on cache miss
  /** Fully resolved SQL with `:name` placeholders inlined as literals.
   *  Populated by every connector via `lib/sql/inline-params.ts`.
   *  Optional here (vs required on the connector contract in
   *  `lib/connections/base.ts`) because cached/legacy entries in Redux or
   *  IndexedDB may predate the field. */
  finalQuery?: string;
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
  /** Fully resolved SQL, propagated from QueryResult so LLM-facing
   *  compressions surface the actual executed query alongside the data. */
  finalQuery?: string;
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

export interface FolderContent extends BaseFileContent {
  description?: string;      // optional folder description
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
 * Styles content - CSS styling for org branding
 */
export interface StylesContent extends BaseFileContent {
  styles: string;  // Raw CSS string
}

/**
 * Database file entity
 * Extends BaseFileMetadata with content
 * content can be null for metadata-only loads (Phase 2: Partial Loading)
 */
export interface DbFile extends BaseFileMetadata {
  content: QuestionContent | DocumentContent | StoryContent | NotebookContent | ContextContent | ConnectionContent | ConnectorContent | UsersContent | FolderContent | ConfigContent | SessionRecordingFileContent | StylesContent | ReportContent | ReportRunContent | AlertContent | AlertRunContent | RunFileContent | TransformationContent | null;
}
