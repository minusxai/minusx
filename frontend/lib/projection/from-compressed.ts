/**
 * Bridge the existing `CompressedAugmentedFile` (produced by `compressAugmentedFile` for app
 * state and every file tool) into the rich {@link AugmentedFiles} shape the projector consumes.
 *
 * This is the seam that lets producers feed the new projection without being rewritten: they
 * already build a `CompressedAugmentedFile` that keeps `markup` + merged `content` + query-result
 * tables (the LLM-stripping happened LATER, at `appStateForLlm`/`takeAppStateMarkup`). We map that
 * full payload across faithfully — no stripping here; the projector decides what the LLM sees.
 *
 * Query results in `CompressedAugmentedFile` are a FLAT list keyed by query hash; here they are
 * re-attached to the file entry they belong to (matched via `fileState.queryResultId`). Images are
 * NOT part of `CompressedAugmentedFile` (they come from the separate chart-attachment pipeline) —
 * the caller attaches {@link ImageFacet}s after adapting (see the Phase C wiring).
 */
import type { CompressedAugmentedFile, CompressedFileState, CompressedQueryResult } from '@/lib/types';
import type {
  AugmentedFileEntry,
  AugmentedFiles,
  AugmentedQueryResult,
  FileData,
} from './types';

function toFileData(fs: CompressedFileState): FileData {
  return {
    id: fs.id,
    name: fs.name,
    path: fs.path,
    type: fs.type,
    isDirty: fs.isDirty,
    ...(fs.queryResultId ? { queryResultId: fs.queryResultId } : {}),
  };
}

/** Map one CompressedQueryResult → AugmentedQueryResult. Returns null when it has no hash to key on. */
function toAugmentedQueryResult(cqr: CompressedQueryResult): AugmentedQueryResult | null {
  if (!cqr.id) return null;
  return {
    queryResultId: cqr.id,
    ...(cqr.finalQuery !== undefined ? { finalQuery: cqr.finalQuery } : {}),
    ...(cqr.error !== undefined ? { error: cqr.error } : {}),
    summary: { columns: cqr.columns, types: cqr.types, totalRows: cqr.totalRows },
    // compressQueryResult emits data:'' for errors; only attach a data facet when there are rows.
    ...(cqr.data ? { data: { markdown: cqr.data, shownRows: cqr.shownRows, truncated: cqr.truncated } } : {}),
  };
}

function toEntry(fs: CompressedFileState, qrById: Map<string, AugmentedQueryResult>): AugmentedFileEntry {
  const entry: AugmentedFileEntry = { id: fs.id, data: toFileData(fs) };
  if (typeof fs.markup === 'string') entry.content = { markup: fs.markup };
  if (fs.image?.key) {
    entry.image = {
      key: fs.image.key,
      image: { type: 'image', ...(fs.image.url ? { url: fs.image.url } : { data: fs.image.data, mimeType: fs.image.mimeType }) },
    };
  }
  const qr = fs.queryResultId ? qrById.get(fs.queryResultId) : undefined;
  if (qr) entry.queryResults = [qr];
  return entry;
}

/** Convert a CompressedAugmentedFile into the rich AugmentedFiles the projector consumes. */
export function compressedToAugmentedFiles(aug: CompressedAugmentedFile): AugmentedFiles {
  const qrById = new Map<string, AugmentedQueryResult>();
  for (const cqr of aug.queryResults ?? []) {
    const a = toAugmentedQueryResult(cqr);
    if (a) qrById.set(a.queryResultId, a);
  }
  return {
    file: toEntry(aug.fileState, qrById),
    references: (aug.references ?? []).map((r) => toEntry(r, qrById)),
  };
}
