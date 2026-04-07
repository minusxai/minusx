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
import { QuestionContent, QuestionParameter } from '@/lib/types';
import { useQueryResult } from '@/lib/hooks/file-state-hooks';

interface EmbeddedQuestionContainerProps {
  question: QuestionContent;
  questionId: number;
  externalParameters?: QuestionParameter[];
  externalParamValues?: Record<string, any>;  // Runtime parameter values from parent (e.g., dashboard ephemeral state)
  onChange?: (updates: Partial<QuestionContent>) => void;
}

/**
 * Lightweight container for questions embedded in dashboards/explore
 * Uses Phase 3 useQueryResult hook for automatic execution and caching
 * No Redux - uses local state since parent handles persistence
 */
export default function EmbeddedQuestionContainer({
  question,
  questionId,
  externalParameters,
  externalParamValues,
  onChange,
}: EmbeddedQuestionContainerProps) {
  // Local state for embedded question (no Redux)
  const [localQuestion, setLocalQuestion] = useState<QuestionContent>(question);

  // Update local state when prop changes (dashboard updates)
  useEffect(() => {
    setLocalQuestion(question);
  }, [question]);

  // Phase 3: Convert parameters to format useQueryResult expects
  const queryParams = useMemo(() => {
    const questionParams = localQuestion.parameters || [];
    const ownParamValues = localQuestion.parameterValues || {};
    if (!externalParameters && !externalParamValues) {
      // No external params — use question's own parameterValues
      return questionParams.reduce((acc, p) => ({ ...acc, [p.name]: ownParamValues[p.name] ?? '' }), {} as Record<string, any>);
    }
    // Use explicit values dict if provided (from dashboard state),
    // fall back to question's own parameterValues only when the key is absent.
    // Key-existence check (not ??) ensures explicit null (None) is never overridden.
    // Only include params the question actually uses to avoid polluting cache key.
    return questionParams.reduce((acc, p) => ({
      ...acc,
      [p.name]: (externalParamValues && p.name in externalParamValues)
        ? externalParamValues[p.name]
        : (ownParamValues[p.name] ?? '')
    }), {} as Record<string, any>);
  }, [externalParameters, externalParamValues, localQuestion.parameters, localQuestion.parameterValues]);

  // Phase 3: Use useQueryResult hook for automatic execution with TTL caching
  const {
    data: queryData,
    loading,
    error,
    isStale,
  } = useQueryResult(
    localQuestion.query || '',
    queryParams,
    localQuestion.database_name || '', // Empty string if missing, rely on skip to prevent execution
    localQuestion.references || [],
    { skip: !localQuestion.query || !localQuestion.database_name } // Skip if no query or no database
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
    fixError: false
  };

  return (
    <QuestionVisualization
      currentState={localQuestion}
      config={config}
      loading={loading}
      error={error}
      data={queryData}
      onVizTypeChange={handleVizTypeChange}
      onAxisChange={handleAxisChange}
    />
  );
}
