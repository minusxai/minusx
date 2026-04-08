/**
 * Pure utilities for compressing file state to model-ready format.
 *
 * These are extracted from file-state.ts (which has Redux dependencies) so they
 * can be imported safely from both client code and server-only job handlers.
 *
 * No Redux. No server-only APIs. Pure functions only.
 */
import { getQueryHash } from '@/lib/utils/query-hash';
import type {
  AugmentedFile,
  CompressedAugmentedFile,
  CompressedFileState,
  CompressedQueryResult,
  DbFile,
  FileState,
  QueryResult,
  QuestionContent,
  QuestionReference,
  FileType,
} from '@/lib/types';

const LIMIT_CHARS = 50_000;

// ---------------------------------------------------------------------------
// DbFile → FileState
// ---------------------------------------------------------------------------

/** Extract referenced file IDs from a DbFile's content */
export function extractReferences(file: DbFile): number[] {
  if (file.type === 'dashboard' || file.type === 'presentation' || file.type === 'notebook') {
    const content = file.content as any;
    return content.assets
      ?.filter((a: any) => a.type === 'question')
      ?.map((a: any) => a.id)
      .filter((id: any): id is number => typeof id === 'number') || [];
  }
  if (file.type === 'report') {
    const content = file.content as any;
    return content.references
      ?.map((r: any) => r.reference?.id)
      .filter((id: any): id is number => typeof id === 'number') || [];
  }
  if (file.type === 'question') {
    const content = file.content as QuestionContent;
    return content.references?.map((ref: QuestionReference) => ref.id) || [];
  }
  return [];
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
  return getQueryHash(content.query, content.parameterValues || {}, content.connection_name);
}

/**
 * Convert a raw DbFile to a FileState with all UI fields zeroed.
 *
 * Single source of truth for the DbFile → FileState conversion.
 * Used by both the Redux reducer (filesSlice.setFiles) and server-side
 * code (dbFileToCompressedAugmented) so they stay in sync.
 */
export function dbFileToFileState(file: DbFile): FileState {
  return {
    ...file,
    content: stripQueryResultId(file),
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
    return { columns: [], types: [], data: '', totalRows: 0, shownRows: 0, truncated: false, id: qr.id, error: (qr as any).error };
  }
  const { columns, types, rows } = qr;
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

  return { columns, types, data: md, totalRows, shownRows, truncated, id: qr.id };
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
      queryResultId = getQueryHash(qc.query, qc.parameterValues || {}, qc.connection_name);
    }
  }
  // Strip column details from fullSchema for context files to reduce payload size
  if (fs.type === 'context' && mergedContent && 'fullSchema' in mergedContent) {
    const ctx = mergedContent as any;
    if (Array.isArray(ctx.fullSchema)) {
      ctx.fullSchema = (ctx.fullSchema as any[]).map((db: any) => ({
        ...db,
        schemas: db.schemas?.map((s: any) => ({
          ...s,
          tables: s.tables?.map((t: any) => ({ table: t.table })),
        })),
      }));
    }
  }
  return {
    id: fs.id,
    name: fs.metadataChanges?.name ?? fs.name,
    path: fs.metadataChanges?.path ?? fs.path,
    type: fs.type as FileType,
    content: mergedContent,
    isDirty,
    ...(queryResultId ? { queryResultId } : {}),
  };
}

/**
 * Compress an AugmentedFile (Redux FileState + references + queryResults) into the
 * model-ready CompressedAugmentedFile shape.
 *
 * - Merges persistableChanges into content
 * - Computes isDirty and queryResultId
 * - Strips fullSchema column details for context files
 * - Serialises queryResults to GFM markdown tables (truncated at LIMIT_CHARS)
 */
export function compressAugmentedFile(augmented: AugmentedFile): CompressedAugmentedFile {
  return {
    fileState: compressFileState(augmented.fileState),
    references: augmented.references.map(compressFileState),
    queryResults: augmented.queryResults.map(qr => compressQueryResult(qr)),
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
