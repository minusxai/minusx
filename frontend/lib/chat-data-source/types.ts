// Data source abstraction for ChatInterface.
//
// ChatInterface is the chat surface — same component for legacy chat and v=2.
// The only thing that varies is WHERE the conversation data lives and which
// actions fire on send / queue / interrupt / etc. This file defines the
// contract; concrete adapters are in `legacy.ts` and `v2.ts`.
//
// Design notes:
//   - The adapter returns a `chatSlice.Conversation`-shaped object so the
//     existing render path (and existing leaves like SimpleChatMessage,
//     AgentTurnContainer, ToolCallDisplay) keep working unchanged.
//   - Actions that v=2 doesn't support yet (queue, interrupt, editAndFork)
//     are optional. ChatInterface gates the UI affordances on their presence.
//   - The legacy adapter is a thin wrapper around the existing chatSlice
//     selectors + dispatch — no behavior change for the legacy code path.

import type { Conversation } from '@/store/chatSlice';
import type { Attachment } from '@/lib/types';
import type { LoadError } from '@/lib/types/errors';

export interface ChatDataSource {
  // ─── State ────────────────────────────────────────────────────────
  /** The current conversation, or undefined if not yet loaded / created. */
  conversation: Conversation | undefined;
  /** True while the conversation is being fetched from the database. */
  isLoading: boolean;
  /** Non-null when the conversation file failed to load (e.g. not found). */
  loadError: LoadError | null | undefined;
  /** Stable conversation id (file id) for the active surface. May differ
   *  from the originally-requested id if the conversation was forked or if
   *  the surface bootstrapped a brand-new conversation on first send. */
  conversationID: number | undefined;
  /** True when the surface was opened without a specific id — i.e. starting
   *  a new chat from `/explore` rather than continuing an existing one. The
   *  navigation effect in ChatInterface uses this to decide whether to push
   *  the new id into the URL after first send. */
  isNewConversation: boolean;

  // ─── Capabilities ─────────────────────────────────────────────────
  /** Drives which UI affordances render. v=2 starts with most of these false. */
  capabilities: {
    queueMessages: boolean;
    interrupt: boolean;
    editAndFork: boolean;
    setActive: boolean;
    contextSelector: boolean;
    databaseSelector: boolean;
    slashCommands: boolean;
    skillMentions: boolean;
    /** Whether the surface should fork on conflict (legacy only). */
    fork: boolean;
    /** Whether `agent_args` is meaningful — legacy carries app_state etc. via agent_args; v=2 carries it inside the AgentInvocation. */
    agentArgs: boolean;
  };

  // ─── Actions ──────────────────────────────────────────────────────
  /** Send a user message. Required. The adapter handles bootstrap (legacy:
   * /api/chat/init pre-create; v=2: /api/chat/v2/new) and dispatches the
   * appropriate listener-driven action. `agentArgs` is legacy-only — the
   * adapter ignores it when `capabilities.agentArgs === false`. */
  send(args: {
    message: string;
    attachments?: Attachment[];
    agentArgs?: Record<string, unknown>;
  }): Promise<void>;
  /** Stop the current turn. v=2 may no-op until interrupt is wired. */
  stop?(): void;
  /** Start a new chat. Both surfaces support this. */
  newChat(): void;
  /** Queue a message to be sent after the current turn finishes (legacy). */
  queue?(args: { message: string; attachments?: Attachment[] }): void;
  /** Clear queued messages (legacy). */
  clearQueue?(): void;
  /** Edit and fork from a user message at logIndex (legacy). */
  editAndFork?(args: { logIndex: number; message: string }): void;
  /** Make this conversation the active one (legacy side-chat). */
  setActive?(): void;
  /** Update agent_args before sending (legacy — carries app_state etc.). */
  updateAgentArgs?(agent_args: Record<string, unknown>): void;
  /** Bootstrap a new conversation entry (legacy). */
  createConversation?(args: { agent: string; agent_args?: Record<string, unknown> }): void;
}
