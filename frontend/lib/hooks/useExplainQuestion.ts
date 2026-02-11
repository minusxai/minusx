'use client';

import { useCallback } from 'react';
import { useAppDispatch } from '@/store/hooks';
import {
  setSidebarPendingMessage,
  setRightSidebarCollapsed,
  setActiveSidebarSection,
} from '@/store/uiSlice';

/**
 * Hook that triggers an AI explanation for a question.
 * Sets the pending message, opens the sidebar, and switches to chat tab.
 */
export function useExplainQuestion() {
  const dispatch = useAppDispatch();

  const explainQuestion = useCallback((questionId: number) => {
    const message = `Explain this question: a one liner about the goal of the query, and comment on what the results indicate. Question ID: ${questionId}`;

    // Set the pending message for the chat
    dispatch(setSidebarPendingMessage(message));

    // Open the sidebar
    dispatch(setRightSidebarCollapsed(false));

    // Switch to chat tab
    dispatch(setActiveSidebarSection('chat'));
  }, [dispatch]);

  return { explainQuestion };
}
