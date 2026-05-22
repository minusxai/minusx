/**
 * Headless v=2 eval execution.
 *
 * Runs the in-process `EvalAnalystAgent` (no Python backend) and returns the
 * agent's submitted answer. Used by the eval harness (`lib/tests/server.ts`).
 */
import 'server-only';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { ToolResultMessage } from '@/orchestrator/llm';
import type { RegistrableClass } from '@/orchestrator/types';
import {
  EvalAnalystAgent,
  type EvalAnalystContext,
  type EvalAssertionType,
} from '@/agents/eval/eval-agent';
import { SubmitBinary, SubmitNumber, SubmitString, CannotAnswer, SUBMIT_TOOL_NAMES } from '@/agents/eval/submit-tools';
import {
  ListDBConnections,
  SearchDBSchema,
  ExecuteQuery,
  ReadFiles,
  SearchFiles,
} from '@/agents/analyst/analyst-agent';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { getPageType } from '@/agents/analyst/skills';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const EVAL_REGISTRABLES: RegistrableClass[] = [
  EvalAnalystAgent,
  ListDBConnections,
  SearchDBSchema,
  ExecuteQuery,
  ReadFiles,
  SearchFiles,
  SubmitBinary,
  SubmitNumber,
  SubmitString,
  CannotAnswer,
];

export type SubmitToolName = 'SubmitBinary' | 'SubmitNumber' | 'SubmitString' | 'CannotAnswer';

export interface EvalSubmission {
  toolName: SubmitToolName;
  /** Parsed submit payload: `{ submitted, answer }` or `{ submitted, cannot_answer, reason }`. */
  content: Record<string, unknown>;
}

export interface RunEvalV2Params {
  goal: string;
  assertionType: EvalAssertionType;
  schema?: { schema: string; tables: string[] }[];
  contextDocs?: string;
  connectionId?: string;
  appState?: unknown;
  user: EffectiveUser;
}

/** Run an eval and return the agent's submission, or null if it never submitted. */
export async function runEvalV2(params: RunEvalV2Params): Promise<EvalSubmission | null> {
  const whitelistedTables: string[] = [];
  for (const s of params.schema ?? []) {
    for (const t of s.tables) {
      whitelistedTables.push(t);
      whitelistedTables.push(`${s.schema}.${t}`);
    }
  }

  const ctx: EvalAnalystContext = {
    userId: String(params.user.userId ?? params.user.email),
    mode: params.user.mode === 'tutorial' ? 'tutorial' : 'org',
    effectiveUser: params.user,
    connectionId: params.connectionId,
    whitelistedTables: whitelistedTables.length > 0 ? whitelistedTables : undefined,
    contextDocs: params.contextDocs || undefined,
    schema: params.schema,
    homeFolder: resolveHomeFolderSync(params.user.mode, params.user.home_folder || ''),
    role: params.user.role,
    appState: params.appState,
    pageType: getPageType(params.appState),
    assertionType: params.assertionType,
  };

  const orch = new Orchestrator(EVAL_REGISTRABLES);
  const agent = new EvalAnalystAgent(orch, { userMessage: params.goal }, ctx);

  const stream = orch.run(agent);
  for await (const ev of stream) {
    if ((ev as { type?: string }).type === 'error') {
      console.error('[v2/eval] orchestrator error event:', (ev as { error?: { errorMessage?: string } }).error?.errorMessage);
    }
  }
  await stream.result();

  // Find the last Submit tool result in the log.
  for (let i = orch.log.length - 1; i >= 0; i--) {
    const e = orch.log[i];
    if (!('role' in e) || e.role !== 'toolResult') continue;
    const trm = e as ToolResultMessage;
    if (!SUBMIT_TOOL_NAMES.has(trm.toolName)) continue;
    const content = (trm.details as Record<string, unknown>) ?? parseTextContent(trm);
    return { toolName: trm.toolName as SubmitToolName, content };
  }
  return null;
}

function parseTextContent(trm: ToolResultMessage): Record<string, unknown> {
  const text = trm.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
