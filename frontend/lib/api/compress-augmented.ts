/**
 * Pure utilities for compressing file state to model-ready format.
 *
 * These are extracted from file-state.ts (which has Redux dependencies) so they
 * can be imported safely from both client code and server-only job handlers.
 *
 * No Redux. No server-only APIs. Pure functions only.
 */
import { getQueryHash } from '@/lib/utils/query-hash';
import { buildQueryParamValues } from '@/lib/sql/sql-params';
import { sortObjectKeysDeep } from '@/lib/api/file-encoding';
import { fileToMarkup } from '@/lib/data/file-markup';
import { isRubricFileType, scoreFileDeterministic } from '@/lib/rubric/registry';
import type { RubricReport } from '@/lib/rubric/types';
import { shapeContextForAgent } from '@/lib/context/context-agent-view';
import { extractReferencesFromContent } from '@/lib/data/helpers/extract-references';
import type {
  AugmentedFile,
  BaseFileContent,
  CompressedAugmentedFile,
  CompressedFileState,
  CompressedQueryResult,
  DbFile,
  FileState,
  QueryResult,
  QuestionContent,
  FileType,
} from '@/lib/types';

const LIMIT_CHARS = 50_000;

export const APP_STATE_LIMIT_CHARS    = 2_000;    // Always-on context — keep small
export const TOOL_DEFAULT_LIMIT_CHARS = 10_000;   // ReadFiles / ExecuteQuery default
export const TOOL_MAX_LIMIT_CHARS     = 100_000;  // Hard ceiling agents can request

// ---------------------------------------------------------------------------
// DbFile → FileState
// ---------------------------------------------------------------------------

/**
 * Extract referenced file IDs from a DbFile's content. Delegates to the single
 * {@link extractReferencesFromContent} so the save path and this app-state path can never
 * disagree (story refs derive from the body, dashboard from assets, notebook from @-refs).
 */
export function extractReferences(file: DbFile): number[] {
  return extractReferencesFromContent(file.content as BaseFileContent, file.type as FileType);
}

/** Strip legacy queryResultId persisted inside question content */
export function stripQueryResultId(file: DbFile): DbFile['content'] {
  if (file.type !== 'question' || !file.content) return file.content;
  const { queryResultId: _, ...rest } = file.content as any;
  return rest as DbFile['content'];
}

/** Compute the query result cache key for a question file */
export function computeQueryResultId(file: DbFile): string | undefined {
  if (file.type !== 'question' || !file.content) return undefined;
  const content = file.content as QuestionContent;
  if (!content.query || !content.connection_name) return undefined;
  // Key on the CANONICAL params (effective + None-coerced) — same as execution/lookup — so the
  // queryResultId matches the id the executed result is stored under (see resolveEffectiveParams).
  return getQueryHash(content.query, buildQueryParamValues(content.parameters ?? [], content.parameterValues ?? {}, {}), content.connection_name);
}

/**
 * Convert a raw DbFile to a FileState with all UI fields zeroed.
 *
 * Single source of truth for the DbFile → FileState conversion.
 * Used by both the Redux reducer (filesSlice.setFiles) and server-side
 * code (dbFileToCompressedAugmented) so they stay in sync.
 */
export function dbFileToFileState(file: DbFile): FileState {
  const content = sortObjectKeysDeep(stripQueryResultId(file)) as DbFile['content'];
  return {
    ...file,
    content,
    references: extractReferences(file),
    queryResultId: computeQueryResultId(file),
    loading: false,
    saving: false,
    updatedAt: Date.now(),
    loadError: null,
    persistableChanges: {},
    ephemeralChanges: {},
    metadataChanges: {},
  } as FileState;
}

function mdTableCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n|\r/g, ' ');
}

export function compressQueryResult(qr: QueryResult & { error?: string }, maxChars = LIMIT_CHARS): CompressedQueryResult {
  if ((qr as any).error) {
    return { columns: [], types: [], data: '', totalRows: 0, shownRows: 0, truncated: false, id: qr.id, error: (qr as any).error, finalQuery: qr.finalQuery };
  }
  const { columns = [], types = [], rows = [] } = qr;
  const totalRows = rows.length;

  const header = `| ${columns.map(mdTableCell).join(' | ')} |`;
  const sep    = `| ${columns.map(() => '---').join(' | ')} |`;
  let md = `${header}\n${sep}\n`;

  let truncated = false;
  let shownRows = 0;
  for (const row of rows) {
    const line = `| ${columns.map(c => mdTableCell(String(row[c] ?? ''))).join(' | ')} |\n`;
    if (md.length + line.length > maxChars) { truncated = true; break; }
    md += line;
    shownRows++;
  }

  return { columns, types, data: md, totalRows, shownRows, truncated, id: qr.id, finalQuery: qr.finalQuery };
}

function compressFileState(fs: FileState): CompressedFileState {
  const mergedContent = { ...(fs.content || {}), ...(fs.persistableChanges || {}) } as FileState['content'];
  const isDirty = !!(
    (fs.persistableChanges && Object.keys(fs.persistableChanges).length > 0) ||
    fs.metadataChanges?.name !== undefined ||
    fs.metadataChanges?.path !== undefined
  );
  let queryResultId = fs.queryResultId;
  if (fs.type === 'question') {
    const qc = mergedContent as QuestionContent;
    if (qc?.query && qc?.connection_name) {
      // Canonical params (effective + None-coerced) — matches execution/lookup keying.
      queryResultId = getQueryHash(qc.query, buildQueryParamValues(qc.parameters ?? [], qc.parameterValues ?? {}, {}), qc.connection_name);
    }
  }
  // Notebooks: drop system-managed cached cell results from the model's view.
  // The agent already gets cell results via queryResults; the raw snapshots would
  // bloat its context and tempt it to author the field. mergedContent is a fresh
  // object here, so this never mutates Redux state.
  if (fs.type === 'notebook' && mergedContent && 'cellResults' in mergedContent) {
    delete (mergedContent as any).cellResults;
  }
  // Context files: the agent edits whitelist/docs/etc. — it does NOT need the heavy server-computed
  // schema cache. shapeContextForAgent drops the resolved `fullSchema` and degrades `parentSchema`
  // (the available-to-whitelist menu) to names/capped; column detail comes from SearchDBSchema.
  // Applied to BOTH `markup` AND `content`: a context's content is never used for the client-side
  // chart/param rendering the raw `content` is otherwise kept for, so shaping it here also keeps the
  // multi-MB schema cache off the wire when this AppState is sent to chat (it's a no-op for other
  // types, whose `content` stays full).
  const agentContent = fs.type === 'context' ? shapeContextForAgent(mergedContent) : mergedContent;
  const rubric = computeRubric(fs.type as FileType, agentContent);
  return {
    id: fs.id,
    name: fs.metadataChanges?.name ?? fs.name,
    path: fs.metadataChanges?.path ?? fs.path,
    type: fs.type as FileType,
    content: agentContent,
    isDirty,
    ...(queryResultId ? { queryResultId } : {}),
    // File Architecture v2: the markup the agent reads + edits (matches buildCurrentFileStr).
    markup: fileToMarkup(fs.type as FileType, agentContent),
    ...(rubric ? { rubric } : {}),
  };
}

/**
 * Deterministic health rubric for a file's content — auto-injected so the agent sees current
 * health on every read/app-state. Pure + cheap; only question/dashboard/story are scored.
 * Never throws (a scoring bug must not break file serialization).
 */
function computeRubric(type: FileType, content: unknown): RubricReport | undefined {
  if (!isRubricFileType(type) || !content) return undefined;
  try {
    return scoreFileDeterministic(type, content);
  } catch {
    return undefined;
  }
}

/**
 * Drop the JSON `content` from a CompressedFileState, keeping `markup` (+ id/name/path/
 * type/queryResultId). The agent reads + edits the `markup` projection, so the raw JSON
 * `content` is duplicate context — stripped at the LLM serialization boundary only (the
 * client keeps `content` for chart rendering, params, viz-change detection, etc.).
 */
export function omitFileStateContent(fs: CompressedFileState): CompressedFileState {
  if (!fs || typeof fs !== 'object') return fs;
  const { content: _omit, ...rest } = fs;
  return rest;
}

/** Strip JSON `content` from a CompressedAugmentedFile (primary + references) for the LLM. */
export function stripAugmentedContentForLlm(aug: CompressedAugmentedFile): CompressedAugmentedFile {
  if (!aug || typeof aug !== 'object') return aug;
  return {
    ...aug,
    fileState: omitFileStateContent(aug.fileState),
    references: Array.isArray(aug.references) ? aug.references.map(omitFileStateContent) : aug.references,
  };
}

// A current client shapes a context's markup to tens of KB (shapeContextForAgent). Anything far
// above that is a STALE client (pre-shaping bundle) shipping the raw multi-MB schema cache — exactly
// what OOM'd the server. Re-shape only those, so the normal path is byte-for-byte untouched.
const MAX_CONTEXT_MARKUP_CHARS = 200_000;

/**
 * SERVER-SIDE defense-in-depth: never let a pathologically large context reach the orchestrator,
 * regardless of the client's bundle version. For each context fileState in an AppState whose markup
 * is oversized, strip the schema cache from its content (shapeContextForAgent) and re-derive the
 * markup from that. Mutates the (freshly-parsed) appState in place. No-op for normal/oversize-free
 * appstates, non-context files, and non-file pages — so it can't regress the common path.
 */
export function boundContextAppState(appState: unknown): void {
  const a = appState as { type?: string; state?: { fileState?: unknown; references?: unknown[] }; ui?: { openModal?: { fileState?: unknown } } };
  if (!a || typeof a !== 'object' || a.type !== 'file' || !a.state || typeof a.state !== 'object') return;
  const fix = (fsUnknown: unknown) => {
    const fs = fsUnknown as { type?: string; content?: unknown; markup?: unknown };
    if (!fs || typeof fs !== 'object' || fs.type !== 'context') return;
    if (typeof fs.markup !== 'string' || fs.markup.length <= MAX_CONTEXT_MARKUP_CHARS) return;
    fs.content = shapeContextForAgent(fs.content ?? {});
    let markup = fileToMarkup('context', fs.content);
    // Hard cap: shaping handles the normal big-connection case cleanly, but a pathological structure
    // (e.g. thousands of separate connections) can still exceed the budget via per-node overhead.
    // Truncate as a last resort so the orchestrator can NEVER be handed an unbounded context markup.
    if (markup.length > MAX_CONTEXT_MARKUP_CHARS) {
      const note = '\n<!-- context schema truncated (too large); use SearchDBSchema to explore -->';
      markup = markup.slice(0, MAX_CONTEXT_MARKUP_CHARS - note.length) + note;
    }
    fs.markup = markup;
  };
  fix(a.state.fileState);
  if (Array.isArray(a.state.references)) a.state.references.forEach(fix);
  if (a.ui?.openModal?.fileState) fix(a.ui.openModal.fileState);
}

/**
 * Compress an AugmentedFile (Redux FileState + references + queryResults) into the
 * model-ready CompressedAugmentedFile shape.
 *
 * - Merges persistableChanges into content
 * - Computes isDirty and queryResultId
 * - Strips fullSchema column details for context files
 * - Serialises queryResults to GFM markdown tables (truncated at maxChars)
 */
export function compressAugmentedFile(augmented: AugmentedFile, maxChars = LIMIT_CHARS): CompressedAugmentedFile {
  return {
    fileState: compressFileState(augmented.fileState),
    references: augmented.references.map(compressFileState),
    queryResults: augmented.queryResults.map(qr => compressQueryResult(qr, maxChars)),
  };
}

/**
 * Convert a raw DbFile (from the database) directly to CompressedAugmentedFile.
 *
 * Used server-side (job handlers, test runners) where Redux is unavailable.
 * The result is equivalent to compressAugmentedFile() on a freshly-loaded,
 * unedited file: no persistableChanges, no metadataChanges, isDirty = false.
 *
 * @param file        The primary DbFile.
 * @param references  Referenced DbFiles (e.g. questions inside a dashboard).
 *                    Pass the references from FilesAPI.loadFile metadata.
 */
export function dbFileToCompressedAugmented(
  file: DbFile,
  references: DbFile[] = []
): CompressedAugmentedFile {
  const augmented: AugmentedFile = {
    fileState: dbFileToFileState(file),
    references: references.map(dbFileToFileState),
    queryResults: [],  // No cached query results available server-side
  };
  return compressAugmentedFile(augmented);
}
