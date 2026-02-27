export interface LLMLogStats {
  stats?: Record<string, unknown> | null;
  logs?: Record<string, unknown> | null;
}

export async function getLLMLogStats(callId: string): Promise<LLMLogStats> {
  try {
    const res = await fetch(`/api/llm-calls/${callId}`);
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}
