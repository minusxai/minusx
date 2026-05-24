/**
 * Server tool registry
 *
 * A registry of server-side tool handlers, used by `/api/tools/execute` (the
 * Tool Inspector) to re-run a tool by name with possibly-modified args. Tools
 * register themselves via `registerTool()` (see `tool-handlers.server.ts`).
 */

import { ToolCall, ToolCallDetails } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

/**
 * Structured return type for server tool handlers that want to pass
 * details to the UI without sending them to the LLM.
 */
export interface ServerToolResult {
  content: string | object;
  details?: ToolCallDetails;
}

/**
 * Tool handler function signature
 * @param args - Destructured tool arguments
 * @param user - Effective user for permissions
 * @param childResults - Optional child task results (for parent tools resuming after spawning children)
 */
export type ToolHandler = (
  args: Record<string, any>,
  user: EffectiveUser,
  childResults?: ToolCall['function']['child_tasks_batch']
) => Promise<string | object>;

/**
 * Global tool registry. Tools call `registerTool()` to make themselves
 * available for server-side execution.
 */
export const toolRegistry: Record<string, ToolHandler> = {};

/** Register a tool handler. */
export function registerTool(name: string, handler: ToolHandler) {
  toolRegistry[name] = handler;
}

/** Check whether a tool can be executed by the server registry. */
export function canExecuteTool(toolCall: ToolCall): boolean {
  const toolName = toolCall.function?.name;
  return toolName ? toolName in toolRegistry : false;
}
