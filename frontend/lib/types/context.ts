// ============================================================================
// Context domain types (Context.md — database schema whitelisting) — split out
// of lib/types.ts (thin barrel there re-exports everything here; see
// lib/types.ts for the barrel).
// ============================================================================

import type { PartialBy } from '@/lib/types';
import type { ScheduledJobContent } from './jobs';
import type { DatabaseWithSchema } from './connections';
import type { Test } from './evals';
import type { SkillMention } from './chat';
import type { TableRelationship } from './semantic';

/**
 * Recursive whitelist tree node.
 * type:'connection' → children are schema nodes
 * type:'schema'     → children are table nodes
 * type:'table'      → leaf node (no children)
 *
 * children:undefined = expose all children (wildcard)
 * children:[]        = expose nothing
 * children:[...]     = expose only listed children
 *
 * childPaths: restricts which sub-folder paths inherit this node
 *   undefined = all children
 *   []        = no children
 *   ['/org/team_a'] = only /org/team_a and its subtree
 */
export interface WhitelistNode {
  name: string;
  type: 'connection' | 'schema' | 'table';
  children?: WhitelistNode[];  // undefined = expose all; explicit array = filter to listed
  childPaths?: string[];       // restrict inheritance to these sub-paths
}

/**
 * Top-level whitelist for a context version.
 * '*' means expose all connections/schemas/tables.
 * Array of WhitelistNode[] means filter to listed connections.
 */
export type Whitelist = '*' | WhitelistNode[];

/** @deprecated Use WhitelistNode instead. Kept for backward compatibility during migration. */
export interface WhitelistItem {
  name: string;              // table or schema name
  type: 'table' | 'schema';
  schema?: string;           // required for tables, omitted for schemas
  childPaths?: string[];     // Optional: which child paths inherit this item (undefined = all children)
}

export interface DocEntry {
  content: string;           // Markdown documentation content
  title?: string;            // Optional: short human-readable title for this doc entry
  description?: string;      // Optional: one-line summary of what this doc covers
  childPaths?: string[];     // Optional: which child paths inherit this doc
  draft?: boolean;           // Optional: if true, excluded from agent-facing outputs
  alwaysInclude?: boolean;   // Optional: if true, stays inline in the system prompt every
                             // turn; otherwise lazy-loaded on demand via the LoadContext tool
}

/**
 * A named metric defined in a context. Metrics belong to the context (versioned,
 * inheritable) and are attached to a table so they surface in that table's @
 * mention drill-down and can be referenced from docs.
 */
export interface MetricDef {
  name: string;
  description?: string;
  sql?: string;
  connection?: string;       // owning table's connection (database) name
  schema?: string;           // owning table's schema
  table?: string;            // owning table name
}

/** Editorial description for a column, layered over any profiled description. */
export interface ColumnAnnotation {
  name: string;
  description?: string;
}

/**
 * Context-authored annotations for a table and its columns. These augment the
 * connection's raw schema (and profiled ColumnMeta) — the effective description
 * is the context annotation if present, else the profiled one.
 */
export interface TableAnnotation {
  connection?: string;       // connection (database) name — disambiguates same schema.table across connections
  schema: string;
  table: string;
  description?: string;
  columns?: ColumnAnnotation[];
}

export interface SkillEntry {
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: number;
}

/** @deprecated Use Whitelist/WhitelistNode instead. Kept for backward compatibility during migration. */
export interface DatabaseContext {
  databaseName: string;
  whitelist: WhitelistItem[];
}

export interface ContextVersion {
  version: number;                   // Version number (non-sequential, gaps allowed)
  whitelist: Whitelist;              // Schema whitelist for this version (replaces databases[])
  docs: DocEntry[];                  // Documentation entries with optional childPaths
  metrics?: MetricDef[];             // Named metrics attached to tables
  annotations?: TableAnnotation[];   // Editorial table/column descriptions
  relationships?: TableRelationship[]; // Declared FK relationships (semantic joins), attached to tables
  createdAt: string;                 // ISO timestamp
  createdBy: number;                 // User ID who created version
  lastEditedAt?: string;             // ISO timestamp of last edit
  lastEditedBy?: number;             // User ID who last edited
  description?: string;              // Optional version notes (editable)
}

export interface PublishedVersions {
  all: number;  // Single published version for all users (REQUIRED)
}

export type ContextContent = PartialBy<ScheduledJobContent, 'schedule' | 'recipients'> & {
  // Versioning (NEW - replaces legacy top-level storage)
  versions?: ContextVersion[];
  published: PublishedVersions;  // Required - always has published.all

  // Computed fields (added by loader, not stored in DB)
  fullSchema?: DatabaseWithSchema[];   // Computed by loader - what this context actually exposes (own whitelist applied)
  parentSchema?: DatabaseWithSchema[]; // Computed by loader - what parent offers (before own whitelist); used by editor
  fullDocs?: DocEntry[];               // Computed by loader - inherited docs
  fullMetrics?: MetricDef[];           // Computed by loader - inherited + own metrics
  fullAnnotations?: TableAnnotation[]; // Computed by loader - inherited + own annotations
  fullRelationships?: TableRelationship[]; // Computed by loader - inherited relationships
  fullSkills?: SkillEntry[];           // Computed by loader - inherited user-defined skills

  // Working fields (exposed by container for editing current version)
  databases?: DatabaseContext[] | '*'; // Current version's whitelist (container only); '*' = expose all
  docs?: DocEntry[];                  // Current version's docs (container only)
  metrics?: MetricDef[];             // Current version's metrics (container only)
  annotations?: TableAnnotation[];   // Current version's annotations (container only)
  relationships?: TableRelationship[]; // Current version's relationships (container only)

  // Evals (stored at content level, independent of versions)
  evals?: Test[];

  // User-defined skills (stored at content level, independent of versions)
  skills?: SkillEntry[];
};

/**
 * Context information for a file path
 * Always returns consistent shape whether context exists or not
 */
/**
 * A single resolved context doc. `alwaysInclude` decides how it's rendered: an
 * always-include doc is inlined (full `content`) under "Default Context Docs"; a
 * lazy one is advertised by `key` + `title` (+ `description`) under "Context
 * Library" and its `content` fetched on demand via LoadContext. `key` is a stable
 * slug, meaningful only for lazy docs (empty for pinned/string docs).
 */
export interface ResolvedContextDoc {
  key: string;
  title: string;
  description?: string;
  content: string;
  alwaysInclude: boolean;
}

/**
 * A context's docs resolved into STRUCTURE — one list of docs (default-vs-lazy is
 * the `alwaysInclude` flag, so there's no separate "library") plus the generated
 * schema descriptions, carried separately so they can later move onto the schema
 * itself. Turned into prompt/UI text only in `formatContextDocsSection`.
 */
export interface ResolvedContextDocs {
  docs: ResolvedContextDoc[];
  /** Generated schema/metric descriptions ("Schema Notes"). Separate concern. */
  schemaNotes?: string;
}

export interface ContextInfo {
  contextId: number | undefined;          // ID of context file (undefined if no context)
  databases: DatabaseWithSchema[];        // Whitelisted schemas (or all if no context)
  contextDocs?: ResolvedContextDocs;      // Resolved docs (structure); undefined if no context
  skills: SkillEntry[];                   // Resolved user-defined skills for this context
  availableSkills: SkillMention[];        // Resolved user-defined skills plus system skills for # mentions
  hasContext: boolean;                    // True if context file found
  contextLoading: boolean;                // True if context file is loading
}
