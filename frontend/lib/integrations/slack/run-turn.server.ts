/**
 * Run a Slack-originated chat turn through the shared v3 turn runner.
 *
 * Slack is a headless (clientless) chat surface: there is no browser to bridge
 * frontend-only tool calls back to, so every inbound Slack message is a fresh
 * `user_message` turn against the conversation's persisted pi log — never a
 * `resume`. This thin wrapper drives `runConversationTurn` (the same machinery
 * that powers browser Explore/side-chat: durable row commits, lease/heartbeat,
 * and error-stream mirroring — see `lib/chat/conversation-turn.server.ts`) and
 * translates the turn's new log entries to the legacy log shape that the
 * Slack-specific reply/chart extractors (`extractSlackReply`,
 * `extractQueryCharts` in `lib/integrations/slack/messages.ts`) consume.
 *
 * `setupOrchestration` (`lib/chat/orchestration-core.server.ts`) picks `SlackAgent`
 * as the root agent and swaps in the headless tool registrables (server-side
 * `ReadFiles`, etc.) whenever `agent === 'SlackAgent'`.
 */
import 'server-only';
import { runConversationTurn } from '@/lib/chat/conversation-turn.server';
import { loadLog, loadMessages } from '@/lib/data/conversations.server';
import { piLogToLegacy } from '@/lib/chat-translator';
import type { ChatRequest } from '@/lib/chat/chat-types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationLog } from '@/orchestrator/types';
import type { ConversationLogEntry as LegacyLogEntry } from '@/lib/types';

export interface SlackTurnResult {
  conversationId: number;
  /** This turn's new entries only (not the full log), translated to the legacy
   *  log shape — what `extractSlackReply`/`extractQueryCharts` consume. */
  logDiff: LegacyLogEntry[];
}

export async function runSlackChatTurn(
  conversationId: number,
  user: EffectiveUser,
  userMessage: string,
  agentArgs: Record<string, unknown>,
): Promise<SlackTurnResult> {
  // Everything at/after this index is new — captured before the turn so the
  // post-turn diff is exactly this turn's entries, not the whole history
  // (extractSlackReply must answer from the CURRENT turn only; see the
  // "stale-answer guard" test).
  const startSeq = (await loadLog(conversationId)).length;

  const body: ChatRequest = {
    user_message: userMessage,
    agent: 'SlackAgent',
    agent_args: agentArgs,
  } as unknown as ChatRequest;

  await runConversationTurn(conversationId, user, body);

  const newRows = await loadMessages(conversationId, startSeq - 1);
  const piDiff = newRows.map((r) => r.content) as ConversationLog;

  return { conversationId, logDiff: piLogToLegacy(piDiff) };
}
