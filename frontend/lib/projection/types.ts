/**
 * Projection types — the uniform shape every file/query producer emits, and its LLM-facing
 * projection.
 *
 * There are two layers:
 *
 * 1. **Rich (full fidelity).** What app state and every file tool (ReadFiles/CreateFile/
 *    EditFile) put into the append-only log. Nothing is pre-stripped — the log is the source
 *    of truth and stays complete so the projection can be recomputed at any time (e.g. after
 *    summarization). A file is `{ id, data, content, image, queryResults }`; a query result
 *    is `{ queryResultId, summary, data?, image? }`.
 *
 * 2. **Projected (LLM-facing).** What the single projection boundary emits. Heavy/opaque
 *    facets — JSX `markup`, query-result `data` tables, and `image`s — are NOT inlined in the
 *    JSON (escaped markup/markdown is unreadable and images are content blocks). They are
 *    emitted as separate raw blocks, correlated back by `file_id` / `queryResultId`; the JSON
 *    carries only lightweight metadata, query summaries, and an EXPLICIT per-facet
 *    changed/unchanged/present signal so the model can always tell what moved.
 *
 * Facets are optional throughout: which ones a producer populates is a per-role / per-type
 * POLICY (e.g. references carry `data` only — no `content`/markup; a question carries its
 * viz `image`; a `table` question may carry query `data` instead of an image). The TYPE is
 * uniform; the policy lives in the producers (Phase B). Reuse the SHAPE and the diff
 * machinery ({@link ./facets}); do not conflate file-metadata `data` with query-row `data`.
 */
import type { FileType } from '@/lib/types';
import type { ImageContent } from '@/orchestrator/llm';
import type { Diffed } from './facets';

// ───────────────────────────── Rich layer (stored in the log) ─────────────────────────────

/** Lightweight file metadata. Always present, cheap, lives INSIDE the JSON. */
export interface FileData {
  id: number;
  name: string;
  path: string;
  type: FileType;
  isDirty: boolean;
  /** Question files: the query-result cache key (links the file to its {@link AugmentedQueryResult}). */
  queryResultId?: string;
}

/** The agent's edit surface — JSX markup. Rendered OUTSIDE the JSON as a `<file_markup>` block. */
interface MarkupFacet {
  markup: string;
}

/**
 * An image of a file or a query-result visualization. Rendered OUTSIDE the JSON as an image
 * content block. `key` is a stable identity (e.g. the chart-attachment cache key
 * `queryResultId|updatedAt|vizSettings|titleOverride|colorMode`) used to dedup the image
 * across turns — an unchanged `key` means "same picture", so no new block is emitted.
 */
interface ImageFacet {
  key: string;
  image: ImageContent;
}

/**
 * Always-present shape descriptor for a query result. Lets the agent reason about structure
 * (and decide whether to fetch the rows via ReadFiles) without shipping the rows every turn.
 * Extensible: future per-column stats (min/max/avg/nulls — see `statistics-engine.ts`).
 */
interface QueryResultSummary {
  columns: string[];
  types: string[];
  totalRows: number;
}

/**
 * The heavy row payload as a GFM markdown table. OPTIONAL — omitted when an image conveys the
 * result, present when the agent needs exact values (ReadFiles/ExecuteQuery). Rendered OUTSIDE
 * the JSON as a raw block (escaped markdown in a JSON string is unreadable).
 */
interface QueryResultData {
  markdown: string;
  /** Rows actually present in `markdown` (≤ totalRows). */
  shownRows: number;
  /** True when the table was cut short by the char budget. */
  truncated: boolean;
}

/** A query result: always identified + summarized; `data` and `image` optional and diffed independently. */
export interface AugmentedQueryResult {
  queryResultId: string;
  finalQuery?: string;
  error?: string;
  summary: QueryResultSummary;
  data?: QueryResultData;
  image?: ImageFacet;
}

/**
 * The uniform rich file unit. `data` always present; `content`/`image`/`queryResults` populated
 * by producer policy (e.g. references omit `content`).
 */
export interface AugmentedFileEntry {
  id: number;
  data: FileData;
  content?: MarkupFacet;
  image?: ImageFacet;
  queryResults?: AugmentedQueryResult[];
}

/**
 * A focused/primary file plus its references (other files it points at). Replaces
 * `CompressedAugmentedFile`. App state for a file page is one of these; a multi-file tool
 * output (ReadFiles) is an array of these.
 */
export interface AugmentedFiles {
  file: AugmentedFileEntry;
  references: AugmentedFileEntry[];
}

// ───────────────────────── Projected layer (emitted to the LLM) ─────────────────────────

/**
 * Per-facet signal for facets rendered OUTSIDE the JSON (markup, query `data`, image). Explicit
 * so the model can always tell changed vs unchanged vs absent:
 * - `present`  — a fresh block IS emitted this turn (locate it by `file_id`/`queryResultId`).
 * - `unchanged`— identical to a prior in-window turn; NO block emitted (the model already has it).
 * An absent facet is simply omitted from the JSON (the field is not set).
 */
export type BlockFacetSignal = { state: 'present' } | { state: 'unchanged' };

/** A file in the LLM-facing JSON: metadata diffed inline; markup/image signaled (blocks emitted separately). */
export interface ProjectedFileJson {
  id: number;
  data: Diffed<FileData>;
  content?: BlockFacetSignal;
  image?: BlockFacetSignal;
  queryResults?: ProjectedQueryResultJson[];
}

/**
 * A fully-unchanged query result — EVERY facet (summary, finalQuery, data, image) is identical to a
 * prior in-window turn and there is no error to surface. The whole entry collapses to this compact
 * signal instead of an object whose every field is separately marked unchanged, so a dashboard with
 * dozens of referenced questions doesn't re-emit dozens of all-`unchanged` objects each turn. Reuse
 * what you already saw earlier for this `queryResultId`.
 */
interface UnchangedQueryResultJson {
  queryResultId: string;
  unchanged: true;
}

/**
 * A query result with at least one moved facet: summary diffed inline; `data`/`image` signaled as
 * blocks; `finalQuery` diffed inline (and truncated when very long — see `truncateFinalQuery`).
 */
export interface ChangedQueryResultJson {
  queryResultId: string;
  finalQuery?: Diffed<string>;
  error?: string;
  summary: Diffed<QueryResultSummary>;
  data?: BlockFacetSignal;
  image?: BlockFacetSignal;
}

/** A query result in the LLM-facing JSON — either the full {@link ChangedQueryResultJson} or, when
 *  nothing moved, the collapsed {@link UnchangedQueryResultJson}. */
export type ProjectedQueryResultJson = UnchangedQueryResultJson | ChangedQueryResultJson;

export interface ProjectedFilesJson {
  file: ProjectedFileJson;
  references: ProjectedFileJson[];
}

// ─────────────────────────────── Out-of-JSON blocks ───────────────────────────────

/** Kinds of raw text blocks emitted alongside the JSON (heavy/opaque facets pulled out). */
type ProjectionTextBlockKind = 'markup' | 'querydata';

/**
 * A raw text block emitted next to the projected JSON — real newlines/quotes, never a JSON
 * string value. `fileId` (markup) or `queryResultId` (querydata) correlates it to its JSON
 * entry. Images are emitted as native {@link ImageContent} blocks, tracked separately.
 */
export interface ProjectionTextBlock {
  kind: ProjectionTextBlockKind;
  fileId?: number;
  queryResultId?: string;
  type?: FileType;
  text: string;
}

/** The full output of projecting one turn's files: lean JSON + the out-of-JSON blocks. */
export interface ProjectedFilesOutput {
  json: ProjectedFilesJson;
  textBlocks: ProjectionTextBlock[];
  images: ImageContent[];
}
