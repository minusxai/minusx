import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { resolvePath, resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { slugify, truncateMessageForName } from '@/lib/conversations';
import { isAdmin } from '@/lib/auth/role-helpers';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationLog, ConversationLogEntry } from '@/orchestrator/types';

/**
 * `chat` file content — minimal: just the conversation log.
 *
 * Per-chat metadata (counts, fork pointers) lives on `files.meta` (the
 * existing JSONB column on the files table, OUTSIDE `content`). That column
 * is returned by `DocumentDB.listAll(includeContent: false)`, so the sidebar
 * can render per-row info without ever loading `content`.
 */
export interface ChatContent {
  log: ConversationLog;
}

export interface ChatMeta {
  /** Cached counter, updated atomically with each `appendChatLog`. */
  logLength: number;
  /** When set, this chat was created by forking from `forkedFrom`. */
  forkedFrom?: number;
  /** ISO timestamp of the fork. */
  forkedAt?: string;
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
 * Create a new draft chat file. Chat starts in draft state with empty log
 * and `meta.logLength: 0`. The first `appendChatLog` call publishes it
 * (draft → live) and updates the file name + path to reflect the first
 * user message.
 */
export async function createDraftChat(
  user: EffectiveUser,
): Promise<{ chatId: number }> {
  const initial: ChatContent = { log: [] };
  const initialMeta: ChatMeta = { logLength: 0 };
  const result = await FilesAPI.createFile(
    {
      name: DEFAULT_CHAT_NAME,
      path: buildDraftChatPath(user),
      type: 'chat',
      content: initial as unknown as Record<string, unknown>,
      meta: initialMeta as unknown as Record<string, unknown>,
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
 * Optimistic-or-fork:
 *   1. Single-statement UPDATE: append + bump `meta.logLength`, conditional
 *      on `meta.logLength = expectedLogIndex`. Returns true on success.
 *   2. Otherwise — read source content, build `forkedLog = source.slice(0,
 *      expectedLogIndex) ++ logDiff`, INSERT a fresh chat with
 *      `meta = { logLength, forkedFrom, forkedAt }`. Publish.
 *
 * On the first successful append (`expectedLogIndex === 0`), the chat is
 * renamed + repathed to reflect the first user message.
 */
export async function appendChatLog(
  chatId: number,
  logDiff: ConversationLogEntry[],
  expectedLogIndex: number,
  user: EffectiveUser,
): Promise<AppendChatLogResult> {
  const updated = await FilesAPI.appendChatLog(chatId, logDiff, expectedLogIndex, user);

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
  const sourceLog = (existing.data.content as unknown as ChatContent).log;

  const forkedLog: ConversationLog = [
    ...sourceLog.slice(0, expectedLogIndex),
    ...logDiff,
  ];

  const baseName = existing.data.name || DEFAULT_CHAT_NAME;
  const forkedName = `${baseName} (forked)`;
  const forkedSlug = slugify(forkedName);
  const forkedContent: ChatContent = { log: forkedLog };
  const forkedMeta: ChatMeta = {
    logLength: forkedLog.length,
    forkedFrom: chatId,
    forkedAt: new Date().toISOString(),
  };

  const created = await FilesAPI.createFile(
    {
      name: forkedName,
      path: buildChatPath(user, forkedSlug),
      type: 'chat',
      content: forkedContent as unknown as Record<string, unknown>,
      meta: forkedMeta as unknown as Record<string, unknown>,
      options: { createPath: true, returnExisting: false },
    },
    user,
  );

  // Fork is no longer a draft. Publish.
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
