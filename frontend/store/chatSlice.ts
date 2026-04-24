import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from './store';
import type { UserInput } from '@/lib/api/user-input-exception';
import type { MessageDebugInfo } from '@/lib/types';

// Types
interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, any>;  // Always an object - HTTP response handles JSON serialization
  };
}

interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
  created_at: string;
  details?: Record<string, any>;
}

export type UserMessage = {
  role: 'user';
  content: string;
  created_at: string;
  attachments?: import('@/lib/types').Attachment[];
  logIndex?: number;  // Index of this task entry in the conversation log — used to fork from this point
};

export type CompletedToolCall = {
  role: 'tool';
  tool_call_id: string;
  content: string | { content?: string; [key: string]: any };
  run_id: string;
  function: { name: string; arguments: string };
  created_at: string;
  details?: Record<string, any>;
};

export type DebugMessage = MessageDebugInfo & {
  role: 'debug';
};

interface PendingToolCall {
  toolCall: ToolCall;
  result?: ToolMessage;
  userInputs?: UserInput[];      // User input requests for this tool
}

// Streaming event types matching backend
type StreamingEvent = {
  conversationID: number;
  type: 'StreamedContent' | 'StreamedThinking' | 'ToolCreated' | 'ToolCompleted';
  payload: { chunk: string } | ToolCall | CompletedToolCall;
};

export interface Conversation {
  _id: string;             // Stable internal ID (never changes, used for AbortController tracking)
  conversationID: number;  // File ID (changed from string)
  log_index: number;
  executionState: 'WAITING' | 'STREAMING' | 'EXECUTING' | 'FINISHED';
  messages: Array<UserMessage | CompletedToolCall | DebugMessage>;
  pending_tool_calls: PendingToolCall[];
  agent: string;
  agent_args: any;
  error?: string;

  // Streaming state (ephemeral) - built from streaming events
  streamedCompletedToolCalls: CompletedToolCall[];
  streamedThinking: string; // Native thinking accumulated during streaming

  // Queued messages — sent when the current agent turn finishes
  queuedMessages?: Array<{ message: string; attachments?: import('@/lib/types').Attachment[] }>;

  // True when the agent was interrupted and queued messages should prefill the input
  wasInterrupted?: boolean;


  // For temp conversations (negative IDs): points to the real conversation ID created by backend
  forkedConversationID?: number;

  // Mark the active conversation (only one conversation should have this set to true)
  active?: boolean;
}

interface ChatState {
  conversations: Record<number, Conversation>;  // Changed key type
}

const initialState: ChatState = {
  conversations: {}
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    // Create new conversation (optionally with initial message)
    createConversation(state, action: PayloadAction<{
      conversationID: number;
      agent: string;
      agent_args?: any;
      message?: string;  // Optional initial user message
      attachments?: import('@/lib/types').Attachment[];
    }>) {
      const { conversationID, agent, agent_args, message, attachments } = action.payload;

      // Deactivate all existing conversations
      Object.values(state.conversations).forEach(c => {
        c.active = false;
      });

      const messages: any[] = [];
      if (message) {
        messages.push({
          role: 'user',
          content: message,
          created_at: new Date().toISOString(),
          logIndex: 0,  // First message always lands at log index 0
          ...(attachments?.length ? { attachments } : {}),
        });
      }

      state.conversations[conversationID] = {
        _id: crypto.randomUUID(),  // Generate stable internal ID
        conversationID,
        log_index: 0,
        executionState: message ? 'WAITING' : 'FINISHED',  // Only wait if message provided
        messages,
        pending_tool_calls: [],
        agent,
        agent_args: agent_args || {},
        streamedCompletedToolCalls: [],
        streamedThinking: '',
        queuedMessages: [],
        active: true  // Mark new conversation as active
      };
    },

    // Load existing conversation from database
    loadConversation(state, action: PayloadAction<{ conversation: Conversation; setAsActive?: boolean }>) {
      const { conversation: conv, setAsActive = false } = action.payload;
      // Ensure _id exists (for backwards compatibility with old conversations)
      if (!conv._id) {
        conv._id = crypto.randomUUID();
      }

      if (setAsActive) {
        // Deactivate all existing conversations
        Object.values(state.conversations).forEach(c => {
          c.active = false;
        });
        conv.active = true;
      }

      state.conversations[conv.conversationID] = conv;
    },

    // User sends message (existing conversation) → triggers listener
    sendMessage(state, action: PayloadAction<{
      conversationID: number;
      message: string;
      attachments?: import('@/lib/types').Attachment[];
    }>) {
      const { conversationID, message, attachments } = action.payload;
      const conv = state.conversations[conversationID];
      if (!conv) return;

      // Add user message with timestamp
      conv.messages.push({
        role: 'user',
        content: message,
        created_at: new Date().toISOString(),
        logIndex: conv.log_index ?? 0,
        ...(attachments?.length ? { attachments } : {}),
      });
      conv.executionState = 'WAITING';
      conv.error = undefined;
      conv.wasInterrupted = false;
    },

    // Queue a message while agent is running — will be sent when current turn finishes
    queueMessage(state, action: PayloadAction<{
      conversationID: number;
      message: string;
      attachments?: import('@/lib/types').Attachment[];
    }>) {
      const { conversationID, message, attachments } = action.payload;
      const conv = state.conversations[conversationID];
      if (!conv) return;
      if (!conv.queuedMessages) conv.queuedMessages = [];
      conv.queuedMessages.push({ message, ...(attachments?.length ? { attachments } : {}) });
    },

    // Clear queued messages (after they've been sent)
    clearQueuedMessages(state, action: PayloadAction<{ conversationID: number }>) {
      const conv = state.conversations[action.payload.conversationID];
      if (conv) conv.queuedMessages = [];
    },

    // Move queued messages into the messages array as user messages, then clear the queue
    flushQueuedMessages(state, action: PayloadAction<{ conversationID: number }>) {
      const conv = state.conversations[action.payload.conversationID];
      if (!conv || !conv.queuedMessages?.length) return;
      const combinedMessage = conv.queuedMessages.map(qm => qm.message).join('\n\n');
      const allAttachments = conv.queuedMessages.flatMap(qm => qm.attachments || []);
      conv.messages.push({
        role: 'user',
        content: combinedMessage,
        created_at: new Date().toISOString(),
        logIndex: conv.log_index ?? 0,
        ...(allAttachments.length ? { attachments: allAttachments } : {}),
      });
      conv.queuedMessages = [];
    },

    // Edit a past user message and fork the conversation from that point.
    // Truncates conv.messages to just before the edited message, adds the new
    // user message, sets log_index to the fork point, and marks WAITING.
    editAndForkMessage(state, action: PayloadAction<{
      conversationID: number;
      logIndex: number;   // The log array index to fork from (sets log_index on the conversation)
      message: string;
    }>) {
      const { conversationID, logIndex, message } = action.payload;
      const conv = state.conversations[conversationID];
      if (!conv) return;

      // Keep only messages whose logIndex < fork point (i.e., messages BEFORE the edited one)
      const kept = conv.messages.filter((m) => {
        if (m.role === 'user') {
          const ui = m as UserMessage;
          return ui.logIndex !== undefined && ui.logIndex < logIndex;
        }
        // Non-user messages: keep if they came before the first user message at logIndex.
        // Tool messages don't have logIndex — use a heuristic: keep tool messages whose
        // parent user message was before the fork. Since messages are in order, keep all
        // tool messages that precede the fork user message in the array.
        return true; // Will be filtered below with index-based pass
      });

      // Simpler: find the index of the first message with logIndex >= fork point and truncate
      let cutAt = conv.messages.length;
      for (let i = 0; i < conv.messages.length; i++) {
        const m = conv.messages[i];
        if (m.role === 'user') {
          const ui = m as UserMessage;
          if (ui.logIndex !== undefined && ui.logIndex >= logIndex) {
            cutAt = i;
            break;
          }
        }
      }

      conv.messages = conv.messages.slice(0, cutAt);
      conv.messages.push({
        role: 'user',
        content: message,
        created_at: new Date().toISOString(),
      });
      conv.log_index = logIndex;
      conv.executionState = 'WAITING';
      conv.error = undefined;
    },

    // Update agent_args (e.g., to refresh app_state before sending new message)
    updateAgentArgs(state, action: PayloadAction<{
      conversationID: number;
      agent_args: any;
    }>) {
      const { conversationID, agent_args } = action.payload;
      const conv = state.conversations[conversationID];
      if (conv) {
        conv.agent_args = agent_args;
      }
    },

    // Update conversation after API call
    updateConversation(state, action: PayloadAction<{
      conversationID: number;
      newConversationID?: number;  // If forked
      log_index: number;
      completed_tool_calls: CompletedToolCall[];
      pending_tool_calls: ToolCall[];
      debug?: DebugMessage[];  // Aggregated debug from this turn's logDiff
      request_id?: string | null;  // HTTP request ID for cross-referencing network logs
    }>) {
      const { conversationID, newConversationID, log_index, completed_tool_calls, pending_tool_calls, debug, request_id } = action.payload;

      let conv = state.conversations[conversationID];
      if (!conv) return;

      // If forked, create new conversation (keep old one)
      if (newConversationID && newConversationID !== conversationID) {
        const existingRealConversation = state.conversations[newConversationID];
        const mergedQueuedMessages = [
          ...(existingRealConversation?.queuedMessages || []),
          ...(conv.queuedMessages || []),
        ];

        // Create new conversation at new ID (preserve _id for stable tracking)
        state.conversations[newConversationID] = {
          ...conv,
          ...existingRealConversation,
          _id: existingRealConversation?._id || conv._id,  // IMPORTANT: Preserve stable _id across fork
          conversationID: newConversationID,
          // Streaming state is ephemeral. When the temp conversation resolves to the
          // real conversation on a completed turn, do not carry over any synthetic
          // streamed TalkToUser content from the real conversation shell.
          streamedCompletedToolCalls: [],
          streamedThinking: '',
          queuedMessages: mergedQueuedMessages,
          forkedConversationID: undefined // Real conversations don't have this
        };

        // Mark old (temp) conversation as forked to new one
        conv.forkedConversationID = newConversationID;

        // Continue updating the new conversation
        conv = state.conversations[newConversationID];
      }

      // Ensure streaming array exists (backwards compatibility)
      if (!conv.streamedCompletedToolCalls) conv.streamedCompletedToolCalls = [];

      // Update state
      conv.log_index = log_index;
      conv.messages.push(...completed_tool_calls);
      if (debug?.length) {
        // Attach request_id to the first debug message's extra for display in DebugInfoDisplay
        const debugWithRequestId = request_id
          ? debug.map((msg, i) =>
              i === 0 ? { ...msg, extra: { ...msg.extra, request_id } } : msg
            )
          : debug;
        conv.messages.push(...debugWithRequestId);
      }
      conv.pending_tool_calls = pending_tool_calls.map(tc => ({
        toolCall: tc,
        result: undefined
      }));

      // Set execution state
      if (pending_tool_calls.length > 0) {
        conv.executionState = 'EXECUTING';
      } else {
        conv.executionState = 'FINISHED';
      }
    },

    // Complete a tool call
    completeToolCall(state, action: PayloadAction<{
      conversationID: number;
      tool_call_id: string;
      result: ToolMessage;
    }>) {
      const { conversationID, tool_call_id, result } = action.payload;
      const conv = state.conversations[conversationID];
      if (!conv) return;

      // Find and update pending tool
      const pending = conv.pending_tool_calls.find(
        p => p.toolCall.id === tool_call_id
      );
      if (pending) {
        pending.result = result;
      }
    },

    // Set error
    setError(state, action: PayloadAction<{
      conversationID: number;
      error: string;
    }>) {
      const { conversationID, error } = action.payload;
      const conv = state.conversations[conversationID];
      if (conv) {
        conv.error = error;
        conv.executionState = 'FINISHED';
      }
    },

    // ===== Streaming Actions =====

    // Process streaming event and build streamedCompletedToolCalls
    addStreamingMessage(state, action: PayloadAction<StreamingEvent>) {
      const { conversationID, type, payload } = action.payload;

      const conv = state.conversations[conversationID];
      if (!conv) return;

      conv.executionState = 'STREAMING';

      if (type === 'ToolCreated') {
        // Ignore ToolCreated events (as per user's requirement)
        return;
      }

      if (type === 'ToolCompleted') {
        const completedToolCall = payload as CompletedToolCall;
        const toolName = completedToolCall.function?.name;

        // Skip TalkToUser and AgentResponse
        if (toolName === 'TalkToUser' || toolName === 'AgentResponse') {
          return;
        }

        // Add to streamedCompletedToolCalls
        conv.streamedCompletedToolCalls.push(completedToolCall);

        // If the latest entry before this was a TalkToUser, set run_id to match
        if (conv.streamedCompletedToolCalls.length >= 2) {
          const previousEntry = conv.streamedCompletedToolCalls[conv.streamedCompletedToolCalls.length - 2];
          if (previousEntry.function?.name === 'TalkToUser') {
            previousEntry.run_id = completedToolCall.run_id;
          }
        }
      }

      if (type === 'StreamedThinking') {
        const { chunk } = payload as { chunk: string };
        conv.streamedThinking = (conv.streamedThinking || '') + chunk;
      }

      if (type === 'StreamedContent') {
        const { chunk } = payload as { chunk: string };
        // Thinking is complete once text starts — clear it so the indicator disappears
        // and the next LLM call's thinking starts fresh (fixes accumulation across turns)
        conv.streamedThinking = '';
        const lastEntry = conv.streamedCompletedToolCalls[conv.streamedCompletedToolCalls.length - 1];

        if (!lastEntry || lastEntry.function?.name !== 'TalkToUser') {
          // Create new synthetic TalkToUser
          const syntheticTalkToUser: CompletedToolCall = {
            role: 'tool',
            tool_call_id: `synthetic-${Date.now()}-${Math.random()}`,
            content: chunk,
            run_id: `run-${Date.now()}`, // Will be updated later when we see next tool
            function: {
              name: 'TalkToUser',
              arguments: '{}'
            },
            created_at: new Date().toISOString()
          };
          conv.streamedCompletedToolCalls.push(syntheticTalkToUser);
        } else {
          // Append to existing TalkToUser
          lastEntry.content = (lastEntry.content || '') + chunk;
        }
      }
    },

    // Clear all streaming state
    clearStreamingContent(state, action: PayloadAction<{
      conversationID: number;
    }>) {
      const { conversationID } = action.payload;
      const conv = state.conversations[conversationID];
      if (conv) {
        conv.streamedCompletedToolCalls = [];
        conv.streamedThinking = '';
      }
    },

    // Interrupt message execution
    interruptChat(state, action: PayloadAction<{ conversationID: number }>) {
      const { conversationID } = action.payload;
      const conv = state.conversations[conversationID];
      if (conv) {
        // Convert pending tools to completed with <Interrupted /> result
        const interruptedTools: CompletedToolCall[] = conv.pending_tool_calls.map(p => ({
          role: 'tool',
          tool_call_id: p.toolCall.id,
          content: '<Interrupted />',
          run_id: '',
          function: {
            name: p.toolCall.function.name,
            arguments: JSON.stringify(p.toolCall.function.arguments)
          },
          created_at: new Date().toISOString()
        }));

        // Add interrupted tools to messages
        conv.messages.push(...interruptedTools);

        // Also preserve streamedCompletedToolCalls by moving them to messages
        if (conv.streamedCompletedToolCalls?.length > 0) {
          conv.messages.push(...conv.streamedCompletedToolCalls);
        }

        conv.executionState = 'FINISHED';
        conv.error = 'Interrupted by user';
        conv.pending_tool_calls = [];
        conv.streamedCompletedToolCalls = [];
        conv.wasInterrupted = true;

      }
    },


    // ===== User Input Actions =====

    // Set user input result (user provided input for a tool)
    setUserInputResult(
      state,
      action: PayloadAction<{
        conversationID: number;
        tool_call_id: string;
        userInputId: string;
        result: any;
      }>
    ) {
      const conv = state.conversations[action.payload.conversationID];
      if (!conv) return;

      const pendingTool = conv.pending_tool_calls.find(
        p => p.toolCall.id === action.payload.tool_call_id
      );
      if (!pendingTool?.userInputs) return;

      const userInput = pendingTool.userInputs.find(
        ui => ui.id === action.payload.userInputId
      );
      if (!userInput) return;

      // Set result and timestamp
      userInput.result = action.payload.result;
      userInput.providedAt = new Date().toISOString();
    },

    // Add user input request to a pending tool
    addUserInputRequest(
      state,
      action: PayloadAction<{
        conversationID: number;
        tool_call_id: string;
        userInput: UserInput;
      }>
    ) {
      const conv = state.conversations[action.payload.conversationID];
      if (!conv) return;

      const pendingTool = conv.pending_tool_calls.find(
        p => p.toolCall.id === action.payload.tool_call_id
      );
      if (!pendingTool) return;

      if (!pendingTool.userInputs) {
        pendingTool.userInputs = [];
      }

      pendingTool.userInputs.push(action.payload.userInput);
    },

    // Set conversation as active (pass null to deactivate all)
    setActiveConversation(state, action: PayloadAction<number | null>) {
      const conversationID = action.payload;

      // Deactivate all conversations
      Object.values(state.conversations).forEach(c => {
        c.active = false;
      });

      // Activate specified conversation (if not null)
      if (conversationID !== null) {
        const conv = state.conversations[conversationID];
        if (conv) {
          conv.active = true;
        }
      }
    }
  }
});

export const {
  createConversation,
  loadConversation,
  sendMessage,
  queueMessage,
  clearQueuedMessages,
  flushQueuedMessages,
  editAndForkMessage,
  updateAgentArgs,
  updateConversation,
  completeToolCall,
  setError,
  addStreamingMessage,
  clearStreamingContent,
  interruptChat,
  setUserInputResult,
  addUserInputRequest,
  setActiveConversation
} = chatSlice.actions;

// Selectors
export const selectConversation = (state: RootState, conversationID?: number) =>
  conversationID ? state.chat.conversations[conversationID] : undefined;

export const selectAllToolsCompleted = (state: RootState, conversationID: number) => {
  const conv = state.chat.conversations[conversationID];
  if (!conv) return false;
  return conv.pending_tool_calls.every(p => p.result !== undefined);
};

// Memoized selector for optional conversation (handles undefined conversationID)
export const selectOptionalConversation = createSelector(
  [
    (state: RootState) => state.chat.conversations,
    (_state: RootState, conversationID?: number) => conversationID
  ],
  (conversations, conversationID): Conversation | undefined => {
    if (!conversationID) return undefined;
    return conversations[conversationID];
  }
);

// Memoized selector to find active conversation (follows fork chain)
export const selectActiveConversation = createSelector(
  [(state: RootState) => state.chat.conversations],
  (conversations): number | undefined => {
    // Find conversation marked as active (not forked away)
    const activeConv = Object.values(conversations).find(c =>
      c.active && !c.forkedConversationID
    );

    if (!activeConv) return undefined;

    // Follow fork chain to get latest
    let id = activeConv.conversationID;
    while (conversations[id]?.forkedConversationID) {
      id = conversations[id].forkedConversationID!;
    }

    return id;
  }
);

// Per-instance selector factory — each ToolCallDisplay gets its own memoized instance
export const makeSelectConversationByToolCallId = () =>
  createSelector(
    [(state: RootState) => state.chat.conversations, (_: RootState, toolCallId: string) => toolCallId],
    (conversations, toolCallId) =>
      Object.values(conversations).find(conv =>
        conv.pending_tool_calls.some(p => p.toolCall.id === toolCallId)
      )
  );

export default chatSlice.reducer;
