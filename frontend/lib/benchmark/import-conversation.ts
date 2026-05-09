import type { ConversationLog } from '@/orchestrator/types';

/**
 * POST a benchmark run's pi-ai conversation log to /api/benchmark/import,
 * which persists it as a v=2 conversation file in the documents DB and
 * returns the new fileId. The caller can then navigate to
 * `/explore/<fileId>?v=2` to continue the conversation in the chat UI.
 *
 * Throws if the import endpoint responds non-2xx.
 */
export async function importBenchmarkConversation(
  log: ConversationLog,
  label?: string,
): Promise<number> {
  const res = await fetch('/api/benchmark/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(label !== undefined ? { log, label } : { log }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/benchmark/import failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { fileId: number };
  return body.fileId;
}
