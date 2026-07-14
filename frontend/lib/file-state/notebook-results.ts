/**
 * Notebook cell result persistence
 *
 * Notebook SQL cell results are cached into NotebookContent.cellResults so a
 * reopened notebook renders charts/tables without re-running. Capturing a fresh
 * result is a normal content edit (marks the notebook dirty → persisted on Save).
 * On open, snapshots whose queryHash still matches the cell are rehydrated into
 * the query cache + cellExecuted, so the existing render path shows them.
 */

import { getStore } from '@/store/store';
import { selectMergedContent, setNotebookCellExecuted, setNotebookCellResults, type FileId } from '@/store/filesSlice';
import { setQueryResult } from '@/store/queryResultsSlice';
import { getQueryHash } from '@/lib/utils/query-hash';
import { sortObjectKeysDeep } from '@/lib/chat/file-encoding';

/** Max rows persisted per cell; larger results are capped (or skipped if still too big). */
const CELL_RESULT_ROW_CAP = 2000;
/** Max serialized bytes for a single cell's data; over this we skip persistence. */
const CELL_RESULT_BYTE_CAP = 256 * 1024;

interface CellExecutedLike { query: string; params: Record<string, unknown>; database: string }
interface QueryResultLike { columns?: string[]; types?: string[]; rows?: unknown[] }

/**
 * Capture a SQL cell's freshly-run result into the notebook content (capped).
 * No-op when the identical result is already stored (avoids spurious dirtying).
 */
export function captureNotebookCellResult(
  fileId: FileId,
  cellId: string,
  executed: CellExecutedLike,
  data: QueryResultLike | null | undefined,
): void {
  if (!data || !Array.isArray(data.rows)) return;
  const truncated = data.rows.length > CELL_RESULT_ROW_CAP;
  const snapData = {
    columns: data.columns ?? [],
    types: data.types ?? [],
    rows: truncated ? data.rows.slice(0, CELL_RESULT_ROW_CAP) : data.rows,
  };
  // Hard byte cap: a single huge cell shouldn't bloat the document.
  if (JSON.stringify(snapData).length > CELL_RESULT_BYTE_CAP) return;

  const snapshot = {
    queryHash: getQueryHash(executed.query, executed.params, executed.database),
    executedAt: Date.now(),
    data: snapData,
    ...(truncated ? { truncated: true } : {}),
  };

  const content = selectMergedContent(getStore().getState(), fileId) as any;
  const cellResults = content?.cellResults ?? {};
  const existing = cellResults[cellId];
  if (
    existing &&
    existing.queryHash === snapshot.queryHash &&
    // Order-insensitive: stored content has deep-sorted keys (dbFileToFileState).
    JSON.stringify(sortObjectKeysDeep(existing.data)) === JSON.stringify(sortObjectKeysDeep(snapData))
  ) {
    return; // same data already stored — don't churn dirty state
  }
  // Write the FULL next map (replace semantics) so already-saved cells aren't
  // dropped by selectMergedContent's shallow overlay of persistableChanges.
  getStore().dispatch(setNotebookCellResults({ fileId, cellResults: { ...cellResults, [cellId]: snapshot } }));
}

/**
 * Drop a cell's cached result (e.g. when the cell is deleted) so stale snapshots
 * don't linger in the notebook content. No-op if there's nothing stored for it.
 */
export function removeNotebookCellResult(fileId: FileId, cellId: string): void {
  const content = selectMergedContent(getStore().getState(), fileId) as any;
  const cellResults = content?.cellResults;
  if (!cellResults || !(cellId in cellResults)) return;
  const { [cellId]: _removed, ...rest } = cellResults;
  getStore().dispatch(setNotebookCellResults({ fileId, cellResults: rest }));
}

/**
 * Rehydrate persisted cell results on notebook open: for each snapshot whose
 * queryHash still matches the cell's current query, seed the query cache and mark
 * the cell executed so the existing render path shows the chart/table — no rerun.
 */
export function rehydrateNotebookResults(fileId: FileId): void {
  const content = selectMergedContent(getStore().getState(), fileId) as any;
  const cellResults = content?.cellResults;
  if (!content?.cells || !cellResults) return;
  for (const cell of content.cells) {
    if (cell?.type !== 'sql' || !cell.query || !cell.connection_name) continue;
    const snap = cellResults[cell.id];
    if (!snap?.data) continue;
    const params = cell.parameterValues ?? {};
    if (snap.queryHash !== getQueryHash(cell.query, params, cell.connection_name)) continue;
    getStore().dispatch(setQueryResult({ query: cell.query, params, database: cell.connection_name, data: snap.data }));
    getStore().dispatch(setNotebookCellExecuted({
      fileId,
      cellId: cell.id,
      executed: { query: cell.query, params, database: cell.connection_name },
    }));
  }
}
