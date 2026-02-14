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
}

export type UserMessage = {
  role: 'user';
  content: string;
  created_at: string;
};

export type CompletedToolCall = {
  role: 'tool';
  tool_call_id: string;
  content: string | { content?: string; [key: string]: any };
  run_id: string;
  function: { name: string; arguments: string };
  created_at: string;
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
type StreamingEvent =
  | {
      conversationID: number;
      type: 'StreamedContent' | 'ToolCreated' | 'ToolCompleted';
      payload: { chunk: string } | ToolCall | CompletedToolCall;
    }
  | {
      conversationID: number;
      type: 'NewConversation';
      payload: { name: string };
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
    }>) {
      const { conversationID, agent, agent_args, message } = action.payload;

      // Deactivate all existing conversations
      Object.values(state.conversations).forEach(c => {
        c.active = false;
      });

      const messages: any[] = [];
      if (message) {
        messages.push({
          role: 'user',
          content: message,
          created_at: new Date().toISOString()
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
    }>) {
      const { conversationID, message } = action.payload;
      const conv = state.conversations[conversationID];
      if (!conv) return;

      // Add user message with timestamp
      conv.messages.push({
        role: 'user',
        content: message,
        created_at: new Date().toISOString()
      });
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
    }>) {
      const { conversationID, newConversationID, log_index, completed_tool_calls, pending_tool_calls } = action.payload;

      let conv = state.conversations[conversationID];
      if (!conv) return;

      // If forked, create new conversation (keep old one)
      if (newConversationID && newConversationID !== conversationID) {
        // Create new conversation at new ID (preserve _id for stable tracking)
        state.conversations[newConversationID] = {
          ...conv,
          _id: conv._id,  // IMPORTANT: Preserve stable _id across fork
          conversationID: newConversationID,
          // streamedCompletedToolCalls: conv.streamedCompletedToolCalls || [],
          streamedCompletedToolCalls: [],
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

      // Handle NewConversation event (create real conversation, link from temp)
      if (type === 'NewConversation') {
        // Find latest temp conversation (most negative ID = most recent)
        // Since we use -Date.now(), newer temps have smaller values (more negative)
        const tempIDs = Object.keys(state.conversations)
          .map(Number)
          .filter(id => id < 0);

        if (tempIDs.length === 0) {
          console.warn('[NewConversation] No temp conversation found');
          return;
        }

        const tempID = Math.min(...tempIDs);  // Most negative = most recent

        const tempConv = state.conversations[tempID];

        // Create real conversation (copy from temp, preserve _id)
        state.conversations[conversationID] = {
          ...tempConv,
          _id: tempConv._id,  // IMPORTANT: Preserve stable _id across fork
          conversationID,
          forkedConversationID: undefined, // Real conversations don't have this
          streamedCompletedToolCalls: [] // Explicitly initialize for new conversation
        };

        // Mark temp conversation as forked to real one
        tempConv.forkedConversationID = conversationID;

        console.log(`[NewConversation] Created real conversation ${conversationID}, linked from temp ${tempID}`);
        return;
      }

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

      if (type === 'StreamedContent') {
        const { chunk } = payload as { chunk: string };
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

export default chatSlice.reducer;
