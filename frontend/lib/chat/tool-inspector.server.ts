/**
 * Admin-only "Tool Inspector" backend — re-runs a real registered server
 * tool (from `REGISTRABLES`, the same registry that powers live chat) with
 * possibly-edited arguments, outside of a live agent run.
 *
 * Only leaf `MXTool`s are executable this way. Agents (`MXAgent`s, e.g.
 * `WebAnalystAgent`) are rejected — instantiating one and calling `.run()`
 * would drive its own LLM loop, which a debug inspector must never trigger.
 * Tools that require a live browser (`ClarifyFrontend`, an unresolved
 * `LoadSkill`) throw `UserInputException`; that's surfaced as "not
 * executable" rather than propagated.
 *
 * Context is intentionally minimal (`{ effectiveUser }`): every currently
 * registered leaf tool (`SearchDBSchema`, `ExecuteQuery`, `FuzzyMatch`,
 * `SearchFiles`, `LoadSkill`) only reads `context.effectiveUser` — schema
 * whitelisting (`context.whitelistedTables`) is a live-chat-only concern
 * resolved from the active context file, not something a standalone
 * inspector call carries. A tool that needed more context here would fail
 * loudly (thrown/rejected), not silently misbehave.
 */
import 'server-only';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { UserInputException, type ToolResponse } from '@/orchestrator/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { REGISTRABLES } from '@/lib/chat/orchestration-core.server';

export interface ToolInspectionOutcome {
  executable: boolean;
  result?: unknown;
  error?: string;
}

function findLeafTool(toolName: string) {
  const ToolClass = REGISTRABLES.find((r) => r.schema?.name === toolName);
  if (!ToolClass) return null;
  // MXAgent overrides `static type = 'Agent'`; MXTool leaves it as 'Tool'.
  const type = (ToolClass as unknown as { type?: string }).type;
  if (type === 'Agent') return null;
  return ToolClass;
}

/** Flatten a `ToolResponse` into the plain value the inspector UI renders. */
function flattenToolResponse(response: ToolResponse<unknown>): unknown {
  const textBlocks = response.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text');
  const hasImage = response.content.some((c) => c.type === 'image');
  const joinedText = textBlocks.map((b) => b.text).join('\n');

  let value: unknown = joinedText;
  if (textBlocks.length === 1) {
    try { value = JSON.parse(textBlocks[0].text); } catch { /* leave as raw text */ }
  }

  if (hasImage && value && typeof value === 'object') {
    return { ...(value as Record<string, unknown>), _imageOmitted: true };
  }
  return value;
}

/**
 * Re-run a registered server-side tool standalone, for the admin-only Tool
 * Inspector. Returns `{executable: false, error}` (never throws) when the
 * tool isn't a registered leaf tool or requires frontend interaction.
 */
export async function executeRegisteredTool(
  toolName: string,
  args: Record<string, unknown>,
  user: EffectiveUser,
): Promise<ToolInspectionOutcome> {
  const ToolClass = findLeafTool(toolName);
  if (!ToolClass) {
    return { executable: false, error: `Tool '${toolName}' is not re-executable from the browser` };
  }

  const orchestrator = new Orchestrator(REGISTRABLES, []);
  const context = { effectiveUser: user };

  try {
    const instance = new ToolClass(orchestrator, args, context);
    const outcome = await instance.run();
    if ('role' in outcome) {
      // An MXAgent's `run()` returns an AssistantMessage (role: 'assistant').
      // The type check in findLeafTool should have already excluded these.
      return { executable: false, error: `Tool '${toolName}' returned an agent-style result; cannot inspect standalone.` };
    }
    return { executable: true, result: flattenToolResponse(outcome) };
  } catch (err) {
    if (err instanceof UserInputException) {
      return { executable: false, error: `Tool '${toolName}' requires user interaction and cannot be re-run standalone.` };
    }
    throw err;
  }
}
