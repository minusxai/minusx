import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from './store';

export interface RecordingsState {
  activeRecordingId: number | null; // File ID of active recording
  isRecording: boolean;              // Recording in progress
}

const initialState: RecordingsState = {
  activeRecordingId: null,
  isRecording: false
};

const recordingsSlice = createSlice({
  name: 'recordings',
  initialState,
  reducers: {
    /**
     * Start recording
     */
    startRecording: (state, action: PayloadAction<number>) => {
      state.activeRecordingId = action.payload;
      state.isRecording = true;
    },

    /**
     * Stop recording
     */
    stopRecording: (state) => {
      state.activeRecordingId = null;
      state.isRecording = false;
    }
  }
});

export const {
  startRecording,
  stopRecording
} = recordingsSlice.actions;

// Selectors
export const selectActiveRecordingId = (state: RootState) => state.recordings.activeRecordingId;
export const selectIsRecording = (state: RootState) => state.recordings.isRecording;

export default recordingsSlice.reducer;
