import { Conversation, UserMessage, CompletedToolCall, DebugMessage } from '@/store/chatSlice';

// Extended types for messages with additional state flags
export type MessageWithFlags = (UserMessage | CompletedToolCall | DebugMessage) & {
  isStreaming?: boolean;
  isPending?: boolean;
};


export const deduplicateMessages = (conversation: Conversation) => {
    // Collect all messages from different sources with state flags
    const messages: MessageWithFlags[] = [];

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
        .filter(msg => !completedToolIds.has(msg.tool_call_id))
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