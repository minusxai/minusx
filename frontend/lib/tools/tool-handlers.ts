/**
 * Client-side tool handlers
 *
 * These tools are executed on the client side (browser) rather than the server.
 * Used for tools that require user interaction or client-specific capabilities.
 *
 * This file is the registry + public entry point (`executeToolCall`). Each tool's
 * implementation lives in its own module under `lib/tools/handlers/` — see that
 * directory for the actual handler bodies; this file only wires them up.
 */

import type { ToolCall, ToolMessage } from '@/lib/types';
import type { AppDispatch, RootState } from '@/store/store';
import type { UserInput } from './user-input-exception';
import type { FrontendToolContext, FrontendToolHandler } from './handlers/types';

import { userInputFrontendHandler, userInputToolHandler } from './handlers/user-input';
import { resolveUserSkillFrontend } from './handlers/load-skill';
import { navigateHandler } from './handlers/navigate';
import { clarifyFrontendHandler } from './handlers/clarify';
import { readFilesHandler } from './handlers/read-files';
import { screenshotHandler } from './handlers/screenshot';
import { reviewFileHandler } from './handlers/review-file';
import { editFileHandler } from './handlers/edit-file';
import { createFileHandler } from './handlers/create-file';
import { publishAllHandler } from './handlers/publish-all';

// ============================================================================
// Frontend Tool Registry
// ============================================================================

/**
 * Global frontend tool registry
 */
const frontendToolRegistry: Record<string, FrontendToolHandler> = {};

/**
 * Register a frontend tool handler
 */
function registerFrontendTool(name: string, handler: FrontendToolHandler) {
  frontendToolRegistry[name] = handler;
}

/**
 * Get all registered frontend tool names
 */
export function getRegisteredToolNames(): string[] {
  return Object.keys(frontendToolRegistry);
}

/**
 * Check if a tool can be executed on the frontend
 */
export function isFrontendTool(name: string): boolean {
  return name in frontendToolRegistry;
}

// ============================================================================
// Main Executor
// ============================================================================

/**
 * Execute a tool call on the client side
 */
export async function executeToolCall(
  toolCall: ToolCall,
  dispatch?: AppDispatch,
  signal?: AbortSignal,
  state?: RootState,  // Redux state from middleware
  userInputs?: UserInput[]       // User inputs for this tool
): Promise<ToolMessage> {
  const toolName = toolCall.function?.name;
  const handler = frontendToolRegistry[toolName];

  if (!handler) {
    throw new Error(`Unknown client-side tool: ${toolName}`);
  }

  const context: FrontendToolContext = {
    dispatch,
    signal,
    state,
    contextPath: state?.chat?.conversations
      ? Object.values(state.chat.conversations)
          .find(conversation => conversation.pending_tool_calls.some(pending => pending.toolCall.id === toolCall.id))
          ?.agent_args?.context_path
      : undefined,
    userInputs  // Include in context
  };

  const result = await handler(toolCall.function.arguments || {}, context);

  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    content: Array.isArray(result.content)
      ? result.content
      : typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
    details: result.details
  };
}

// ============================================================================
// Tool Registrations
// ============================================================================

/**
 * UserInputFrontend / UserInputTool - Mock tool for tests and future client-side execution
 */
registerFrontendTool('UserInputFrontend', userInputFrontendHandler);
registerFrontendTool('UserInputTool', userInputToolHandler);

/**
 * LoadSkillFrontend / LoadSkill - resolve a user-defined Knowledge Base skill
 * (see handlers/load-skill.ts for the shared implementation)
 */
registerFrontendTool('LoadSkillFrontend', resolveUserSkillFrontend);
registerFrontendTool('LoadSkill', resolveUserSkillFrontend);

/**
 * Navigate - Navigate user to a file, folder, or new file creation page
 */
registerFrontendTool('Navigate', navigateHandler);

/**
 * ClarifyFrontend - Ask user for clarification with options
 */
registerFrontendTool('ClarifyFrontend', clarifyFrontendHandler);

// ============================================================================
// Phase 1: Unified File System API - Frontend Tools
// ============================================================================

/**
 * ReadFiles - Load multiple files with references and query results
 */
registerFrontendTool('ReadFiles', readFilesHandler);

/**
 * ReviewFile - screenshot of the LIVE rendered view + full health rubric (deterministic +
 * LLM visual judge + score). Screenshot is its legacy alias (old conversation logs only).
 */
registerFrontendTool('ReviewFile', reviewFileHandler);
registerFrontendTool('Screenshot', screenshotHandler);

/**
 * EditFile - String-based editing for native toolset
 */
registerFrontendTool('EditFile', editFileHandler);

// SetJsx / EditJsx were removed in File Architecture v2 — a document's jsx body is edited
// through EditFile (the markup's <jsx> block), like any other file.

/**
 * CreateFile - Create a new virtual file (draft, any type)
 */
registerFrontendTool('CreateFile', createFileHandler);

/**
 * PublishAll - Open PublishModal for user to review and publish all unsaved changes
 */
registerFrontendTool('PublishAll', publishAllHandler);
