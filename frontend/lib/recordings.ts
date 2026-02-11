import 'server-only';
import pako from 'pako';
import { FilesAPI } from '@/lib/data/files.server';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import {
  SessionRecordingFileContent,
  SessionRecordingMetadata,
  FileType
} from '@/lib/types';
import { resolvePath } from '@/lib/mode/path-resolver';

export type RRWebEvent = any; // rrweb event type (imported from rrweb on client)

/**
 * Compress events array to gzipped base64 string
 */
export function compressEvents(events: RRWebEvent[]): string {
  const jsonStr = JSON.stringify(events);
  const uncompressed = Buffer.from(jsonStr, 'utf-8');
  const compressed = pako.gzip(uncompressed);
  return Buffer.from(compressed).toString('base64');
}

/**
 * Decompress gzipped base64 string to events array
 */
export function decompressEvents(compressed: string): RRWebEvent[] {
  const buffer = Buffer.from(compressed, 'base64');
  const decompressed = pako.ungzip(buffer, { to: 'string' });
  return JSON.parse(decompressed);
}

/**
 * Calculate size of events array in bytes
 */
export function calculateEventSize(events: RRWebEvent[]): number {
  return Buffer.from(JSON.stringify(events), 'utf-8').length;
}

/**
 * Create new recording file
 */
export async function createRecording(
  pageType: FileType | 'explore',
  user: EffectiveUser
): Promise<{ fileId: number; path: string }> {
  const userId = user.userId?.toString() || user.email;
  const timestamp = Date.now();
  const now = new Date().toISOString();

  // Generate file name and path
  const fileName = `${timestamp}-recording.session.json`;
  const path = resolvePath(user.mode, `/logs/recordings/${userId}/${fileName}`);

  // Initial recording content (name stored in file.name, not content)
  const content: SessionRecordingFileContent = {
    metadata: {
      userId,
      sessionStartTime: now,
      duration: 0,
      eventCount: 0,
      pageType,
      compressed: true,
      recordedAt: now,
      uncompressedSize: 0,
      compressedSize: 0
    },
    events: compressEvents([]) // Empty events array
  };

  const result = await FilesAPI.createFile(
    {
      name: fileName,
      path,
      type: 'session',
      content: content as any,
      options: {
        createPath: true,
        returnExisting: false
      }
    },
    user
  );

  return {
    fileId: result.data.id,
    path: result.data.path
  };
}

/**
 * Append events to existing recording
 */
export async function appendEvents(
  fileId: number,
  newEvents: RRWebEvent[],
  user: EffectiveUser
): Promise<{ eventCount: number; compressedSize: number; uncompressedSize: number }> {
  // Load existing recording
  const fileResult = await FilesAPI.loadFile(fileId, user);
  const content = fileResult.data.content as unknown as SessionRecordingFileContent;

  // Decompress existing events
  const existingEvents = decompressEvents(content.events);

  // Append new events
  const allEvents = [...existingEvents, ...newEvents];

  // Compress merged events
  const compressedEvents = compressEvents(allEvents);
  const uncompressedSize = calculateEventSize(allEvents);
  const compressedSize = Buffer.from(compressedEvents, 'base64').length;

  // Update metadata
  const updatedContent: SessionRecordingFileContent = {
    ...content,
    metadata: {
      ...content.metadata,
      eventCount: allEvents.length,
      uncompressedSize,
      compressedSize
    },
    events: compressedEvents
  };

  // Save updated recording
  await FilesAPI.saveFile(
    fileId,
    fileResult.data.name,
    fileResult.data.path,
    updatedContent as any,
    [],  // Phase 6: Recordings have no references
    user
  );

  return {
    eventCount: allEvents.length,
    compressedSize,
    uncompressedSize
  };
}

/**
 * Stop recording (set end time and final duration)
 */
export async function stopRecording(
  fileId: number,
  user: EffectiveUser
): Promise<{ duration: number }> {
  // Load recording
  const fileResult = await FilesAPI.loadFile(fileId, user);
  const content = fileResult.data.content as unknown as SessionRecordingFileContent;

  const now = new Date().toISOString();
  const startTime = new Date(content.metadata.sessionStartTime);
  const endTime = new Date(now);
  const duration = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);

  // Update metadata
  const updatedContent: SessionRecordingFileContent = {
    ...content,
    metadata: {
      ...content.metadata,
      sessionEndTime: now,
      duration
    }
  };

  // Save
  await FilesAPI.saveFile(
    fileId,
    fileResult.data.name,
    fileResult.data.path,
    updatedContent as any,
    [],  // Phase 6: Recordings have no references
    user
  );

  return { duration };
}

/**
 * Get recording file
 */
export async function getRecording(
  fileId: number,
  user: EffectiveUser
): Promise<SessionRecordingFileContent> {
  const fileResult = await FilesAPI.loadFile(fileId, user);
  return fileResult.data.content as unknown as SessionRecordingFileContent;
}

/**
 * Check if size limit reached (30 min or 50MB uncompressed)
 */
export function isSizeLimitReached(
  duration: number,
  uncompressedSize: number
): boolean {
  const MAX_DURATION_SECONDS = 30 * 60; // 30 minutes
  const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

  return duration >= MAX_DURATION_SECONDS || uncompressedSize >= MAX_SIZE_BYTES;
}
