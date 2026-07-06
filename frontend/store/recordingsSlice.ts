import { createSlice, PayloadAction } from '@reduxjs/toolkit';

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

export default recordingsSlice.reducer;
