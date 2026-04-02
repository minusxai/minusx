import 'server-only';
import { combineContent, parseThinkingAnswer } from '@/lib/utils/xml-parser';
import type { ConversationLogEntry } from '@/lib/types';

function extractToolText(content: unknown): string {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) {
      return '';
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return extractToolText(parsed);
      }
    } catch {
      // Plain text is the expected fast path.
    }

    return trimmed;
  }

  if (content && typeof content === 'object') {
    const contentRecord = content as Record<string, unknown>;
    if ('content' in contentRecord) {
      return extractToolText(contentRecord.content);
    }
  }

  return '';
}

function toVisibleReply(rawText: string): string | null {
  const parsed = parseThinkingAnswer(rawText, false);
  if (!parsed) {
    return rawText.trim() || null;
  }

  const visible = combineContent({
    ...parsed,
    thinking: [],
  }, false).trim();

  return visible || null;
}

export function normalizeSlackPrompt(text: string, botUserId?: string): string {
  let normalized = text.trim();
  if (botUserId) {
    normalized = normalized.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim();
  }
  return normalized.replace(/\s+/g, ' ');
}

export function extractSlackReplyFromLog(log: ConversationLogEntry[]): string | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry._type !== 'task_result') {
      continue;
    }

    const completedToolCalls = entry.result?.completed_tool_calls;
    if (Array.isArray(completedToolCalls)) {
      for (let j = completedToolCalls.length - 1; j >= 0; j--) {
        const toolCall = completedToolCalls[j];
        const functionName = toolCall?.function?.name;
        if (!['TalkToUser', 'AnalystAgent', 'AtlasAnalystAgent', 'SlackAgent'].includes(functionName)) {
          continue;
        }

        const rawText = extractToolText(toolCall.content);
        if (!rawText) {
          continue;
        }

        const visible = toVisibleReply(rawText);
        if (visible) {
          return visible;
        }
      }
    }

    const rootResultText = extractToolText(entry.result);
    if (rootResultText) {
      const visible = toVisibleReply(rootResultText);
      if (visible) {
        return visible;
      }
    }
  }

  console.warn(
    '[Slack] extractSlackReplyFromLog: could not find reply. Last entries:',
    log.slice(-3).map((e) => ({ type: e._type, hasResult: !!((e as unknown) as Record<string, unknown>).result })),
  );
  return null;
}
