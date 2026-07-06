/**
 * Shared types for frontend tool handlers.
 *
 * Colocated here (rather than in `tool-handlers.ts`) so every handler module under
 * `lib/tools/handlers/` can import them without depending on the barrel — that keeps the
 * dependency direction one-way (barrel -> handlers), never handlers -> barrel.
 */
import type { ToolCallDetails } from '@/lib/types';
import type { AppDispatch, RootState } from '@/store/store';
import type { UserInput } from '../user-input-exception';

/**
 * Context object bundling all frontend tool dependencies
 */
export interface FrontendToolContext {
  dispatch?: AppDispatch;
  signal?: AbortSignal;
  state?: RootState;
  contextPath?: string;
  userInputs?: UserInput[];      // Previous user inputs for this tool
}

/**
 * Structured result returned by every frontend tool handler.
 * `content` is identical to the old flat return — LLM sees this.
 * `details` is structured metadata for UI rendering — not sent to LLM.
 */
export interface ToolHandlerResult<TDetails extends ToolCallDetails = ToolCallDetails> {
  content: string | object;
  details: TDetails;
}

/**
 * Frontend tool handler signature
 * @param args - Destructured tool arguments
 * @param context - Bundled frontend dependencies
 * @returns ToolHandlerResult with content (for LLM) and details (for UI)
 */
export type FrontendToolHandler = (
  args: Record<string, any>,
  context: FrontendToolContext
) => Promise<ToolHandlerResult>;
