/**
 * Headless chat orchestration loop.
 *
 * Clientless callers (e.g. Slack) drive a full agent execution in-process via
 * the TypeScript orchestrator (no HTTP hop, no browser).
 *
 * Unlike the browser chat path, the agents used here (RemoteAnalystAgent
 * family, e.g. SlackAgent) advertise only server-side tools (DB + file tools),
 * so `orchestrator.run()` executes the whole loop to completion — there are no
 * frontend-only tools to bridge back to a browser.
 *
 * Returns the conversation log translated to the *legacy* log shape so existing
 * consumers (e.g. `extractSlackReply`, `extractQueryCharts`) work unchanged.
 */
import 'server-only';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { ConversationLog, RegistrableClass } from '@/orchestrator/types';
import { V2_HEADLESS_REGISTRABLES, recordLlmCalls } from '@/lib/chat-orchestration-v2.server';
import { piLogToLegacy } from '@/lib/chat-translator';
import { loadLog, appendMessages } from '@/lib/data/conversations.server';
import { getPageType } from '@/agents/analyst/skills';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import type { ConnectionInfo } from '@/agents/benchmark-analyst/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationLogEntry as LegacyLogEntry } from '@/lib/types';

/**
 * Constructor shape for a RemoteAnalystAgent-family agent (SlackAgent, …).
 * The runner instantiates it with the orchestrator, `{ userMessage }`, and a
 * `RemoteAnalystContext`.
 */
type AnalystAgentClass = new (
  orch: Orchestrator,
  params: { userMessage: string },
  context: RemoteAnalystContext,
) => object;

export interface RunOrchestrationV2Params {
  /** Agent class to run (e.g. SlackAgent). Must extend RemoteAnalystAgent. */
  agentClass: AnalystAgentClass;
  /** Agent args (connection_id, schema, context, app_state, …) — e.g. from buildSlackAgentArgs. */
  agent_args: Record<string, unknown>;
  user: EffectiveUser;
  userMessage: string;
  /** Existing v=2 conversation file to append to (callers pre-create it). */
  conversationId: number;
}

export interface RunOrchestrationV2Result {
  conversationId: number;
  /** Full conversation log, translated to the legacy log shape. */
  log: LegacyLogEntry[];
  /** Entries added by this run only, translated to the legacy log shape. */
  logDiff: LegacyLogEntry[];
}

/** Build a RemoteAnalystContext from agent_args (mirrors the chat path's v=2 setup). */
async function buildAnalystContext(
  agent_args: Record<string, unknown>,
  user: EffectiveUser,
): Promise<RemoteAnalystContext> {
  const narrowedMode: 'org' | 'tutorial' = user.mode === 'tutorial' ? 'tutorial' : 'org';

  // Load the workspace's connections so the headless agent's ListDBConnections
  // tool can discover them. Unlike the browser chat (WebAnalystAgent, which has
  // no ListDBConnections and is handed a pre-selected connection_id from Redux),
  // clientless agents (SlackAgent, …) must discover connections themselves — so
  // without this they'd see an empty list and give up. SearchDBSchema/ExecuteQuery
  // still resolve by name server-side via ConnectionsAPI, but the LLM needs the
  // names from here first.
  const { connections: rawConnections } = await ConnectionsAPI.listAll(user);
  const connections: ConnectionInfo[] = rawConnections.map((c) => ({
    name: c.name,
    dialect: c.type,
    config: c.config,
  }));

  const schema = Array.isArray(agent_args.schema)
    ? (agent_args.schema as { schema: string; tables: string[] }[])
    : undefined;
  const whitelistedTables: string[] = [];
  for (const s of schema ?? []) {
    for (const t of s.tables) {
      whitelistedTables.push(t);
      whitelistedTables.push(`${s.schema}.${t}`);
    }
  }

  const appState = agent_args.app_state;
  const connectionId =
    typeof agent_args.connection_id === 'string' ? agent_args.connection_id : undefined;
  const resolvedContextDocs =
    agent_args.context_docs && typeof agent_args.context_docs === 'object'
      ? (agent_args.context_docs as RemoteAnalystContext['resolvedContextDocs'])
      : undefined;
  const annotations = Array.isArray(agent_args.annotations)
    ? (agent_args.annotations as RemoteAnalystContext['annotations'])
    : undefined;

  return {
    userId: String(user.userId ?? user.email),
    mode: narrowedMode,
    effectiveUser: user,
    connections,
    connectionId,
    whitelistedTables: whitelistedTables.length > 0 ? whitelistedTables : undefined,
    resolvedContextDocs,
    annotations,
    schema,
    homeFolder: resolveHomeFolderSync(user.mode, user.home_folder || ''),
    role: user.role,
    appState,
    pageType: getPageType(appState),
    selectedSkills: [],
    userSkillCatalog: [],
    unrestrictedMode: false,
  };
}

/**
 * Run a full agent orchestration loop in-process (v=2 / TypeScript orchestrator).
 *
 * Appends the new orchestrator-shape entries to the conversation file and
 * returns the legacy-translated log + diff.
 */
export async function runChatOrchestrationV2({
  agentClass,
  agent_args,
  user,
  userMessage,
  conversationId,
}: RunOrchestrationV2Params): Promise<RunOrchestrationV2Result> {
  // v3: the conversation log lives in the `messages` table (the caller pre-creates the conversation).
  const savedLog: ConversationLog = await loadLog(conversationId);
  const expectedLogIndex = savedLog.length;

  const ctx = await buildAnalystContext(agent_args, user);
  const registrables: RegistrableClass[] = [...V2_HEADLESS_REGISTRABLES];
  const orch = new Orchestrator(registrables, [...savedLog]);

  const agent = new agentClass(orch, { userMessage }, ctx);
  const stream = orch.run(agent as never);
  for await (const ev of stream) {
    // EventStream.result() never throws — errors surface only as stream events,
    // so capture/log them here. A run with no visible reply degrades to the
    // caller's fallback (e.g. Slack posts "I don't have a text reply").
    if ((ev as { type?: string }).type === 'error') {
      const errMsg = (ev as { error?: { errorMessage?: string } }).error?.errorMessage;
      console.error('[v2/headless] orchestrator error event:', errMsg);
    }
  }
  await stream.result();

  const fullPiLog = orch.log;
  const piDiff = fullPiLog.slice(expectedLogIndex) as ConversationLog;

  if (piDiff.length > 0) {
    await appendMessages(conversationId, piDiff, expectedLogIndex);
  }

  // Record this turn's LLM usage (Slack and other clientless callers). Conversation-bound
  // like the browser chat path — without this, Slack usage never reaches llm_call_events.
  // The surface (e.g. 'slack') is recorded as the LLM-call `trigger`.
  await recordLlmCalls(piDiff, conversationId, user, getPageType(agent_args.app_state));

  return {
    conversationId,
    log: piLogToLegacy(fullPiLog),
    logDiff: piLogToLegacy(piDiff),
  };
}
