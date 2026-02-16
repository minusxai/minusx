/**
 * ReadFiles - Load multiple files with references and query results
 *
 * Phase 1: Unified File System API
 *
 * Loads files from Redux state, includes:
 * - Merged content (base + persistableChanges + ephemeralChanges)
 * - All references (unique across all loaded files)
 * - All query results (for questions)
 */

import { ReadFilesInput, ReadFilesOutput, FileState, QueryResult } from '@/lib/types';
import { RootState } from '@/store/store';
import { selectMergedContent } from '@/store/filesSlice';
import { selectQueryResult } from '@/store/queryResultsSlice';
import type { QuestionContent } from '@/lib/types';

/**
 * ReadFiles implementation
 *
 * @param input - File IDs to load
 * @param getState - Redux getState function (for server-side access)
 * @returns Augmented files with references and query results
 */
export async function readFiles(
  input: ReadFilesInput,
  getState: () => RootState
): Promise<ReadFilesOutput> {
  const { fileIds } = input;
  const state = getState();

  // Load all requested files
  const fileStates: FileState[] = [];
  const referenceIds = new Set<number>();
  const queryResultsMap = new Map<string, QueryResult>();

  for (const fileId of fileIds) {
    const fileState = state.files.files[fileId];
    if (!fileState) {
      throw new Error(`File ${fileId} not found`);
    }

    fileStates.push(fileState);

    // Collect reference IDs
    if (fileState.references) {
      fileState.references.forEach(refId => referenceIds.add(refId));
    }

    // Collect query results for questions
    if (fileState.type === 'question') {
      const mergedContent = selectMergedContent(state, fileId) as QuestionContent;
      if (mergedContent) {
        const { query, parameters, database_name } = mergedContent;
        const params = (parameters || []).reduce<Record<string, any>>((acc, p) => {
          acc[p.name] = p.value ?? '';
          return acc;
        }, {});

        const queryResult = selectQueryResult(state, query, params, database_name);
        if (queryResult && queryResult.data) {
          const key = `${database_name}|||${query}|||${JSON.stringify(params)}`;
          queryResultsMap.set(key, {
            columns: queryResult.data.columns || [],
            types: queryResult.data.types || [],
            rows: queryResult.data.rows || []
          });
        }
      }
    }
  }

  // Load all unique references
  const references: FileState[] = [];
  for (const refId of referenceIds) {
    const refState = state.files.files[refId];
    if (refState) {
      references.push(refState);

      // Also collect query results for referenced questions
      if (refState.type === 'question') {
        const mergedContent = selectMergedContent(state, refId) as QuestionContent;
        if (mergedContent) {
          const { query, parameters, database_name } = mergedContent;
          const params = (parameters || []).reduce<Record<string, any>>((acc, p) => {
            acc[p.name] = p.value ?? '';
            return acc;
          }, {});

          const queryResult = selectQueryResult(state, query, params, database_name);
          if (queryResult && queryResult.data) {
            const key = `${database_name}|||${query}|||${JSON.stringify(params)}`;
            queryResultsMap.set(key, {
              columns: queryResult.data.columns || [],
              types: queryResult.data.types || [],
              rows: queryResult.data.rows || []
            });
          }
        }
      }
    }
  }

  return {
    fileStates,
    references,
    queryResults: Array.from(queryResultsMap.values())
  };
}
