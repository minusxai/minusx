/**
 * Client-side tool handlers
 *
 * These tools are executed on the client side (browser) rather than the server.
 * Used for tools that require user interaction or client-specific capabilities.
 */

import { ToolCall, ToolMessage, DatabaseWithSchema, DocumentContent, QuestionContent } from '@/lib/types';
import { setEphemeral, selectMergedContent, selectEphemeralParamValues, selectDirtyFiles, type FileId } from '@/store/filesSlice';
import type { AppDispatch, RootState } from '@/store/store';
import { getStore } from '@/store/store';
import type { UserInput } from './user-input-exception';
import { UserInputException } from './user-input-exception';
import { FilesAPI } from '../data/files';
import { getRouter } from '@/lib/navigation/use-navigation';
import { readFiles, editFileStr, getQueryResult, createVirtualFile, editFile as editFileOp, compressAugmentedFile } from '@/lib/api/file-state';
import { canCreateFileType } from '@/lib/auth/access-rules.client';
import { preserveParams } from '@/lib/navigation/url-utils';

// ============================================================================
// Frontend Tool Registry
// ============================================================================

/**
 * Context object bundling all frontend tool dependencies
 */
export interface FrontendToolContext {
  database: DatabaseWithSchema;
  dispatch?: AppDispatch;
  signal?: AbortSignal;
  state?: RootState;
  userInputs?: UserInput[];      // Previous user inputs for this tool
}

/**
 * Frontend tool handler signature
 * @param args - Destructured tool arguments
 * @param context - Bundled frontend dependencies
 * @returns Tool result content (string or object)
 */
export type FrontendToolHandler = (
  args: Record<string, any>,
  context: FrontendToolContext
) => Promise<string | object>;

/**
 * Global frontend tool registry
 */
const frontendToolRegistry: Record<string, FrontendToolHandler> = {};

/**
 * Register a frontend tool handler
 */
export function registerFrontendTool(name: string, handler: FrontendToolHandler) {
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
  database: DatabaseWithSchema,
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
    database,
    dispatch,
    signal,
    state,
    userInputs  // Include in context
  };

  const content = await handler(toolCall.function.arguments || {}, context);

  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    content: typeof content === 'string' ? content : JSON.stringify(content)
  };
}

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * UserInputFrontend / UserInputTool - Mock tool for tests and future client-side execution
 */
registerFrontendTool('UserInputFrontend', async () => {
  return 'User provided input';
});

registerFrontendTool('UserInputTool', async () => {
  return 'User provided input';
});

/**
 * Navigate - Navigate user to a file, folder, or new file creation page
 */
registerFrontendTool('Navigate', async (args, context) => {
  const { file_id, path, newFileType } = args;
  const { state, userInputs } = context;

  // Check if user confirmation is required
//   const askForConfirmation = state?.ui?.askForConfirmation ?? false;
// All navigation is always confirmed for now since it's a critical action and we don't want accidental navigations.
  const askForConfirmation = true;

  if (askForConfirmation) {
    // Check if user already confirmed
    const userConfirmed = userInputs?.[0]?.result;

    if (userConfirmed === undefined) {
      // Build description of where we're navigating
      let destination = '';
      if (file_id !== undefined) {
        destination = `file "${file_id}"`;
      } else if (newFileType !== undefined) {
        destination = path ? `"new ${newFileType}" in ${path}` : `"new ${newFileType}"`;
      } else if (path !== undefined) {
        destination = `folder ${path}`;
      }

      // First time - ask for confirmation
      throw new UserInputException({
        type: 'confirmation',
        title: 'Navigation request',
        message: `The agent wants to navigate to ${destination}. Allow it?`,
        confirmText: 'Go ahead',
        cancelText: 'Stay here'
      });
    }

    if (userConfirmed === false) {
      // User cancelled
      return {
        success: false,
        message: 'Navigation cancelled by user'
      };
    }

    // User confirmed - continue with navigation
  }

  const router = getRouter();
  if (!router) {
    return {
      success: false,
      message: 'Router not available'
    };
  }

  // Navigate to existing file
  if (file_id !== undefined) {
    if (isNaN(parseInt(file_id))) {
      return {
        success: false,
        message: `Invalid file_id: ${file_id}. If you do not want to provide it, don't pass it at all.`
      }
    }

    router.push(`/f/${file_id}`);
    if (state) {
      const fileState = state.files.files[file_id]
      if (!fileState?.content) {
        await FilesAPI.loadFile(file_id)
      }
    }
    const debugMsg = newFileType !== undefined ? `;newFileType=${newFileType} is ignored since file_id provided` : ''
    const debugMsg2 = path !== undefined ? `;path=${path} is ignored since file_id provided` : ''
    return {
      success: true,
      message: `Navigated to file ${file_id}${debugMsg}${debugMsg2}`
    };
  }

  // Navigate to new file creation page
  if (newFileType !== undefined) {
    // Check if user has permission to create this file type
    const canCreate = canCreateFileType(newFileType);

    if (!canCreate) {
      return {
        success: false,
        message: `You don't have permission to create ${newFileType} files`
      };
    }

    const virtualFileId = -Date.now();

    // Build URL with virtualId and optional folder parameter
    const params = new URLSearchParams();
    params.set('virtualId', String(virtualFileId));
    if (path !== undefined) {
      params.set('folder', path);
    }
    const url = `/new/${newFileType}?${params.toString()}`;

    router.push(url);
    return {
      success: true,
      message: path
        ? `Navigating to create new ${newFileType} in ${path}, with file id ${virtualFileId}`
        : `Navigating to create new ${newFileType} with file id ${virtualFileId}`,
    };
  }

  // Navigate to folder
  if (path !== undefined) {
    // Remove leading slash if present for the route
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    router.push(`/p/${cleanPath}`);
    return {
      success: true,
      message: `Navigated to ${path}`
    };
  }

  return {
    success: false,
    message: 'Must provide file_id, path, or newFileType'
  };
});

// Operation handlers

/**
 * Set dashboard parameter values (ephemeral, not saved)
 */
function handleSetParameterValues(
  content: DocumentContent,
  parameterValues?: Array<{name: string, value: any}> | Record<string, any>
): Partial<DocumentContent> {
  if (!parameterValues) {
    throw new Error('parameter_values required for set_parameter_values operation');
  }

  // Convert array format to dict if needed
  let valuesDict: Record<string, any>;
  if (Array.isArray(parameterValues)) {
    valuesDict = parameterValues.reduce((acc, pv) => ({
      ...acc,
      [pv.name]: pv.value
    }), {});
  } else {
    valuesDict = parameterValues;
  }

  // Merge with existing values
  return {
    parameterValues: {
      ...(content.parameterValues || {}),
      ...valuesDict
    }
  };
}

/**
 * PresentFinalAnswerFrontend - Frontend execution of PresentFinalAnswer
 * Returns the answer content which will be rendered specially in the UI
 */
registerFrontendTool('PresentFinalAnswerFrontend', async (args) => {
  const { answer } = args;

  if (!answer || typeof answer !== 'string') {
    throw new Error('answer is required and must be a string');
  }

  // Return success with the answer
  // The parent PresentFinalAnswer tool will display this
  return {
    success: true,
    answer: answer
  };
});

/**
 * ClarifyFrontend - Ask user for clarification with options
 * Supports single or multi-select responses
 */
registerFrontendTool('ClarifyFrontend', async (args, context) => {
  const { question, options, multiSelect = false } = args;
  const { userInputs } = context;

  const userResponse = userInputs?.[0]?.result;

  if (userResponse === undefined) {
    throw new UserInputException({
      type: 'choice',
      title: 'Clarification needed',
      message: question,
      options: options.map((opt: any) => ({
        label: opt.label,
        description: opt.description
      })),
      multiSelect,
      cancellable: true
    });
  }

  // Handle cancellation
  if (userResponse?.cancelled) {
    return { success: false, message: 'User cancelled the clarification request' };
  }

  // Handle "Figure it out" option
  if (userResponse?.figureItOut) {
    return {
      success: true,
      message: 'User chose: Figure it out (agent should decide based on context)',
      selection: { label: 'Figure it out', figureItOut: true }
    };
  }

  // Handle "Other" option with custom text
  if (userResponse?.other) {
    return {
      success: true,
      message: `User provided custom response: ${userResponse.text}`,
      selection: { label: 'Other', other: true, text: userResponse.text }
    };
  }

  // Format response message for regular selections
  const formatSelection = (selection: any) => {
    if (Array.isArray(selection)) {
      return selection.map((s: any) => s.label).join(', ');
    }
    return selection?.label || selection;
  };

  return {
    success: true,
    message: `User selected: ${formatSelection(userResponse)}`,
    selection: userResponse
  };
});

// ============================================================================
// Phase 1: Unified File System API - Frontend Tools
// ============================================================================

/**
 * ReadFiles - Load multiple files with references and query results
 * Returns CompressedAugmentedFile[] — pre-merged content/persistableChanges so the
 * model always sees a single flat content layer (no layer reasoning needed).
 */
registerFrontendTool('ReadFiles', async (args, _context) => {
  const { fileIds } = args;

  const result = await readFiles(fileIds, {});

  return result.map(compressAugmentedFile);
});

/**
 * EditFile - String-based editing for native toolset
 * Routes to editFileStr for string find-and-replace with oldMatch/newMatch parameters
 */
registerFrontendTool('EditFile', async (args, _context) => {
  const { fileId, oldMatch, newMatch } = args;

  const state = getStore().getState();
  const fileState = state.files.files[fileId];

  // Edit (stages changes in Redux as draft)
  const result = await editFileStr({ fileId, oldMatch, newMatch });
  if (!result.success) {
    throw new Error(result.error || 'Edit failed');
  }

  // Auto-execute query for questions (agent sees results immediately)
  if (fileState?.type === 'question') {
    const updatedState = getStore().getState();
    const finalContent = selectMergedContent(updatedState, fileId) as any;

    if (finalContent?.query && finalContent?.database_name) {
      const ephemeralValues = selectEphemeralParamValues(updatedState, fileId);
      const params = (finalContent.parameters || []).reduce((acc: any, p: any) => {
        acc[p.name] = ephemeralValues[p.name] ?? p.defaultValue ?? '';
        return acc;
      }, {} as Record<string, any>);

      // Auto-execute is best-effort: a failed execution (e.g. no data, bad param) must NOT
      // cause EditFile to report failure. The edit was already staged successfully.
      try {
        await getQueryResult({
          query: finalContent.query,
          params,
          database: finalContent.database_name
        });
        // Update lastExecuted so QuestionContainerV2 displays results for the new query.
        // Without this, the component keeps showing results for the old lastExecuted query.
        getStore().dispatch(setEphemeral({
          fileId: fileId as FileId,
          changes: {
            lastExecuted: {
              query: finalContent.query,
              params,
              database: finalContent.database_name,
              references: finalContent.references || []
            }
          }
        }));
      } catch (execErr) {
        console.warn('[EditFile] Auto-execute failed (edit still staged):', execErr);
      }
    }
  }

  // Return the updated CompressedAugmentedFile (same format as ReadFiles) so the model can
  // verify edits landed in content and also see references + query results.
  // Also include success:true + diff so EditFileDisplay can render the inline diff in chat.
  const [augmented] = await readFiles([fileId], {});
  return {
    success: true,
    diff: result.diff,
    ...compressAugmentedFile(augmented)
  };
});

/**
 * CreateFile - Create a new file:
 * - Creating a question → always creates as draft (virtual ID), no navigation or modal
 * - Creating a dashboard → navigate to new file creation page
 */
registerFrontendTool('CreateFile', async (args, _context) => {
  const { file_type, name, query, database_name, viz_settings, folder } = args;

  if (file_type === 'question') {
    // Create virtual file (draft) — always, regardless of current page context
    const virtualId = await createVirtualFile('question', { folder, query, databaseName: database_name });

    if (name) {
      await editFileOp({ fileId: virtualId, changes: { name } });
    }
    if (viz_settings) {
      await editFileOp({ fileId: virtualId, changes: { content: { vizSettings: viz_settings } } });
    }

    return {
      success: true,
      id: virtualId,
      message: `Created draft question "${name}" (virtualId: ${virtualId}).`
    };
  }

  // Dashboard → navigate to new file creation page
  const router = getRouter();
  if (!router) {
    return { success: false, message: 'Router not available' };
  }
  const virtualFileId = -Date.now();
  const params = new URLSearchParams();
  params.set('virtualId', String(virtualFileId));
  if (folder) params.set('folder', folder);
  const url = preserveParams(`/new/${file_type}?${params.toString()}`);
  router.push(url);
  return {
    success: true,
    message: `Navigating to create new ${file_type}`
  };
});


/**
 * PublishAll - Open PublishModal for user to review and publish all unsaved changes
 */
registerFrontendTool('PublishAll', async (_args, context) => {
  const { userInputs, state } = context;

  const userResponse = userInputs?.[0]?.result;

  // First invocation: check dirty files and show modal if needed
  if (userResponse === undefined) {
    const reduxState = state || getStore().getState();
    const dirtyFiles = selectDirtyFiles(reduxState);

    if (dirtyFiles.length === 0) {
      return { success: true, message: 'No unsaved changes' };
    }

    throw new UserInputException({
      type: 'publish',
      title: 'Unsaved Changes',
      fileCount: dirtyFiles.length,
    });
  }

  // Resume: user closed the modal — use their response directly.
  // Do NOT re-read dirtyFiles here: publishAll() already cleared them in Redux,
  // so re-reading would incorrectly return 'No unsaved changes'.
  if (userResponse.cancelled) {
    return {
      success: false,
      message: `Publish cancelled. ${userResponse.remaining} file${userResponse.remaining === 1 ? '' : 's'} still have unsaved changes.`,
    };
  }

  const fileCount = userInputs?.[0]?.props?.fileCount ?? 0;
  return {
    success: true,
    message: `Published ${fileCount} file${fileCount === 1 ? '' : 's'} successfully.`,
  };
});

/**
 * SetRuntimeValues - Set ephemeral runtime values (parameter values) on a file
 * Works for both questions and dashboards
 */
registerFrontendTool('SetRuntimeValues', async (args, context) => {
  const { fileId, parameter_values } = args;
  const { dispatch, state } = context;

  if (!dispatch || fileId === undefined) {
    return {
      success: false,
      message: 'Missing dispatch or fileId'
    };
  }

  // Get merged content to merge with existing parameter values
  const reduxState = state || getStore().getState();
  const mergedContent = selectMergedContent(reduxState, fileId);

  if (!mergedContent) {
    return {
      success: false,
      error: `File content not available. FileId: ${fileId}`
    };
  }

  // Reuse existing helper to normalize parameter_values format
  const paramUpdates = handleSetParameterValues(mergedContent as DocumentContent, parameter_values);
  const paramValues = paramUpdates.parameterValues || {};

  // Build lastExecuted with actual query/database from file content
  // For questions, useQueryResult skips execution when query is empty,
  // so we must populate from the file's current content.
  const fileState = reduxState.files.files[fileId];
  const isQuestion = fileState?.type === 'question';
  const questionContent = isQuestion ? mergedContent as QuestionContent : null;

  const lastExecuted = {
    query: questionContent?.query || '',
    params: paramValues,
    database: questionContent?.database_name || '',
    references: questionContent?.references || []
  };

  // Set ephemeral state + lastExecuted to trigger execution
  dispatch(setEphemeral({
    fileId: fileId as FileId,
    changes: {
      parameterValues: paramValues,
      lastExecuted
    }
  }));

  const paramEntries = Object.entries(paramValues);
  const paramSummary = paramEntries.map(([k, v]) => `${k}=${v}`).join(', ');

  return {
    success: true,
    message: `Set ${paramEntries.length} parameter value(s): ${paramSummary}`
  };
});
