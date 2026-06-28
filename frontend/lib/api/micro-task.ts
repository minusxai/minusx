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
