'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useRecordingManager } from './useRecordingManager';

interface RecordingContextValue {
  startRecording: (pageType?: string) => Promise<void>;
  stopRecording: () => Promise<void>;
  isRecording: boolean;
  activeRecordingId: number | null;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

export function RecordingProvider({ children }: { children: ReactNode }) {
  const recordingManager = useRecordingManager();

  return (
    <RecordingContext.Provider value={recordingManager}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecording() {
  const context = useContext(RecordingContext);
  if (!context) {
    throw new Error('useRecording must be used within RecordingProvider');
  }
  return context;
}
