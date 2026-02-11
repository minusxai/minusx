'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { record } from 'rrweb';
import {
  startRecording as startRecordingAction,
  stopRecording as stopRecordingAction
} from '@/store/recordingsSlice';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';

const FLUSH_INTERVAL = 5000; // 5 seconds
const MAX_BUFFER_SIZE = 100; // Events
const MAX_DURATION = 30 * 60; // 30 minutes in seconds
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Global recording manager hook
 * Should be called once at the app level (in layout or root component)
 * Manages rrweb recording lifecycle independently of any UI component
 */
export function useRecordingManager() {
  const dispatch = useAppDispatch();
  const activeRecordingId = useAppSelector(state => state.recordings.activeRecordingId);
  const isRecording = useAppSelector(state => state.recordings.isRecording);

  // Global refs that persist across component lifecycles
  const stopRecordingFn = useRef<(() => void) | null>(null);
  const eventBuffer = useRef<any[]>([]);
  const flushInterval = useRef<NodeJS.Timeout | null>(null);

  /**
   * Flush buffered events to server
   */
  const flushEvents = useCallback(async () => {
    if (!activeRecordingId || eventBuffer.current.length === 0) {
      return;
    }

    try {
      const result = await fetchWithCache(`/api/recordings/${activeRecordingId}/events`, {
        method: 'POST',
        body: JSON.stringify({ events: eventBuffer.current }),
        cacheStrategy: API.recordings.addEvents.cache,
      });

      // Clear buffer
      eventBuffer.current = [];

      // Auto-stop if limit reached
      if (result.uncompressedSize >= MAX_SIZE || result.duration >= MAX_DURATION) {
        stopRecording();
      }
    } catch (error) {
      console.error('[RecordingManager] Failed to flush events:', error);
      // Keep events in buffer for retry
    }
  }, [activeRecordingId]);

  /**
   * Start recording
   */
  const startRecording = useCallback(async (pageType: string = 'explore') => {
    if (isRecording) {
      return;
    }

    try {
      // Create recording file
      const result = await fetchWithCache('/api/recordings', {
        method: 'POST',
        body: JSON.stringify({ pageType }),
        cacheStrategy: API.recordings.create.cache,
      });

      const { id } = result;

      // Update Redux state
      dispatch(startRecordingAction(id));

      // Start rrweb recording
      stopRecordingFn.current = record({
        emit: (event) => {
          eventBuffer.current.push(event);

          // Flush if buffer full
          if (eventBuffer.current.length >= MAX_BUFFER_SIZE) {
            flushEvents();
          }
        },
        maskAllInputs: true,
        maskTextSelector: '[data-sensitive]',
        blockClass: 'rr-block',
        sampling: {
          scroll: 150,
          input: 'last'
        }
      }) as (() => void) | null;

      // Start flush interval
      flushInterval.current = setInterval(flushEvents, FLUSH_INTERVAL);
    } catch (error) {
      console.error('[RecordingManager] Failed to start recording:', error);
      throw error;
    }
  }, [isRecording, dispatch, flushEvents]);

  /**
   * Stop recording
   */
  const stopRecording = useCallback(async () => {
    if (!activeRecordingId) {
      return;
    }

    const recordingId = activeRecordingId;

    try {
      // Stop rrweb recording
      if (stopRecordingFn.current) {
        stopRecordingFn.current();
        stopRecordingFn.current = null;
      }

      // Clear flush interval
      if (flushInterval.current) {
        clearInterval(flushInterval.current);
        flushInterval.current = null;
      }

      // Wait for any in-flight events
      await new Promise(resolve => setTimeout(resolve, 100));

      // Flush remaining events
      if (eventBuffer.current.length > 0) {
        try {
          await fetchWithCache(`/api/recordings/${recordingId}/events`, {
            method: 'POST',
            body: JSON.stringify({ events: eventBuffer.current }),
            cacheStrategy: API.recordings.addEvents.cache,
          });
        } catch (error) {
          console.error('[RecordingManager] Failed to flush final events:', error);
        }

        eventBuffer.current = [];
      }

      // Stop recording on server
      await fetchWithCache(`/api/recordings/${recordingId}/stop`, {
        method: 'POST',
        cacheStrategy: API.recordings.stop.cache,
      });

      // Update Redux state
      dispatch(stopRecordingAction());
    } catch (error) {
      console.error('[RecordingManager] Failed to stop recording:', error);
      throw error;
    }
  }, [activeRecordingId, dispatch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (flushInterval.current) {
        clearInterval(flushInterval.current);
      }
    };
  }, []);

  return {
    startRecording,
    stopRecording,
    isRecording,
    activeRecordingId
  };
}
