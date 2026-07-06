/**
 * The pure projector — turns one turn's rich {@link AugmentedFiles} into its LLM-facing
 * projection ({@link ProjectedFilesOutput}: lean JSON + out-of-JSON markup/data/image blocks),
 * diffing every facet against a caller-owned {@link FacetMemo}.
 *
 * This is the heart of the append-only-log → LLM-message conversion (Phase C). It is pure and
 * memo-driven so it can be unit-tested exhaustively and reused by both the client and headless
 * projection paths. The caller walks the emitted turns IN ORDER through a single memo (and
 * `memo.reset()`s at a summarization boundary); within a turn, references are projected with
 * the same per-id keys as the primary file, so a file that appears as primary in one turn and
 * as a reference in another still dedups correctly.
 *
 * Facet → memo key scheme (stable across turns):
 *   file:<id>:data | file:<id>:content | file:<id>:image
 *   qr:<queryResultId>:summary | qr:<queryResultId>:data | qr:<queryResultId>:image
 *
 * Heavy/opaque facets (markup, query `data`, images) never go in the JSON: when CHANGED they
 * are emitted as separate blocks and signaled `{state:'present'}`; when UNCHANGED no block is
 * emitted and the JSON signals `{state:'unchanged'}`; when ABSENT the field is omitted. Images
 * diff on their stable `key` (not the payload) so we never hash base64.
 */
import { FacetMemo, isUnchanged } from './facets';
import type {
  AugmentedFileEntry,
  AugmentedFiles,
  BlockFacetSignal,
  ChangedQueryResultJson,
  ProjectedFileJson,
  ProjectedFilesJson,
  ProjectedFilesOutput,
  ProjectedQueryResultJson,
  ProjectionTextBlock,
} from './types';
import type { ImageContent } from '@/orchestrator/llm';

const PRESENT: BlockFacetSignal = { state: 'present' };
const UNCHANGED: BlockFacetSignal = { state: 'unchanged' };

/**
 * Cap the executed SQL echoed into a projected query result. A pathological `finalQuery` (giant
 * generated `IN (...)` lists, wide `UNION ALL` scaffolding) can run to many KB and is re-diffed
 * every turn. The agent already has the AUTHORED query in the file's `<file_markup>`; app state only
 * needs a recognizable echo of what actually ran. Over the limit we keep the head (the SELECT / shape)
 * and the tail (ORDER BY / LIMIT) and elide the middle, with an explicit marker of how much was cut.
 */
const FINAL_QUERY_MAX = 1000;
const FINAL_QUERY_HEAD = 500;
const FINAL_QUERY_TAIL = 500;
function truncateFinalQuery(sql: string): string {
  if (sql.length <= FINAL_QUERY_MAX) return sql;
  const elided = sql.length - FINAL_QUERY_HEAD - FINAL_QUERY_TAIL;
  return `${sql.slice(0, FINAL_QUERY_HEAD)} … [${elided} chars truncated] … ${sql.slice(-FINAL_QUERY_TAIL)}`;
}

/**
 * Drop the row `data` facet from a file entry's query results, keeping the `summary`. Shared by the
 * app-state projection (summary-only by default) and ReadFiles (image-presented questions). Returns
 * a shallow copy; the source is untouched.
 */
export function stripEntryQueryData(entry: AugmentedFileEntry): AugmentedFileEntry {
  if (!entry.queryResults?.length) return entry;
  return { ...entry, queryResults: entry.queryResults.map(({ data: _drop, ...qr }) => qr) };
}

/**
 * Drop the JSX `content` (markup) facet from a file entry, keeping data / image / queryResults.
 * Used by EditFile: the agent already knows the new markup from the prior app state + the edit args,
 * so EditFile echoes the new query RESULT (data it can't derive) but not the markup.
 */
export function stripEntryMarkup(entry: AugmentedFileEntry): AugmentedFileEntry {
  if (entry.content === undefined) return entry;
  const { content: _drop, ...rest } = entry;
  return rest;
}

interface EntryProjection {
  json: ProjectedFileJson;
  textBlocks: ProjectionTextBlock[];
  images: ImageContent[];
}

interface EntryOptions {
  /**
   * Whether to project this file's JSX `markup` at all. References are metadata-only by policy
   * (the agent reads a reference's markup by ReadFile-ing it, not from app state), so they pass
   * `false`: the `content` facet is neither diffed nor emitted. The primary file passes `true`.
   */
  includeMarkup: boolean;
}

function projectEntry(memo: FacetMemo, entry: AugmentedFileEntry, opts: EntryOptions): EntryProjection {
  const { id } = entry;
  const textBlocks: ProjectionTextBlock[] = [];
  const images: ImageContent[] = [];

  const json: ProjectedFileJson = {
    id,
    // `data` is small metadata → diffed inline in the JSON.
    data: memo.diff(`file:${id}:data`, entry.data)!,
  };

  // markup — out-of-JSON block when changed. Suppressed entirely for references (policy).
  if (opts.includeMarkup && entry.content) {
    const d = memo.diff(`file:${id}:content`, entry.content);
    if (isUnchanged(d)) {
      json.content = UNCHANGED;
    } else {
      json.content = PRESENT;
      textBlocks.push({ kind: 'markup', fileId: id, type: entry.data.type, text: entry.content.markup });
    }
  }

  // image — diff on the stable key only; emit the payload block when changed.
  if (entry.image) {
    const d = memo.diff(`file:${id}:image`, { key: entry.image.key });
    if (isUnchanged(d)) {
      json.image = UNCHANGED;
    } else {
      json.image = PRESENT;
      images.push(entry.image.image);
    }
  }

  // query results — summary diffed inline; data/image as out-of-JSON blocks.
  if (entry.queryResults?.length) {
    json.queryResults = entry.queryResults.map((qr): ProjectedQueryResultJson => {
      const qid = qr.queryResultId;
      // finalQuery (the executed SQL, truncated when huge) is diffed like summary — an unchanged
      // result re-sends only `{unchanged:true}` instead of the full SQL string every turn.
      const finalQuery = qr.finalQuery !== undefined
        ? memo.diff(`qr:${qid}:finalQuery`, truncateFinalQuery(qr.finalQuery))
        : undefined;
      const summary = memo.diff(`qr:${qid}:summary`, qr.summary)!;

      // data / image are heavy → out-of-JSON blocks (present) or a signal (unchanged). Compute
      // their diffs first (advancing the memo + emitting any changed blocks), THEN decide whether the
      // whole entry collapses.
      let dataSignal: BlockFacetSignal | undefined;
      if (qr.data) {
        const d = memo.diff(`qr:${qid}:data`, qr.data);
        if (isUnchanged(d)) {
          dataSignal = UNCHANGED;
        } else {
          dataSignal = PRESENT;
          textBlocks.push({ kind: 'querydata', queryResultId: qid, text: qr.data.markdown });
        }
      }
      let imageSignal: BlockFacetSignal | undefined;
      if (qr.image) {
        const d = memo.diff(`qr:${qid}:image`, { key: qr.image.key });
        if (isUnchanged(d)) {
          imageSignal = UNCHANGED;
        } else {
          imageSignal = PRESENT;
          images.push(qr.image.image);
        }
      }

      // Collapse the whole entry to `{queryResultId, unchanged:true}` when NOTHING moved: summary
      // unchanged, finalQuery unchanged-or-absent, data/image unchanged-or-absent, and no error to
      // surface. This is what saves a many-question dashboard from re-emitting a per-facet object for
      // every reference every turn. (No blocks were pushed above in this case — data/image were
      // unchanged — so there is nothing to correlate; the memo is already advanced.)
      const finalQueryUnchanged = finalQuery === undefined || isUnchanged(finalQuery);
      const dataUnchanged = dataSignal === undefined || dataSignal === UNCHANGED;
      const imageUnchanged = imageSignal === undefined || imageSignal === UNCHANGED;
      if (qr.error === undefined && isUnchanged(summary) && finalQueryUnchanged && dataUnchanged && imageUnchanged) {
        return { queryResultId: qid, unchanged: true };
      }

      const pj: ChangedQueryResultJson = {
        queryResultId: qid,
        ...(finalQuery !== undefined ? { finalQuery } : {}),
        ...(qr.error !== undefined ? { error: qr.error } : {}),
        summary,
      };
      if (dataSignal) pj.data = dataSignal;
      if (imageSignal) pj.image = imageSignal;
      return pj;
    });
  }

  return { json, textBlocks, images };
}

/**
 * Project one turn's files (focused file + references) against the memo, mutating it forward.
 * Returns the lean JSON plus every out-of-JSON block to splice in after it.
 */
export function projectFiles(memo: FacetMemo, augmented: AugmentedFiles): ProjectedFilesOutput {
  const primary = projectEntry(memo, augmented.file, { includeMarkup: true });
  const refs = augmented.references.map((r) => projectEntry(memo, r, { includeMarkup: false }));

  const json: ProjectedFilesJson = {
    file: primary.json,
    references: refs.map((r) => r.json),
  };
  return {
    json,
    textBlocks: [primary.textBlocks, ...refs.map((r) => r.textBlocks)].flat(),
    images: [primary.images, ...refs.map((r) => r.images)].flat(),
  };
}
