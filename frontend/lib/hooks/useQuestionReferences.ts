'use client';

/**
 * useQuestionReferences — shared `@`-reference wiring for any SQL surface that
 * embeds saved questions as CTEs (the question page's QuestionViewV2 and the
 * notebook's NotebookSqlCell).
 *
 * It owns the read/derive/sync side of references:
 * - resolves `content.references` → loaded question FileStates (loading missing
 *   ones into Redux),
 * - exposes `availableQuestions` for `@` autocomplete and `resolvedReferences`
 *   for the SqlEditor,
 * - merges parameters declared by referenced questions, and
 * - `handleQueryChange`, which debounces the query edit and re-syncs
 *   references + parameters from the composed SQL.
 *
 * Mutations flow back through the caller's `onChange` (a Partial<QuestionContent>
 * patch), so it works for both file-backed questions and inline notebook cells.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { debounce } from 'lodash';
import { shallowEqual } from 'react-redux';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setFile } from '@/store/filesSlice';
import { FilesAPI } from '@/lib/data/files';
import { syncParametersWithSQL } from '@/lib/sql/sql-params';
import { syncReferencesWithSQL } from '@/lib/sql/sql-references';
import { useAvailableQuestions, type QuestionOption } from '@/lib/hooks/useAvailableQuestions';
import type { FileState } from '@/store/filesSlice';
import type { QuestionContent, QuestionParameter, QuestionReference } from '@/lib/types';

export interface ResolvedReference {
  id: number;
  alias: string;
  query: string;
}

interface UseQuestionReferencesArgs {
  query: string;
  references: QuestionReference[];
  parameters: QuestionParameter[];
  connection_name: string;
  /** Current question id, to exclude self from autocomplete (undefined for inline cells). */
  selfId?: number;
}

type ReferencesPatch = Partial<Pick<QuestionContent, 'query' | 'references' | 'parameters'>>;

export interface UseQuestionReferencesReturn {
  referencedQuestions: Array<QuestionReference & { question?: FileState }>;
  availableQuestions: QuestionOption[];
  resolvedReferences: ResolvedReference[];
  /** Current params merged with params declared by referenced questions. */
  mergedParameters: QuestionParameter[];
  /** Debounced query edit that re-syncs references + parameters from the composed SQL. */
  handleQueryChange: (newQuery: string) => void;
}

export function useQuestionReferences(
  { query, references, parameters, connection_name, selfId }: UseQuestionReferencesArgs,
  onChange: (updates: ReferencesPatch) => void,
): UseQuestionReferencesReturn {
  const dispatch = useAppDispatch();

  // shallowEqual avoids re-rendering when Immer rotates the bag's top-level ref
  // on an unrelated write.
  const filesState = useAppSelector(state => state.files.files, shallowEqual);

  const referencedQuestions = useMemo(() => {
    return (references || []).map(ref => ({ ...ref, question: filesState[ref.id] }));
  }, [references, filesState]);

  const { questions: availableQuestions } = useAvailableQuestions(
    selfId,
    connection_name,
    referencedQuestions.map(r => r.id),
  );

  // Load any referenced questions that aren't in Redux yet (need their query
  // for CTE composition + param extraction).
  useEffect(() => {
    const referencedIds = (references || []).map(ref => ref.id);
    if (referencedIds.length === 0) return;

    const missingIds = referencedIds.filter(id => {
      const file = referencedQuestions.find(r => r.id === id)?.question;
      return !file || !file.content;
    });
    if (missingIds.length === 0) return;

    FilesAPI.loadFiles(missingIds).then(result => {
      result.data.forEach(file => {
        dispatch(setFile({ file, references: [] }));
      });
    }).catch(err => {
      console.error('[useQuestionReferences] Failed to load referenced questions:', err);
    });
  }, [references, referencedQuestions, dispatch]);

  // Current params + params declared by referenced questions (deduped by name+type).
  const mergedParameters = useMemo(() => {
    const currentParams = parameters || [];
    const referencedParams: QuestionParameter[] = [];
    referencedQuestions.forEach(ref => {
      const refContent = ref.question?.content as QuestionContent | undefined;
      refContent?.parameters?.forEach(param => {
        const exists = currentParams.some(p => p.name === param.name && p.type === param.type);
        const alreadyAdded = referencedParams.some(p => p.name === param.name && p.type === param.type);
        if (!exists && !alreadyAdded) referencedParams.push(param);
      });
    });
    return [...currentParams, ...referencedParams];
  }, [parameters, referencedQuestions]);

  const resolvedReferences = useMemo<ResolvedReference[]>(() => {
    return referencedQuestions
      .filter(r => r.question?.content)
      .map(r => ({
        id: r.id,
        alias: r.alias,
        query: (r.question!.content as QuestionContent).query,
      }));
  }, [referencedQuestions]);

  const debouncedQueryUpdate = useMemo(
    () => debounce((q: string) => onChange({ query: q }), 150),
    [onChange],
  );

  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => () => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
  }, []);

  const handleQueryChange = useCallback((newQuery: string) => {
    debouncedQueryUpdate(newQuery);

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      const updatedRefs = syncReferencesWithSQL(newQuery, references || []);

      // Compose current + referenced SQL so params from CTEs are extracted too.
      let composedSQL = newQuery;
      referencedQuestions.forEach(ref => {
        const refContent = ref.question?.content as QuestionContent | undefined;
        if (refContent?.query) composedSQL += '\n' + refContent.query;
      });

      const updatedParams = syncParametersWithSQL(composedSQL, mergedParameters);
      onChange({ parameters: updatedParams, references: updatedRefs });
    }, 300);
  }, [debouncedQueryUpdate, references, referencedQuestions, mergedParameters, onChange]);

  return { referencedQuestions, availableQuestions, resolvedReferences, mergedParameters, handleQueryChange };
}
