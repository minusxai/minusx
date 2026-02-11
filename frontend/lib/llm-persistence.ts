import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { LLMCallDetail } from '@/lib/chat-orchestration';
import { resolvePath } from '@/lib/mode/path-resolver';

export interface LLMCallFileContent {
  conversationID: number;
  llm_call_id: string;
  model: string;
  duration: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
  finish_reason?: string | null;
  extra?: Record<string, any> | null;
  created_at: string;
}

/**
 * Persist LLM call details to file system (non-blocking)
 */
export async function persistLLMCalls(
  llmCalls: Record<string, LLMCallDetail> | undefined,
  conversationID: number,
  user: EffectiveUser
): Promise<void> {
  if (!llmCalls || Object.keys(llmCalls).length === 0) {
    return;
  }

  const userId = user.userId?.toString() || user.email;
  const now = new Date().toISOString();

  // Persist all LLM calls in parallel
  const persistPromises = Object.values(llmCalls).map(async (callDetail) => {
    try {
      const content: LLMCallFileContent = {
        conversationID,
        ...callDetail,
        created_at: now
      };

      const fileName = `${callDetail.llm_call_id}.json`;
      const path = resolvePath(user.mode, `/logs/llm_calls/${userId}/${fileName}`);

      await FilesAPI.createFile(
        {
          name: fileName,
          path,
          type: 'llm_call',
          content: content as any,
          options: {
            createPath: true,
            returnExisting: false
          }
        },
        user
      );

      console.log(`[LLM Persistence] Saved: ${callDetail.llm_call_id}`);
    } catch (error: any) {
      // Non-blocking: Log error but don't fail the request
      console.error(
        `[LLM Persistence] Failed to persist ${callDetail.llm_call_id}:`,
        error.message
      );
    }
  });

  await Promise.allSettled(persistPromises);
}
