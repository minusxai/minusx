import { useState, useEffect, useMemo } from 'react';
import { FilesAPI } from '@/lib/data/files';
import { QuestionContent } from '@/lib/types';
import { generateReferenceAlias } from '@/lib/sql/sql-references';

/**
 * Question option for autocomplete
 */
export interface QuestionOption {
  id: number;
  name: string;
  alias: string;      // Pre-generated alias (e.g., "43_revenue_by_month")
  database_name?: string;
}

/**
 * Hook to fetch and filter available questions for reference autocomplete
 *
 * Filters:
 * - Same connection (if currentConnectionId is set)
 * - No self-reference
 * - No nested refs (single-level only - can't reference questions that have references)
 *
 * @param currentQuestionId - ID of the current question (to exclude self)
 * @param currentConnectionId - Database connection name (to filter by same connection)
 * @param excludedIds - IDs to exclude (already referenced)
 */
export function useAvailableQuestions(
  currentQuestionId: number | undefined,
  currentConnectionId: string | undefined,
  excludedIds: number[] = []
): { questions: QuestionOption[]; loading: boolean } {
  const [allQuestions, setAllQuestions] = useState<QuestionOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Load all questions on mount
  useEffect(() => {
    let cancelled = false;

    async function loadQuestions() {
      setLoading(true);
      try {
        // Get all questions (metadata only, partial load)
        const { data: allFiles } = await FilesAPI.getFiles({
          type: 'question',
          depth: 999
        });

        if (cancelled) return;

        // Load full content for questions to check references
        const { data: fullQuestions } = await FilesAPI.loadFiles(
          allFiles.map(f => f.id)
        );

        if (cancelled) return;

        const questionOptions: QuestionOption[] = fullQuestions
          .filter(q => {
            const content = q.content as QuestionContent;
            // Single-level: Exclude questions that have references
            return (content.references?.length ?? 0) === 0;
          })
          .map(q => {
            const content = q.content as QuestionContent;
            return {
              id: q.id,
              name: q.name || 'Untitled Question',
              alias: generateReferenceAlias(q.id, q.name || 'untitled'),
              database_name: content.database_name
            };
          });

        setAllQuestions(questionOptions);
      } catch (error) {
        console.error('[useAvailableQuestions] Failed to load questions:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadQuestions();

    return () => {
      cancelled = true;
    };
  }, []);

  // Filter available questions based on current context
  const questions = useMemo(() => {
    return allQuestions.filter(q => {
      // Can't reference self
      if (currentQuestionId !== undefined && q.id === currentQuestionId) return false;

      // No duplicates (already excluded)
      if (excludedIds.includes(q.id)) return false;

      // Same connection only (if currentConnectionId is set)
      if (currentConnectionId && q.database_name !== currentConnectionId) return false;

      return true;
    });
  }, [allQuestions, currentQuestionId, excludedIds, currentConnectionId]);

  return { questions, loading };
}
