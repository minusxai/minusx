import { getStore } from '@/store/store';
import { setQueryResult } from '@/store/queryResultsSlice';
import type { SpreadsheetSource } from '@/lib/types';
import { getSpreadsheetExecution, runSpreadsheetSource, type SpreadsheetRunResult } from './materialize';

/** Materialize and publish a complete direct-data result into the existing result cache. */
export function cacheSpreadsheetSource(source: SpreadsheetSource): SpreadsheetRunResult {
  const result = runSpreadsheetSource(source);
  if (!result.ok) return result;
  const execution = getSpreadsheetExecution(source);
  getStore().dispatch(setQueryResult({
    query: execution.query,
    params: execution.params,
    database: execution.database,
    data: result.data,
  }));
  return result;
}
