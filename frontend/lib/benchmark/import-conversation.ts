import type { ConversationLog } from '@/orchestrator/types';
import type { BenchmarkConnectionEntry } from '@/agents/benchmark-analyst/connection-source';

export interface ImportBenchmarkOptions {
  label?: string;
  /**
   * The dataset's `connections.json` content (array of
   * {name, dialect, config, description?}). Persisted on the conversation
   * file's `meta.benchmark_connections` so v=2 chat continuation can wire
   * NodeConnector-backed executors. Without it, SQL queries fail with
   * "connector 'X' not loaded".
   */
  connections?: BenchmarkConnectionEntry[];
}

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
  options: ImportBenchmarkOptions = {},
): Promise<number> {
  const payload: { log: ConversationLog; label?: string; connections?: BenchmarkConnectionEntry[] } = { log };
  if (options.label !== undefined) payload.label = options.label;
  if (options.connections !== undefined) payload.connections = options.connections;
  const res = await fetch('/api/benchmark/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/benchmark/import failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { fileId: number };
  return body.fileId;
}
