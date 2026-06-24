'use client';

/**
 * EmbeddedQuestionContainer - Phase 3 Implementation
 * Used for questions embedded in dashboards/presentations/notebooks
 *
 * Phase 3 improvements:
 * - Uses useQueryResult hook for automatic query execution with TTL caching
 * - Automatic refetch when externalParameters change (hash changes)
 * - Deduplication across multiple dashboard questions with same query
 * - Background refetch for stale data
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { QuestionVisualization, ContainerConfig } from '@/components/question/QuestionVisualization';
import { QuestionContent, QuestionParameter, QuestionReference } from '@/lib/types';
import { useQueryResult } from '@/lib/hooks/file-state-hooks';
import { buildQueryParamValues } from '@/lib/sql/sql-params';

// Stable empty fallback — `localQuestion.references || []` would allocate a
// fresh array on every render, breaking referential equality on `useQueryResult`'s
// dep array and re-firing its effect (which cascades into duplicate /api/query
// round-trips on large dashboards where the LRU can't absorb them).
const EMPTY_REFERENCES: QuestionReference[] = [];

interface EmbeddedQuestionContainerProps {
  question: QuestionContent;
  questionId: number;
  filePath?: string;  // Question file path — forwarded to /api/query for whitelist validation
  externalParameters?: QuestionParameter[];
  externalParamValues?: Record<string, any>;  // Runtime parameter values from parent (e.g., dashboard ephemeral state)
  onChange?: (updates: Partial<QuestionContent>) => void;
  enableDrilldown?: boolean;  // Click-to-drill-down on data points (off for story embeds)
}

/**
 * Lightweight container for questions embedded in dashboards/explore
 * Uses Phase 3 useQueryResult hook for automatic execution and caching
 * No Redux - uses local state since parent handles persistence
 */
export default function EmbeddedQuestionContainer({
  question,
  questionId,
  filePath,
  externalParameters,
  externalParamValues,
  onChange,
  enableDrilldown = true,
}: EmbeddedQuestionContainerProps) {
  // Local state for embedded question (no Redux)
  const [localQuestion, setLocalQuestion] = useState<QuestionContent>(question);

  // Update local state when prop changes (dashboard updates)
  useEffect(() => {
    setLocalQuestion(question);
  }, [question]);

  // Phase 3: Convert parameters to format useQueryResult expects. Explicit external values
  // (dashboard/story) take precedence over the question's own; an empty-string value for a
  // NUMBER param is coerced to None (null) so it doesn't reach the engine as '' (un-castable
  // to a number) — see buildQueryParamValues.
  const queryParams = useMemo(
    () => buildQueryParamValues(localQuestion.parameters || [], localQuestion.parameterValues || {}, externalParamValues),
    [externalParamValues, localQuestion.parameters, localQuestion.parameterValues],
  );

  // Phase 3: Use useQueryResult hook for automatic execution with TTL caching
  const {
    data: queryData,
    loading,
    error,
    isStale,
    refetch,
  } = useQueryResult(
    localQuestion.query || '',
    queryParams,
    localQuestion.connection_name || '', // Empty string if missing, rely on skip to prevent execution
    localQuestion.references || EMPTY_REFERENCES,
    { skip: !localQuestion.query || !localQuestion.connection_name, filePath } // Skip if no query or no database
  );

  // Update handler - propagate changes to parent if onChange provided
  const handleChange = useCallback((updates: Partial<QuestionContent>) => {
    const newQuestion = { ...localQuestion, ...updates };
    setLocalQuestion(newQuestion);
    if (onChange) {
      onChange(updates);
    }
  }, [localQuestion, onChange]);

  // Save handler - for embedded views, this is a no-op (parent handles saving)
  const handleSave = useCallback(() => {
    // Embedded questions don't save independently
    // Parent dashboard handles saving
  }, []);

  // Cancel handler - revert to original question
  const handleCancel = useCallback(() => {
    setLocalQuestion(question);
  }, [question]);

  // Handlers for visualization changes (updates local state + propagates to parent)
  const handleVizTypeChange = useCallback((type: QuestionContent['vizSettings']['type']) => {
    const newQuestion = {
      ...localQuestion,
      vizSettings: { ...localQuestion.vizSettings, type }
    };
    setLocalQuestion(newQuestion);
    if (onChange) {
      onChange({ vizSettings: { ...localQuestion.vizSettings, type } });
    }
  }, [localQuestion, onChange]);

  const handleAxisChange = useCallback((xCols: string[], yCols: string[]) => {
    const newQuestion = {
      ...localQuestion,
      vizSettings: { ...localQuestion.vizSettings, xCols, yCols }
    };
    setLocalQuestion(newQuestion);
    if (onChange) {
      onChange({ vizSettings: { ...localQuestion.vizSettings, xCols, yCols } });
    }
  }, [localQuestion, onChange]);

  // Config for embedded view (minimal UI - just the viz, no controls)
  const config: ContainerConfig = {
    showHeader: false,
    showJsonToggle: false,
    editable: false,
    viz: {
      showTypeButtons: false,
      showChartBuilder: false,
      typesButtonsOrientation: 'vertical',
      showTitle: false
    },
    fixError: false,
    enableDrilldown,
  };

  return (
    <QuestionVisualization
      currentState={localQuestion}
      config={config}
      loading={loading}
      error={error}
      data={queryData}
      onRetry={refetch}
      onVizTypeChange={handleVizTypeChange}
      onAxisChange={handleAxisChange}
    />
  );
}
