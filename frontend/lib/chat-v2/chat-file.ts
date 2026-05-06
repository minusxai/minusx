import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { resolvePath, resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { slugify, truncateMessageForName } from '@/lib/conversations';
import { isAdmin } from '@/lib/auth/role-helpers';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationLog, ConversationLogEntry } from '@/orchestrator/types';

/**
 * `chat` file content shape — cleaner than the legacy `conversation` format.
 *
 *   - `log` is the TS-orchestrator's ConversationLog (AgentInvocation /
 *     AssistantMessage / ToolResultMessage entries).
 *   - `agent` and `agent_args` are pinned at chat-creation time so subsequent
 *     turns can reconstruct the orchestrator with the same root agent.
 *   - `forkedFrom`, when set, is the chat ID we forked from.
 *
 * Notably absent: any `metadata.name`. The display name lives only on the
 * `files.name` column so sidebar list queries don't need to read content.
 */
export interface ChatContent {
  log: ConversationLog;
  agent: string;
  agent_args: Record<string, unknown>;
  forkedFrom?: number;
  // Auto-bumped on every appendChatLog. Lives here (not just on the file row)
  // because `appendJsonArray` requires a JSONB metadata path to update in the
  // same atomic statement. NOT a display name — the user-facing name lives
  // on the `files.name` column.
  metadata: { updatedAt: string };
}

const DEFAULT_CHAT_NAME = 'New Chat';

function getHomeFolder(user: EffectiveUser): string {
  if (isAdmin(user.role) || !user.home_folder) {
    return resolvePath(user.mode, '');
  }
  return resolveHomeFolderSync(user.mode, user.home_folder);
}

function buildChatPath(user: EffectiveUser, slug: string): string {
  return `${getHomeFolder(user)}/chats/${Date.now()}-${slug}.chat.json`;
}

function buildDraftChatPath(user: EffectiveUser): string {
  // Draft chats use a uuid-ish suffix so concurrent drafts don't collide.
  const rand = Math.random().toString(36).slice(2, 10);
  return `${getHomeFolder(user)}/chats/draft-${Date.now()}-${rand}.chat.json`;
}

/**
 * Create a new draft chat file. Chat starts in draft state with empty log;
 * the first appendChatLog call publishes it (draft → live) and updates the
 * file name + path to reflect the first user message.
 */
export async function createDraftChat(
  user: EffectiveUser,
  agent: string,
  agentArgs: Record<string, unknown>,
): Promise<{ chatId: number }> {
  const initial: ChatContent = {
    log: [],
    agent,
    agent_args: agentArgs,
    metadata: { updatedAt: new Date().toISOString() },
  };
  const result = await FilesAPI.createFile(
    {
      name: DEFAULT_CHAT_NAME,
      path: buildDraftChatPath(user),
      type: 'chat',
      content: initial as unknown as Record<string, unknown>,
      options: { createPath: true, returnExisting: false },
    },
    user,
  );
  return { chatId: result.data.id };
}

interface AppendChatLogResult {
  chatId: number;
  forked: boolean;
}

/**
 * Append `logDiff` entries to a chat's log atomically.
 *
 * Optimistic-or-fork semantics:
 *   1. If the chat's stored log length === `expectedLogIndex`, append in place
 *      (single-statement JSONB array concat). Sets `draft = false` in the same
 *      operation. Returns `{ chatId, forked: false }`.
 *   2. Otherwise (length mismatch) — read full content, fork to a new chat
 *      file with the prefix + diff, return `{ chatId: <newId>, forked: true }`.
 *
 * On a successful first append (expectedLogIndex === 0), the chat name and
 * path are updated to reflect the first user message — name lives on the
 * file row only, never in content.
 */
export async function appendChatLog(
  chatId: number,
  logDiff: ConversationLogEntry[],
  expectedLogIndex: number,
  user: EffectiveUser,
): Promise<AppendChatLogResult> {
  // Atomic append + bump metadata.updatedAt in the same statement.
  const updated = await FilesAPI.appendJsonArray(
    chatId,
    logDiff,
    expectedLogIndex,
    user,
    'log',
    'metadata.updatedAt',
  );

  if (updated) {
    if (expectedLogIndex === 0) {
      const firstUserMessage = extractFirstUserMessage(logDiff);
      if (firstUserMessage) {
        const displayName = truncateMessageForName(firstUserMessage);
        const newPath = buildChatPath(user, slugify(firstUserMessage));
        await FilesAPI.renameAndMove(chatId, displayName, newPath, user);
      }
    }
    return { chatId, forked: false };
  }

  // Length mismatch — fork.
  const existing = await FilesAPI.loadFile(chatId, user);
  const content = existing.data.content as unknown as ChatContent;

  const forkedLog: ConversationLog = [
    ...content.log.slice(0, expectedLogIndex),
    ...logDiff,
  ];

  const baseName = existing.data.name || DEFAULT_CHAT_NAME;
  const forkedName = `${baseName} (forked)`;
  const forkedSlug = slugify(forkedName);
  const forkedContent: ChatContent = {
    log: forkedLog,
    agent: content.agent,
    agent_args: content.agent_args,
    forkedFrom: chatId,
    metadata: { updatedAt: new Date().toISOString() },
  };

  const created = await FilesAPI.createFile(
    {
      name: forkedName,
      path: buildChatPath(user, forkedSlug),
      type: 'chat',
      content: forkedContent as unknown as Record<string, unknown>,
      options: { createPath: true, returnExisting: false },
    },
    user,
  );

  // The fork is no longer a draft — it has real log content. Publish.
  // (createFile creates a draft by default; appendJsonArray with empty diff
  // is a no-op, so we use a single saveFile to publish.)
  await FilesAPI.saveFile(
    created.data.id,
    forkedName,
    created.data.path,
    forkedContent as unknown as Record<string, unknown>,
    [],
    user,
  );

  return { chatId: created.data.id, forked: true };
}

/**
 * Load a chat file's content by ID. Throws on ACL failure.
 */
export async function loadChatLog(chatId: number, user: EffectiveUser): Promise<ChatContent> {
  const file = await FilesAPI.loadFile(chatId, user);
  return file.data.content as unknown as ChatContent;
}

function extractFirstUserMessage(logDiff: ConversationLogEntry[]): string | null {
  // The root agent invocation entry is `{ type: 'toolCall', arguments: { userMessage }, parent_id: null, ... }`.
  for (const entry of logDiff) {
    const e = entry as { type?: string; parent_id?: string | null; arguments?: { userMessage?: unknown } };
    if (e.type === 'toolCall' && e.parent_id === null && typeof e.arguments?.userMessage === 'string') {
      return e.arguments.userMessage;
    }
  }
  return null;
}
