import { Conversation, UserMessage, CompletedToolCall, DebugMessage } from '@/store/chatSlice';

// Extended types for messages with additional state flags
export type MessageWithFlags = (UserMessage | CompletedToolCall | DebugMessage) & {
  isStreaming?: boolean;
  isPending?: boolean;
};

const CONTENT_DISPLAY_TOOL_NAMES = new Set([
    'TalkToUser',
    'AnalystAgent',
    'AtlasAnalystAgent',
    'TestAgent',
    'OnboardingContextAgent',
    'OnboardingDashboardAgent',
    'SlackAgent',
]);

function normalizeAssistantContent(content: CompletedToolCall['content']): string | null {
    const normalize = (value: string | null | undefined): string | null => {
        if (!value) return null;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    };

    const parsedContent = typeof content === 'string' ? (() => {
        try {
            return JSON.parse(content);
        } catch {
            return null;
        }
    })() : content;

    if (parsedContent && typeof parsedContent === 'object') {
        if (Array.isArray((parsedContent as any).content_blocks)) {
            const textBlocks = (parsedContent as any).content_blocks
                .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
                .map((block: any) => block.text.trim())
                .filter(Boolean);

            if (textBlocks.length > 0) {
                return normalize(textBlocks.join('\n\n'));
            }
        }

        if (typeof (parsedContent as any).content === 'string') {
            return normalize((parsedContent as any).content);
        }

        if (typeof (parsedContent as any).answer === 'string') {
            return normalize((parsedContent as any).answer);
        }
    }

    if (typeof content === 'string') {
        return normalize(content);
    }

    return normalize(JSON.stringify(content));
}

function getAssistantDedupKey(message: CompletedToolCall): string | null {
    const toolName = message.function?.name;
    if (!toolName || !CONTENT_DISPLAY_TOOL_NAMES.has(toolName)) {
        return null;
    }

    const normalizedContent = normalizeAssistantContent(message.content);
    if (!normalizedContent) {
        return null;
    }

    return `${toolName}:${normalizedContent}`;
}

export const deduplicateMessages = (conversation: Conversation) => {
    // Collect all messages from different sources with state flags
    const messages: MessageWithFlags[] = [];

    const lastUserMessageIndex = conversation.messages
        ? conversation.messages.map(message => message.role).lastIndexOf('user')
        : -1;
    const lastUserMessage = lastUserMessageIndex >= 0
        ? conversation.messages[lastUserMessageIndex] as UserMessage
        : null;
    const lastUserCreatedAt = lastUserMessage?.created_at
        ? Date.parse(lastUserMessage.created_at)
        : Number.NaN;

    const completedAssistantKeysInCurrentTurn = lastUserMessageIndex >= 0
        ? new Set(
            conversation.messages
                .slice(lastUserMessageIndex + 1)
                .filter((message): message is CompletedToolCall => message.role === 'tool')
                .map(getAssistantDedupKey)
                .filter((key): key is string => !!key)
        )
        : new Set<string>();

    const completedAssistantKeysBeforeCurrentTurn = lastUserMessageIndex > 0
        ? new Set(
            conversation.messages
                .slice(0, lastUserMessageIndex)
                .filter((message): message is CompletedToolCall => message.role === 'tool')
                .map(getAssistantDedupKey)
                .filter((key): key is string => !!key)
        )
        : new Set<string>();

    // 1. Add completed messages (persistent, from conversation log)
    if (conversation.messages) {
        messages.push(...conversation.messages);
    }

    // 2. Add streaming messages (ephemeral, currently being streamed)
    // Deduplicate: only add streaming messages that aren't already in completed messages
    if (conversation.streamedCompletedToolCalls?.length > 0) {
        const completedToolIds = new Set(
        conversation.messages
            .filter((m): m is CompletedToolCall => m.role === 'tool')
            .map(m => m.tool_call_id)
        );

        const uniqueStreamingMessages = conversation.streamedCompletedToolCalls
        .filter(msg => {
            if (completedToolIds.has(msg.tool_call_id)) {
                return false;
            }

            const assistantDedupKey = getAssistantDedupKey(msg);
            if (assistantDedupKey && completedAssistantKeysInCurrentTurn.has(assistantDedupKey)) {
                return false;
            }

            if (assistantDedupKey && completedAssistantKeysBeforeCurrentTurn.has(assistantDedupKey) && !Number.isNaN(lastUserCreatedAt)) {
                const streamedCreatedAt = Date.parse(msg.created_at);
                if (!Number.isNaN(streamedCreatedAt) && streamedCreatedAt <= lastUserCreatedAt) {
                    return false;
                }
            }

            return true;
        })
        .map(msg => ({
            ...msg,
            isStreaming: true
        }));

        messages.push(...uniqueStreamingMessages);
    }

    // 3. Add pending tools (executing, not yet completed)
    if (conversation.pending_tool_calls) {
        // Check against original completed messages only
        const completedToolIds = new Set(
        conversation.messages
            .filter((m): m is CompletedToolCall => m.role === 'tool')
            .map(m => m.tool_call_id)
        );

        const pendingTools = conversation.pending_tool_calls
        .filter(p => !p.result && !completedToolIds.has(p.toolCall.id))
        .map(pendingTool => ({
            role: 'tool' as const,
            tool_call_id: pendingTool.toolCall.id,
            content: '(executing...)',
            run_id: (pendingTool.toolCall as any)._run_id || 'pending',
            function: {
            name: (pendingTool.toolCall as any).agent || pendingTool.toolCall.function.name,
            arguments: JSON.stringify((pendingTool.toolCall as any).args || pendingTool.toolCall.function.arguments)
            },
            created_at: new Date().toISOString(),
            isPending: true
        }));

        messages.push(...pendingTools);
    }

    // Final deduplication: remove duplicate tool calls by tool_call_id
    // Keep the first occurrence (completed messages take precedence over streaming/pending)
    const seenToolIds = new Set<string>();
    return messages.filter(msg => {
        if (msg.role === 'tool') {
        if (seenToolIds.has(msg.tool_call_id)) {
            return false; // Skip duplicate
        }
        seenToolIds.add(msg.tool_call_id);
        }
        return true; // Keep user and debug messages, and first occurrence of each tool
    });
}
