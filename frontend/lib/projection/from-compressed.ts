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
import type { ImageContent } from '@/orchestrator/llm';
import type {
  AugmentedFileEntry,
  AugmentedFiles,
  AugmentedQueryResult,
  FileData,
} from './types';

const DATA_URL_RE = /^data:([^;]+);base64,(.*)$/;

/**
 * Normalize a stored file image into an {@link ImageContent}. A `data:` URL (dev/base64 uploads)
 * MUST be split into `{ data, mimeType }` — sending it verbatim in `url` makes the provider report
 * an undefined MIME type (mirrors the attachment normalization in attachments.server.ts). A remote
 * http(s) URL (S3) is passed through as `url`.
 */
function toImageContent(img: NonNullable<CompressedFileState['image']>): ImageContent {
  const m = img.url ? DATA_URL_RE.exec(img.url) : null;
  if (m) return { type: 'image', mimeType: m[1], data: m[2] };
  if (img.url) return { type: 'image', url: img.url };
  return { type: 'image', data: img.data, mimeType: img.mimeType };
}

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
    entry.image = { key: fs.image.key, image: toImageContent(fs.image) };
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
  const consumed = new Set<string>();
  const toTracked = (fs: CompressedFileState): AugmentedFileEntry => {
    const entry = toEntry(fs, qrById);
    for (const q of entry.queryResults ?? []) consumed.add(q.queryResultId);
    return entry;
  };
  const file = toTracked(aug.fileState);
  const references = (aug.references ?? []).map(toTracked);
  // Orphaned results — a story's/notebook's inline questions run with their own queryResultId, which
  // no file's `queryResultId` matches. Attach them to the PRIMARY file so the agent still sees them
  // (otherwise they'd be silently dropped from app state / ReadFiles / EditFile responses).
  const orphans = [...qrById.values()].filter((q) => !consumed.has(q.queryResultId));
  if (orphans.length) file.queryResults = [...(file.queryResults ?? []), ...orphans];
  return { file, references };
}
