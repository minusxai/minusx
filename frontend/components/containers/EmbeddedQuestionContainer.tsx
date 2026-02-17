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
    // Use external params if provided (from dashboard), otherwise use question params
    const paramsToUse = externalParameters || localQuestion.parameters || [];
    return paramsToUse.reduce((acc, p) => ({
      ...acc,
      [p.name]: p.value
    }), {} as Record<string, any>);
  }, [externalParameters, localQuestion.parameters]);

  // Phase 3: Use useQueryResult hook for automatic execution with TTL caching
  const {
    data: queryData,
    loading,
    error,
    isStale,
    refetch
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
      typesButtonsOrientation: 'vertical'
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
