import { getStore } from '@/store/store';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { selectMergedContent } from '@/store/filesSlice';
import { compressAugmentedFile } from '@/lib/api/compress-augmented';

/**
 * Build the LLM input for a file's micro-task (title/description) from the file's
 * CURRENT, in-memory state — the same augmented view the agent sees:
 *   - merged content (original + unsaved edits), so a draft being saved or a file
 *     with pending edits is captured correctly — this is the file "in question";
 *   - references resolved (a dashboard's referenced questions: names, SQL);
 *   - any query results already in the store.
 *
 * Pure Redux read (no server fetch), so it works for unsaved virtual drafts too.
 * Throws if the file isn't in the store.
 */
export function buildFileMicroInput(fileId: number): string {
  const state = getStore().getState();
  const [augmented] = selectAugmentedFiles(state, [fileId]);
  if (!augmented) throw new Error(`File ${fileId} not available for generation`);
  // selectAugmentedFiles reads raw `.content`; overlay the merged content so the
  // user's unsaved edits (where a draft's content actually lives) are included.
  const merged = selectMergedContent(state, fileId);
  const fileState = merged ? { ...augmented.fileState, content: merged } : augmented.fileState;
  return JSON.stringify(compressAugmentedFile({ ...augmented, fileState }), null, 2);
}

/**
 * Client helper for the generic micro-task agent route (`POST /api/micro-task`).
 *
 * Runs a single named micro-task (title / description / …) and returns the
 * generated text. Unlike the feed-summary call (which caches), this is a fresh
 * one-shot generation, so it does not cache. Throws on a non-OK response.
 */
export async function runMicroTaskClient(
  task: string,
  vars: Record<string, string>,
): Promise<string> {
  const res = await fetch('/api/micro-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, vars }),
  });
  const json = (await res.json()) as { success?: boolean; result?: string; error?: string };
  if (!res.ok || !json.success || typeof json.result !== 'string') {
    throw new Error(json.error || `Micro-task '${task}' failed`);
  }
  return json.result;
}
