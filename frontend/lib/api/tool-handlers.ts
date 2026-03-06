/**
 * Client-side tool handlers
 *
 * These tools are executed on the client side (browser) rather than the server.
 * Used for tools that require user interaction or client-specific capabilities.
 */

import { ToolCall, ToolMessage, ToolCallDetails, EditFileDetails, ClarifyDetails, DatabaseWithSchema, DocumentContent, QuestionContent } from '@/lib/types';
import { setEphemeral, selectMergedContent, selectEphemeralParamValues, selectDirtyFiles, type FileId } from '@/store/filesSlice';
import type { AppDispatch, RootState } from '@/store/store';
import { getStore } from '@/store/store';
import type { UserInput } from './user-input-exception';
import { UserInputException } from './user-input-exception';
import { FilesAPI } from '../data/files';
import { getRouter } from '@/lib/navigation/use-navigation';
import { readFiles, editFileStr, getQueryResult, createVirtualFile, editFile as editFileOp, compressAugmentedFile, selectAugmentedFiles } from '@/lib/api/file-state';
import { validateFileState } from '@/lib/validation/content-validators';
import { canCreateFileType } from '@/lib/auth/access-rules.client';

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

  const result = await handler(toolCall.function.arguments || {}, context);

  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
    details: result.details
  };
}

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * UserInputFrontend / UserInputTool - Mock tool for tests and future client-side execution
 */
registerFrontendTool('UserInputFrontend', async () => {
  return { content: 'User provided input', details: { success: true } };
});

registerFrontendTool('UserInputTool', async () => {
  return { content: 'User provided input', details: { success: true } };
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
      const msg = 'Navigation cancelled by user';
      return { content: { success: false, message: msg }, details: { success: false, error: msg } };
    }

    // User confirmed - continue with navigation
  }

  const router = getRouter();
  if (!router) {
    const msg = 'Router not available';
    return { content: { success: false, message: msg }, details: { success: false, error: msg } };
  }

  // Navigate to existing file
  if (file_id !== undefined) {
    if (isNaN(parseInt(file_id))) {
      const msg = `Invalid file_id: ${file_id}. If you do not want to provide it, don't pass it at all.`;
      return { content: { success: false, message: msg }, details: { success: false, error: msg } };
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
    const msg = `Navigated to file ${file_id}${debugMsg}${debugMsg2}`;
    return { content: { success: true, message: msg }, details: { success: true } };
  }

  // Navigate to new file creation page
  if (newFileType !== undefined) {
    // Check if user has permission to create this file type
    const canCreate = canCreateFileType(newFileType);

    if (!canCreate) {
      const msg = `You don't have permission to create ${newFileType} files`;
      return { content: { success: false, message: msg }, details: { success: false, error: msg } };
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
    const msg = path
      ? `Navigating to create new ${newFileType} in ${path}, with file id ${virtualFileId}`
      : `Navigating to create new ${newFileType} with file id ${virtualFileId}`;
    return { content: { success: true, message: msg }, details: { success: true } };
  }

  // Navigate to folder
  if (path !== undefined) {
    // Remove leading slash if present for the route
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    router.push(`/p/${cleanPath}`);
    const msg = `Navigated to ${path}`;
    return { content: { success: true, message: msg }, details: { success: true } };
  }

  const msg = 'Must provide file_id, path, or newFileType';
  return { content: { success: false, message: msg }, details: { success: false, error: msg } };
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

  const content = { success: true, answer };
  return { content, details: { success: true } };
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
    const msg = 'User cancelled the clarification request';
    const content = { success: false, message: msg };
    return { content, details: { success: false, error: msg, message: msg } satisfies ClarifyDetails };
  }

  // Handle "Figure it out" option
  if (userResponse?.figureItOut) {
    const selection = { label: 'Figure it out', figureItOut: true };
    const msg = 'User chose: Figure it out (agent should decide based on context)';
    const content = { success: true, message: msg, selection };
    return { content, details: { success: true, message: msg, selection } satisfies ClarifyDetails };
  }

  // Handle "Other" option with custom text
  if (userResponse?.other) {
    const selection = { label: 'Other', other: true, text: userResponse.text };
    const msg = `User provided custom response: ${userResponse.text}`;
    const content = { success: true, message: msg, selection };
    return { content, details: { success: true, message: msg, selection } satisfies ClarifyDetails };
  }

  // Format response message for regular selections
  const formatSelection = (sel: any) => {
    if (Array.isArray(sel)) {
      return sel.map((s: any) => s.label).join(', ');
    }
    return sel?.label || sel;
  };

  const selection = userResponse;
  const msg = `User selected: ${formatSelection(userResponse)}`;
  const content = { success: true, message: msg, selection };
  return { content, details: { success: true, message: msg, selection } satisfies ClarifyDetails };
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
  const content = { success: true, files: result.map(compressAugmentedFile) };
  return { content, details: { success: true } };
});

/**
 * EditFile - String-based editing for native toolset
 * Routes to editFileStr for string find-and-replace with oldMatch/newMatch parameters.
 *
 * Returns a delta response: full data for changed parts, stubs for unchanged ones.
 * - fileState: always full (the edited file always changes)
 * - references: {id, unchanged: true} for pre-existing refs; full for new ones
 * - queryResults: {queryResultId, unchanged: true} for results with same hash; full for new/changed
 */
registerFrontendTool('EditFile', async (args, _context) => {
  const { fileId, oldMatch, newMatch } = args;

  // Snapshot state before edit to compute delta
  const stateBefore = getStore().getState();
  const fileState = stateBefore.files.files[fileId];
  const [augmentedBefore] = selectAugmentedFiles(stateBefore, [fileId]) ?? [];
  const prevQueryResultIds = new Set<string>(
    (augmentedBefore?.queryResults ?? []).map((qr: any) => qr.id).filter(Boolean)
  );
  const prevRefIds = new Set<number>(fileState?.references ?? []);

  // Edit (stages changes in Redux as draft)
  const result = await editFileStr({ fileId, oldMatch, newMatch });
  if (!result.success) {
    const err = result.error || 'Edit failed';
    return { content: { success: false, error: err }, details: { success: false, error: err } };
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

  // Build delta response
  const [augmented] = await readFiles([fileId], {});
  const compressed = compressAugmentedFile(augmented);

  // References delta: stub for pre-existing refs (their content didn't change during this edit)
  const deltaReferences = compressed.references.map(ref =>
    prevRefIds.has(ref.id) ? { id: ref.id, unchanged: true } : ref
  );

  // QueryResults delta: stub for results with the same hash as before the edit.
  // A different hash means the query/params changed → new result → include full data.
  const deltaQueryResults = compressed.queryResults.map((qr: any) => {
    const qrId: string | undefined = qr.id;
    if (qrId && prevQueryResultIds.has(qrId)) {
      return { queryResultId: qrId, unchanged: true };
    }
    return qr;
  });

  const diff = result.diff ?? '';
  const content = {
    success: true,
    fileState: compressed.fileState,
    references: deltaReferences,
    queryResults: deltaQueryResults,
  };
  return { content, details: { success: true, diff } as EditFileDetails };
});

/**
 * CreateFile - Create a new virtual file (draft, any type).
 * Always creates as a draft in Redux (negative virtual ID) — no navigation.
 *
 * Args: {file_type, name?, path?, content?}
 * - path: folder path to create in (replaces old `folder` param)
 * - content: generic object merged on top of the template defaults
 *
 * Returns: {success: true, state: CompressedAugmentedFile}
 */
registerFrontendTool('CreateFile', async (args, _context) => {
  const { file_type, name, path, content } = args;

  // Create virtual file (draft) for any type — no navigation
  const virtualId = await createVirtualFile(file_type, { folder: path });

  if (name) {
    await editFileOp({ fileId: virtualId, changes: { name } });
  }
  if (content && Object.keys(content).length > 0) {
    await editFileOp({ fileId: virtualId, changes: { content } });
  }

  // Validate final merged content (template defaults + content override)
  // Same validator as editFileStr — catches bad vizSettings, invalid types, etc.
  const fileType = getStore().getState().files.files[virtualId]?.type;
  const mergedContent = selectMergedContent(getStore().getState(), virtualId);
  if (fileType && mergedContent) {
    const validationError = validateFileState({ type: fileType, content: mergedContent });
    if (validationError) {
      const err = `Invalid content for '${fileType}': ${validationError}`;
      return { content: { success: false, error: err }, details: { success: false, error: err } };
    }
  }

  const [augmented] = await readFiles([virtualId], {});
  if (!augmented) {
    const err = `Failed to read created file (virtualId: ${virtualId})`;
    return { content: { success: false, error: err }, details: { success: false, error: err } };
  }

  const result = { success: true, state: compressAugmentedFile(augmented) };
  return { content: result, details: { success: true } };
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
      return { content: { success: true, message: 'No unsaved changes' }, details: { success: true } };
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
    const msg = `Publish cancelled. ${userResponse.remaining} file${userResponse.remaining === 1 ? '' : 's'} still have unsaved changes.`;
    return { content: { success: false, message: msg }, details: { success: false, error: msg, message: msg } };
  }

  const fileCount = userInputs?.[0]?.props?.fileCount ?? 0;
  const msg = `Published ${fileCount} file${fileCount === 1 ? '' : 's'} successfully.`;
  return { content: { success: true, message: msg }, details: { success: true, message: msg } };
});

/**
 * SetRuntimeValues - Set ephemeral runtime values (parameter values) on a file
 * Works for both questions and dashboards
 */
registerFrontendTool('SetRuntimeValues', async (args, context) => {
  const { fileId, parameter_values } = args;
  const { dispatch, state } = context;

  if (!dispatch || fileId === undefined) {
    const msg = 'Missing dispatch or fileId';
    return { content: { success: false, message: msg }, details: { success: false, error: msg } };
  }

  // Get merged content to merge with existing parameter values
  const reduxState = state || getStore().getState();
  const mergedContent = selectMergedContent(reduxState, fileId);

  if (!mergedContent) {
    const err = `File content not available. FileId: ${fileId}`;
    return { content: { success: false, error: err }, details: { success: false, error: err } };
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
  const msg = `Set ${paramEntries.length} parameter value(s): ${paramSummary}`;
  return { content: { success: true, message: msg }, details: { success: true } };
});
