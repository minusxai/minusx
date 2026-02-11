'use client';

import { useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setColorMode } from '@/store/uiSlice';

/**
 * Component that syncs color mode between localStorage and Redux on app startup
 * This fixes the bug where dark mode is lost on refresh until Settings dialog opens
 */
export function ColorModeSync() {
  const dispatch = useAppDispatch();
  const colorMode = useAppSelector((state) => state.ui.colorMode);

  // Initialize from localStorage on mount (once)
  useEffect(() => {
    const stored = localStorage.getItem('chakra-ui-color-mode');
    const initialMode = stored ? (stored as 'light' | 'dark') : 'dark';

    // If Redux doesn't match localStorage, sync Redux to localStorage
    if (colorMode !== initialMode) {
      console.log(`[ColorModeSync] Syncing Redux (${colorMode}) to localStorage (${initialMode})`);
      dispatch(setColorMode(initialMode));
    }

    // Apply the correct class to root element
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(initialMode);
  }, []); // Run once on mount

  // Sync DOM classes and localStorage whenever Redux state changes
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(colorMode);
    localStorage.setItem('chakra-ui-color-mode', colorMode);
  }, [colorMode]);

  return null; // This component doesn't render anything
}
