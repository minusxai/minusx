import type { Message } from '@/orchestrator/llm';
import type { ModelRates } from '@/lib/convo-debug/types';
import type { ChatRequest } from '@/lib/chat/chat-types';

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

export interface ConversationLlmCallsResponse {
  calls: Array<{ callId: string; stats: Record<string, unknown>; requestJson: string | null }>;
  rates: ModelRates;
}

/** All recorded LLM calls of one conversation + catalog rates (admin only). */
export async function getConversationLlmCalls(conversationId: number): Promise<ConversationLlmCallsResponse> {
  const res = await fetch(`/api/conversations/${conversationId}/llm-calls`);
  if (!res.ok) throw new Error(`Failed to load LLM calls (${res.status})`);
  return res.json();
}

export interface DebugContextResponse {
  conversationID: number;
  systemPrompt: string;
  messages: Message[];
  toolDefsChars: number;
}

/** The projected next-turn Context for the /debug visualization (admin only). */
export async function getDebugContext(body: ChatRequest): Promise<DebugContextResponse> {
  const res = await fetch('/api/chat/debug-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to load debug context');
  }
  return data;
}
