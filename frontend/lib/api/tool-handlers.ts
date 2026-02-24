/**
 * Client-side tool handlers
 *
 * These tools are executed on the client side (browser) rather than the server.
 * Used for tools that require user interaction or client-specific capabilities.
 */

import { ToolCall, ToolMessage, DatabaseWithSchema, DocumentContent, QuestionContent, ReportContent, ReportReference, AlertContent, AlertSelector, AlertFunction, ComparisonOperator } from '@/lib/types';
import { setEdit, setEphemeral, setFile, selectMergedContent, setMetadataEdit, type FileId } from '@/store/filesSlice';
import type { AppDispatch, RootState } from '@/store/store';
import { getStore } from '@/store/store';
import type { UserInput } from './user-input-exception';
import { UserInputException } from './user-input-exception';
import { slugify } from '@/lib/slug-utils';
import { FilesAPI } from '../data/files';
import { fetchWithCache } from './fetch-wrapper';
import { API } from './declarations';
import { extractReferencesFromContent } from '@/lib/data/helpers/extract-references';
import { getRouter } from '@/lib/navigation/use-navigation';
import { readFilesStr, editFileStr, publishFile, getQueryResult, createVirtualFile, editFile as editFileOp, clearFileChanges } from '@/lib/api/file-state';
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

/**
 * ExecuteSQLQueryForeground - Execute query and update question page
 */
registerFrontendTool('ExecuteSQLQueryForeground', async (args, context) => {
  const { query, connection_id, vizSettings, parameters, references, file_id } = args;
  const { database, dispatch, signal, state, userInputs } = context;

  // Check if user confirmation is required
  const askForConfirmation = state?.ui?.askForConfirmation ?? false;

  if (file_id === undefined) {
    // If no file_id is provided, do not ask for confirmation
    console.warn('[Foreground] No file_id provided for ExecuteSQLQueryForeground');
    return {
        success: false,
        message: 'No file_id provided when executing SQL query in foreground!'
    };
  }

  if (askForConfirmation) {
    // Check if user already confirmed
    const userConfirmed = userInputs?.[0]?.result;

    if (userConfirmed === undefined) {
      // First time - ask for confirmation
      throw new UserInputException({
        type: 'confirmation',
        title: 'Edit this question?',
        message: 'Do you want to update the question with this query?',
        confirmText: 'Yes',
        cancelText: 'No'
      });
    }

    if (userConfirmed === false) {
      // User cancelled
      return {
        success: false,
        message: 'Query update rejected by user'
      };
    }

    // User confirmed - continue with execution
  }

  // Parse parameters if provided
  let parsedParameters = [];
  if (parameters !== undefined) {
    if (typeof parameters === 'string') {
      try {
        parsedParameters = JSON.parse(parameters);
      } catch (e) {
        console.error('[Foreground] Failed to parse parameters:', parameters, e);
      }
    } else {
      parsedParameters = parameters;
    }
  }

  // Parse references if provided
  let parsedReferences = undefined;
  if (references !== undefined) {
    if (typeof references === 'string') {
      try {
        parsedReferences = JSON.parse(references);
      } catch (e) {
        console.error('[Foreground] Failed to parse references:', references, e);
        return {
          success: false,
          error: 'Invalid references JSON format'
        };
      }
    } else {
      parsedReferences = references;
    }

    // Validate references structure
    if (parsedReferences && !Array.isArray(parsedReferences)) {
      return {
        success: false,
        error: 'references must be an array'
      };
    }

    // Validate each reference has required fields and follows alias pattern
    if (parsedReferences) {
      for (const ref of parsedReferences) {
        if (typeof ref.id !== 'number' || typeof ref.alias !== 'string') {
          return {
            success: false,
            error: 'Each reference must have id (number) and alias (string)'
          };
        }

        // CRITICAL: Alias must end with _<id> for uniqueness
        const expectedSuffix = `_${ref.id}`;
        if (!ref.alias.endsWith(expectedSuffix)) {
          return {
            success: false,
            error: `Invalid alias "${ref.alias}" for question ID ${ref.id}. Alias must end with "${expectedSuffix}" (e.g., "base_data${expectedSuffix}")`
          };
        }
      }
    }
  }

  // Execute the query with automatic deduplication
  let json;
  try {
    json = await fetchWithCache('/api/query', {
      method: 'POST',
      body: JSON.stringify({
        database_name: connection_id || database.databaseName,
        query: query,
        parameters: parsedParameters,
        references: parsedReferences
      }),
      signal: signal,
      cacheStrategy: API.query.execute.cache,
    });
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Query execution failed'
    };
  }

  let finalVizSettings;
  if (!vizSettings) {
    finalVizSettings = {'type': 'table'};
  } else if (typeof vizSettings === 'string') {
    // Parse JSON string to object (LLM sends as string per Python tool definition)
    try {
      finalVizSettings = JSON.parse(vizSettings);
    } catch (e) {
      console.error('[Foreground] Failed to parse vizSettings:', vizSettings, e);
      finalVizSettings = {'type': 'table'};
    }
  } else {
    finalVizSettings = vizSettings;
  }

  // Update Redux store if we have fileId and dispatch (question page)
  if (file_id !== undefined && dispatch) {
    const updates: any = {
      query: query,
      database_name: connection_id || database.databaseName,
      vizSettings: finalVizSettings
    };

    // Include parameters if provided
    if (parsedParameters.length > 0) {
      updates.parameters = parsedParameters;
    }

    // Include references if provided
    if (parsedReferences !== undefined) {
      updates.references = parsedReferences;
    }

    // Dispatch setEdit action to update the file
    dispatch(setEdit({
      fileId: file_id as FileId,
      edits: updates
    }));

    // Update ephemeralChanges.lastExecuted to trigger query execution
    // Convert parameters array to key-value object for execution
    const paramsObj = parsedParameters.reduce((acc: any, p: any) => {
      acc[p.name] = p.value;
      return acc;
    }, {});

    const lastExecuted = {
      query: query,
      params: paramsObj,
      database: connection_id || database.databaseName,
      vizSettings: finalVizSettings,
      references: parsedReferences
    };
    dispatch(setEphemeral({
      fileId: file_id as FileId,
      changes: { lastExecuted } as any
    }));
  }

  return {
    success: true,
    message: 'UI updated with query results',
    data: json.data || json
  };
});

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
 * UpdateFileMetadata - Update current file's name/description/path
 */
registerFrontendTool('UpdateFileMetadata', async (args, context) => {
  const { name, description, path, file_id } = args;
  const { dispatch } = context;

  if (!dispatch || !file_id) {
    return {
      success: false,
      message: 'Missing dispatch or file_id'
    };
  }

  const fileId = file_id as FileId;
  // Update metadata (name/path)
  if (name !== undefined || path !== undefined) {
    const changes: { name?: string; path?: string } = {};
    if (name !== undefined) changes.name = name;
    // if (path !== undefined) changes.path = path;

    dispatch(setMetadataEdit({ fileId, changes }));
  }

  // Update content (description)
  if (description !== undefined) {
    dispatch(setEdit({ fileId, edits: { description } }));
  }

  const updates = [];
  if (name) updates.push(`name: "${name}"`);
  if (description) updates.push('description');
  if (path) updates.push(`path: "${path}"`);

  return {
    success: true,
    message: `Updated ${updates.join(', ')}`
  };
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

/**
 * EditDashboard - Edit dashboard content (add/remove questions, modify layout, add text)
 */
registerFrontendTool('EditDashboard', async (args, context) => {
  const { dispatch, state, userInputs } = context;

  let { operation, question_id, layout_item, asset_id, text_content, file_id } = args;

  if (operation === undefined || file_id === undefined || !dispatch) {
    console.error('[EditDashboard] Missing required arguments: operation or file_id or dispatch')
    return {
        success: false,
        error: 'Missing operation or file_id argument'
    };
  }

  // Check if user confirmation is required
  const askForConfirmation = state?.ui?.askForConfirmation ?? false;

  if (askForConfirmation) {
    const userConfirmed = userInputs?.[0]?.result;

    if (userConfirmed === undefined) {
      // Build description of what we're doing
      const opDescriptions: Record<string, string> = {
        'add_existing_question': `add question #${question_id} to dashboard`,
        'remove_question': `remove question #${question_id} from dashboard`,
        'update_layout': 'update dashboard layout',
        'add_text': 'add text to dashboard',
        'remove_asset': `remove asset "${asset_id}" from dashboard`,
        'add_new_question': 'create a new question and add to dashboard',
        'update_question': `update question #${question_id}`
      };
      const description = opDescriptions[operation] || `perform "${operation}"`;

      throw new UserInputException({
        type: 'confirmation',
        title: 'Edit dashboard?',
        message: `Do you want to ${description}?`,
        confirmText: 'Yes',
        cancelText: 'No'
      });
    }

    if (userConfirmed === false) {
      return {
        success: false,
        message: 'Dashboard edit cancelled by user'
      };
    }
  }

  // Convert empty strings to undefined for optional parameters
  if (layout_item === '') layout_item = undefined;
  if (asset_id === '') asset_id = undefined;
  if (text_content === '') text_content = undefined;

  // Parse layout_item if it's a JSON string
  if (typeof layout_item === 'string' && layout_item) {
    try {
      layout_item = JSON.parse(layout_item);
    } catch (e) {
      console.error('[EditDashboard] Failed to parse layout_item:', layout_item);
    }
  }

  // Convert question_id to number if it's a string
  if (typeof question_id === 'string' && question_id) {
    question_id = parseInt(question_id, 10);
  }

  // Get content from passed state or fallback to store
  const reduxState = state || getStore().getState();
  const mergedContent = selectMergedContent(reduxState, file_id) as DocumentContent;

  if (!mergedContent) {
    return {
      success: false,
      error: `Dashboard content not available. FileId: ${file_id}`
    };
  }

  // Execute operation
  let updates: Partial<DocumentContent> | any;
  let resultMessage: string;

  switch (operation) {
    case 'add_existing_question':
      updates = handleAddQuestion(mergedContent, question_id, layout_item);
      resultMessage = `Added question ${question_id} to dashboard`;
      break;
    case 'remove_question':
      updates = handleRemoveQuestion(mergedContent, question_id);
      resultMessage = `Removed question ${question_id} from dashboard`;
      break;
    case 'update_layout':
      updates = handleUpdateLayout(mergedContent, layout_item);
      resultMessage = `Updated layout for item ${layout_item.id}`;
      break;
    case 'add_text':
      updates = handleAddText(mergedContent, text_content);
      resultMessage = `Added text content to dashboard`;
      break;
    case 'remove_asset':
      updates = handleRemoveAsset(mergedContent, asset_id);
      resultMessage = `Removed asset ${asset_id} from dashboard`;
      break;
    case 'add_new_question':
      return await handleAddNewQuestion(mergedContent, args, context);
    case 'update_question':
      return await handleUpdateQuestion(args, context);
    case 'set_parameter_values': {
      const paramUpdates = handleSetParameterValues(mergedContent, args.parameter_values);
      const paramValues = paramUpdates.parameterValues || {};
      // Set ephemeral typing state + lastExecuted.params to trigger execution
      dispatch(setEphemeral({
        fileId: file_id as FileId,
        changes: {
          parameterValues: paramValues,
          lastExecuted: { query: '', params: paramValues, database: '', references: [] }
        }
      }));
      return {
        success: true,
        message: `Successfully executed set_parameter_values. Set ${Object.keys(args.parameter_values || {}).length} parameter value(s)`,
        updates: paramUpdates
      };
    }
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }

  // Update Redux
  dispatch(setEdit({
    fileId: file_id as FileId,
    edits: updates
  }));

  return {
    success: true,
    message: `Successfully executed ${operation}. ${resultMessage}`,
    updates
  };
});

/**
 * EditReport - Edit report configuration (schedule, references, prompts, emails)
 */
registerFrontendTool('EditReport', async (args, context) => {
  const { dispatch, state, userInputs } = context;

  let { operation, file_id, schedule, reference_type, reference_id, prompt, report_prompt, emails } = args;

  if (operation === undefined || file_id === undefined || !dispatch) {
    console.error('[EditReport] Missing required arguments: operation or file_id or dispatch')
    return {
      success: false,
      error: 'Missing operation or file_id argument'
    };
  }

  // Check if user confirmation is required
  const askForConfirmation = state?.ui?.askForConfirmation ?? false;

  if (askForConfirmation) {
    const userConfirmed = userInputs?.[0]?.result;

    if (userConfirmed === undefined) {
      // Build description of what we're doing
      const opDescriptions: Record<string, string> = {
        'update_schedule': 'update report schedule',
        'add_reference': `add ${reference_type} #${reference_id} to report`,
        'remove_reference': `remove reference #${reference_id} from report`,
        'update_reference': `update prompt for reference #${reference_id}`,
        'update_report_prompt': 'update report synthesis instructions',
        'update_emails': 'update report delivery emails'
      };
      const description = opDescriptions[operation] || `perform "${operation}"`;

      throw new UserInputException({
        type: 'confirmation',
        title: 'Edit report?',
        message: `Do you want to ${description}?`,
        confirmText: 'Yes',
        cancelText: 'No'
      });
    }

    if (userConfirmed === false) {
      return {
        success: false,
        message: 'Report edit cancelled by user'
      };
    }
  }

  // Parse schedule if it's a JSON string
  if (typeof schedule === 'string' && schedule) {
    try {
      schedule = JSON.parse(schedule);
    } catch (e) {
      console.error('[EditReport] Failed to parse schedule:', schedule);
    }
  }

  // Parse emails if it's a JSON string
  if (typeof emails === 'string' && emails) {
    try {
      emails = JSON.parse(emails);
    } catch (e) {
      console.error('[EditReport] Failed to parse emails:', emails);
    }
  }

  // Convert reference_id to number if it's a string
  if (typeof reference_id === 'string' && reference_id) {
    reference_id = parseInt(reference_id, 10);
  }

  // Get content from passed state or fallback to store
  const reduxState = state || getStore().getState();
  const mergedContent = selectMergedContent(reduxState, file_id) as ReportContent;

  if (!mergedContent) {
    return {
      success: false,
      error: `Report content not available. FileId: ${file_id}`
    };
  }

  // Execute operation
  let updates: Partial<ReportContent>;
  let resultMessage: string;

  switch (operation) {
    case 'update_schedule':
      updates = handleUpdateSchedule(mergedContent, schedule);
      resultMessage = `Updated schedule to ${schedule?.cron} (${schedule?.timezone})`;
      break;
    case 'add_reference':
      updates = handleAddReference(mergedContent, reference_type, reference_id, prompt);
      resultMessage = `Added ${reference_type} ${reference_id} to report`;
      break;
    case 'remove_reference':
      updates = handleRemoveReference(mergedContent, reference_id);
      resultMessage = `Removed reference ${reference_id} from report`;
      break;
    case 'update_reference':
      updates = handleUpdateReference(mergedContent, reference_id, prompt);
      resultMessage = `Updated prompt for reference ${reference_id}`;
      break;
    case 'update_report_prompt':
      updates = handleUpdateReportPrompt(mergedContent, report_prompt);
      resultMessage = `Updated report synthesis instructions`;
      break;
    case 'update_emails':
      updates = handleUpdateEmails(mergedContent, emails);
      resultMessage = `Updated delivery emails to ${emails?.length || 0} recipients`;
      break;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }

  // Update Redux
  dispatch(setEdit({
    fileId: file_id as FileId,
    edits: updates
  }));

  return {
    success: true,
    message: `Successfully executed ${operation}. ${resultMessage}`,
    updates
  };
});

// EditReport operation handlers

function handleUpdateSchedule(
  _content: ReportContent,
  schedule: { cron: string; timezone: string }
): Partial<ReportContent> {
  if (!schedule || !schedule.cron || !schedule.timezone) {
    throw new Error('schedule with cron and timezone is required for update_schedule operation');
  }
  return { schedule };
}

function handleAddReference(
  content: ReportContent,
  referenceType: 'question' | 'dashboard',
  referenceId: number,
  prompt: string
): Partial<ReportContent> {
  if (!referenceType || !referenceId || !prompt) {
    throw new Error('reference_type, reference_id, and prompt are required for add_reference operation');
  }

  // Check for duplicate
  const existingRef = content.references?.find(
    r => r.reference.id === referenceId && r.reference.type === referenceType
  );
  if (existingRef) {
    throw new Error(`${referenceType} ${referenceId} already exists in report`);
  }

  const newReference: ReportReference = {
    reference: { type: referenceType, id: referenceId },
    prompt
  };

  return {
    references: [...(content.references || []), newReference]
  };
}

function handleRemoveReference(
  content: ReportContent,
  referenceId: number
): Partial<ReportContent> {
  if (!referenceId) {
    throw new Error('reference_id is required for remove_reference operation');
  }

  const newReferences = (content.references || []).filter(
    r => r.reference.id !== referenceId
  );

  if (newReferences.length === (content.references?.length || 0)) {
    const refIds = (content.references || []).map(r => r.reference.id);
    throw new Error(`Reference ${referenceId} not found in report. Current references: [${refIds.join(', ')}]`);
  }

  return { references: newReferences };
}

function handleUpdateReference(
  content: ReportContent,
  referenceId: number,
  prompt: string
): Partial<ReportContent> {
  if (!referenceId || !prompt) {
    throw new Error('reference_id and prompt are required for update_reference operation');
  }

  const refIndex = (content.references || []).findIndex(
    r => r.reference.id === referenceId
  );

  if (refIndex === -1) {
    const refIds = (content.references || []).map(r => r.reference.id);
    throw new Error(`Reference ${referenceId} not found in report. Current references: [${refIds.join(', ')}]`);
  }

  const newReferences = [...(content.references || [])];
  newReferences[refIndex] = {
    ...newReferences[refIndex],
    prompt
  };

  return { references: newReferences };
}

function handleUpdateReportPrompt(
  _content: ReportContent,
  reportPrompt: string
): Partial<ReportContent> {
  if (!reportPrompt) {
    throw new Error('report_prompt is required for update_report_prompt operation');
  }
  return { reportPrompt };
}

function handleUpdateEmails(
  _content: ReportContent,
  emails: string[]
): Partial<ReportContent> {
  if (!emails || !Array.isArray(emails)) {
    throw new Error('emails array is required for update_emails operation');
  }
  return { emails };
}

/**
 * EditAlert - Edit alert configuration (question, condition, schedule)
 */
registerFrontendTool('EditAlert', async (args, context) => {
  const { dispatch, state, userInputs } = context;

  let { operation, file_id, schedule, question_id, condition, emails } = args;

  if (operation === undefined || file_id === undefined || !dispatch) {
    return {
      success: false,
      error: 'Missing operation or file_id argument'
    };
  }

  // Check if user confirmation is required
  const askForConfirmation = state?.ui?.askForConfirmation ?? false;

  if (askForConfirmation) {
    const userConfirmed = userInputs?.[0]?.result;

    if (userConfirmed === undefined) {
      const opDescriptions: Record<string, string> = {
        'update_schedule': 'update alert schedule',
        'update_question': `set monitored question to #${question_id}`,
        'update_condition': 'update alert condition',
        'update_emails': 'update delivery emails',
      };
      const description = opDescriptions[operation] || `perform "${operation}"`;

      throw new UserInputException({
        type: 'confirmation',
        title: 'Edit alert?',
        message: `Do you want to ${description}?`,
        confirmText: 'Yes',
        cancelText: 'No'
      });
    }

    if (userConfirmed === false) {
      return {
        success: false,
        message: 'Alert edit cancelled by user'
      };
    }
  }

  // Parse schedule/condition if JSON strings
  if (typeof schedule === 'string' && schedule) {
    try { schedule = JSON.parse(schedule); } catch {}
  }
  if (typeof condition === 'string' && condition) {
    try { condition = JSON.parse(condition); } catch {}
  }
  if (typeof question_id === 'string' && question_id) {
    question_id = parseInt(question_id, 10);
  }

  const reduxState = state || getStore().getState();
  const mergedContent = selectMergedContent(reduxState, file_id) as AlertContent;

  if (!mergedContent) {
    return {
      success: false,
      error: `Alert content not available. FileId: ${file_id}`
    };
  }

  let updates: Partial<AlertContent>;
  let resultMessage: string;

  switch (operation) {
    case 'update_schedule':
      if (!schedule?.cron || !schedule?.timezone) {
        throw new Error('schedule with cron and timezone is required');
      }
      updates = { schedule };
      resultMessage = `Updated schedule to ${schedule.cron} (${schedule.timezone})`;
      break;
    case 'update_question':
      if (!question_id) {
        throw new Error('question_id is required for update_question');
      }
      updates = { questionId: question_id };
      resultMessage = `Set monitored question to #${question_id}`;
      break;
    case 'update_condition':
      if (!condition?.selector || !condition?.function || !condition?.operator || condition?.threshold === undefined) {
        throw new Error('condition with selector, function, operator, and threshold is required');
      }
      updates = {
        condition: {
          selector: condition.selector as AlertSelector,
          function: condition.function as AlertFunction,
          operator: condition.operator as ComparisonOperator,
          threshold: Number(condition.threshold),
          ...(condition.column ? { column: condition.column } : {})
        }
      };
      resultMessage = `Updated condition: ${condition.function}(${condition.selector}${condition.column ? ', ' + condition.column : ''}) ${condition.operator} ${condition.threshold}`;
      break;
    case 'update_emails':
      if (!Array.isArray(emails)) {
        throw new Error('emails array is required for update_emails');
      }
      updates = { emails: emails.map((e: any) => String(e).trim()).filter(Boolean) };
      resultMessage = `Updated delivery emails: ${updates.emails!.join(', ') || '(none)'}`;
      break;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }

  dispatch(setEdit({
    fileId: file_id as FileId,
    edits: updates
  }));

  return {
    success: true,
    message: `Successfully executed ${operation}. ${resultMessage}`,
    updates
  };
});

// Operation handlers

function handleAddQuestion(
  content: DocumentContent,
  questionId: number,
  layoutItem?: { id: number; x: number; y: number; w: number; h: number }
): Partial<DocumentContent> {
  if (!questionId) {
    throw new Error('question_id is required for add_existing_question operation');
  }

  // Check duplicate
  const existingQuestion = content.assets.find(
    a => a.type === 'question' && a.id === questionId
  );
  if (existingQuestion) {
    throw new Error(`Question ${questionId} already exists in dashboard`);
  }

  // Add to assets
  const newAssets = [
    ...content.assets,
    { type: 'question' as const, id: questionId }
  ];

  // Handle layout
  const layout = content.layout || { columns: 12, items: [] };
  const existingLayoutItems = layout.items || [];
  const columns = layout.columns || 12;

  let newLayoutItems: any[];

  if (layoutItem) {
    // Validate
    if (layoutItem.x < 0 || layoutItem.y < 0 || layoutItem.w <= 0 || layoutItem.h <= 0) {
      throw new Error('Invalid layout coordinates: x, y must be >= 0, w and h must be > 0');
    }
    if (layoutItem.x + layoutItem.w > columns) {
      throw new Error(`Layout exceeds grid width: x(${layoutItem.x}) + w(${layoutItem.w}) = ${layoutItem.x + layoutItem.w} > ${columns} columns`);
    }

    // Create new array with provided layout
    newLayoutItems = [
      ...existingLayoutItems,
      {
        id: questionId.toString(),  // Use string ID like DashboardView
        x: layoutItem.x,
        y: layoutItem.y,
        w: layoutItem.w,
        h: layoutItem.h
      }
    ];
  } else {
    // Auto-generate: place at bottom
    const maxY = existingLayoutItems.length > 0
      ? Math.max(...existingLayoutItems.map((item: any) => item.y + item.h))
      : 0;

    // Create new array with auto-generated layout
    newLayoutItems = [
      ...existingLayoutItems,
      {
        id: questionId.toString(),  // Use string ID like DashboardView
        x: 0,
        y: maxY,
        w: 6,  // Half width
        h: 6   // Default height
      }
    ];
  }

  return {
    assets: newAssets,
    layout: { ...layout, items: newLayoutItems }
  };
}

function handleRemoveQuestion(
  content: DocumentContent,
  questionId: number
): Partial<DocumentContent> {
  if (!questionId) {
    throw new Error('question_id is required for remove_question operation');
  }

  const newAssets = content.assets.filter(
    a => !(a.type === 'question' && a.id === questionId)
  );

  if (newAssets.length === content.assets.length) {
    const questionIds = content.assets
      .filter(a => a.type === 'question')
      .map(a => a.id);
    throw new Error(`Question ${questionId} not found in dashboard. Current questions: [${questionIds.join(', ')}]`);
  }

  const layout = content.layout || { columns: 12, items: [] };
  const questionIdStr = String(questionId);
  const layoutItems = (layout.items || []).filter(
    (item: any) => item.id !== questionIdStr && item.id !== questionId
  );

  return {
    assets: newAssets,
    layout: { ...layout, items: layoutItems }
  };
}

function handleUpdateLayout(
  content: DocumentContent,
  layoutItem: { id: number; x: number; y: number; w: number; h: number }
): Partial<DocumentContent> {
  if (!layoutItem || !layoutItem.id) {
    throw new Error('layout_item with id is required for update_layout operation');
  }

  const layout = content.layout || { columns: 12, items: [] };
  const layoutItems = layout.items || [];
  const columns = layout.columns || 12;

  // Validate
  if (layoutItem.x < 0 || layoutItem.y < 0 || layoutItem.w <= 0 || layoutItem.h <= 0) {
    throw new Error('Invalid layout coordinates: x, y must be >= 0, w and h must be > 0');
  }
  if (layoutItem.x + layoutItem.w > columns) {
    throw new Error(`Layout exceeds grid width: x(${layoutItem.x}) + w(${layoutItem.w}) = ${layoutItem.x + layoutItem.w} > ${columns} columns`);
  }

  const layoutItemIdStr = layoutItem.id.toString();
  const itemIndex = layoutItems.findIndex(
    (item: any) => item.id === layoutItemIdStr || item.id === layoutItem.id
  );

  if (itemIndex === -1) {
    throw new Error(`Layout item for question ${layoutItem.id} not found`);
  }

  const newLayoutItems = [...layoutItems];
  newLayoutItems[itemIndex] = {
    id: layoutItemIdStr,  // Use string ID like DashboardView
    x: layoutItem.x,
    y: layoutItem.y,
    w: layoutItem.w,
    h: layoutItem.h
  };

  return {
    layout: { ...layout, items: newLayoutItems }
  };
}

function handleAddText(
  content: DocumentContent,
  textContent: string
): Partial<DocumentContent> {
  if (!textContent) {
    throw new Error('text_content is required for add_text operation');
  }

  // Generate unique ID
  const existingTextIds = content.assets
    .filter(a => a.type === 'text' && a.id)
    .map(a => a.id as string);

  let textId = `text-${existingTextIds.length + 1}`;
  while (existingTextIds.includes(textId)) {
    textId = `text-${Date.now()}`;
  }

  const newAssets = [
    ...content.assets,
    {
      type: 'text' as const,
      id: textId,
      content: textContent
    }
  ];

  return { assets: newAssets };
}

function handleRemoveAsset(
  content: DocumentContent,
  assetId: string
): Partial<DocumentContent> {
  if (!assetId) {
    throw new Error('asset_id is required for remove_asset operation');
  }

  const newAssets = content.assets.filter(
    a => !(a.type !== 'question' && a.id === assetId)
  );

  if (newAssets.length === content.assets.length) {
    const inlineAssetIds = content.assets
      .filter(a => a.type !== 'question' && a.id)
      .map(a => a.id);
    throw new Error(`Asset ${assetId} not found in dashboard. Available inline assets: [${inlineAssetIds.join(', ')}]`);
  }

  return { assets: newAssets };
}

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
 * Handle add_new_question operation - create new question and add to dashboard
 * Also executes the query and returns results for agent visibility
 */
async function handleAddNewQuestion(
  content: DocumentContent,
  args: any,
  context: FrontendToolContext
): Promise<any> {
  const {
    questionName,
    query,
    database_name,
    vizSettings,
    description = '',
    file_id
  } = args;
  const { dispatch, state, database: contextDatabase, signal } = context;

  // Validate required parameters
  if (file_id === undefined) {
    return {
      success: false,
      message: 'file_id is required for add_new_question operation'
    };
  }
  if (!questionName || !query) {
    return {
      success: false,
      message: 'questionName and query are required for add_new_question operation'
    };
  }

  // Parse vizSettings if string
  let parsedVizSettings;
  if (typeof vizSettings === 'string') {
    try {
      parsedVizSettings = JSON.parse(vizSettings);
    } catch (e) {
      parsedVizSettings = { type: 'table' };
    }
  } else {
    parsedVizSettings = vizSettings || { type: 'table' };
  }

  // Get folder path (from dashboard or default)
  let folderPath = '/org';
  if (file_id !== undefined && state) {
    const dashboardFile = state.files.files[file_id];
    if (dashboardFile) {
      folderPath = dashboardFile.path.substring(0, dashboardFile.path.lastIndexOf('/')) || '/org';
    }
  }

  // Generate question path
  const slug = slugify(questionName);
  const questionPath = `${folderPath}/${slug}`;

  // Create question content (name in file metadata, not content)
  const questionContent: QuestionContent = {
    description: description || '',
    query: query,
    database_name: database_name || contextDatabase?.databaseName || 'default',
    vizSettings: parsedVizSettings,
    parameters: []  // Will be auto-detected on first load
  };

  try {
    // Execute file creation and query in parallel for better performance
    const [fileResult, queryResult] = await Promise.allSettled([
      // Create question file via FilesAPI
      FilesAPI.createFile({
        name: questionName,
        path: questionPath,
        type: 'question',
        content: questionContent
      }),
      // Execute SQL query to get results
      fetchWithCache('/api/query', {
        method: 'POST',
        body: JSON.stringify({
          database_name: database_name || contextDatabase?.databaseName || 'default',
          query: query,
          parameters: []  // New questions don't have parameter values yet
        }),
        signal: signal,
        cacheStrategy: API.query.execute.cache,
      })
    ]);

    // Extract query results (always include, even if file creation failed)
    let queryResults = null;
    let queryError = null;
    if (queryResult.status === 'fulfilled') {
      queryResults = queryResult.value.data || queryResult.value;
    } else {
      console.error('Failed to execute query for new question:', queryResult.reason);
      queryError = queryResult.reason?.message || 'Query execution failed';
    }

    // Check file creation (fatal if failed, but still return query info)
    if (fileResult.status === 'rejected') {
      console.error('Failed to create question:', fileResult.reason);
      return {
        success: false,
        message: `Failed to create question: ${fileResult.reason?.message || 'Unknown error'}`,
        queryResults: queryResults,  // Include query results even on file failure
        queryError: queryError
      };
    }

    // File creation succeeded - extract question data
    const json = fileResult.value;
    const newQuestion = json.data; // FilesAPI.createFile returns { data: DbFile }
    const newQuestionId = newQuestion.id;

    // Add question to Redux
    if (dispatch) {
      dispatch(setFile({
        file: newQuestion,
        references: []
      }));
    }

    // If we're on a dashboard page, automatically add question to dashboard
    if (file_id !== undefined && dispatch) {
      // Use existing handleAddQuestion logic
      try {
        const updates = handleAddQuestion(content, newQuestionId, undefined);

        // Update Redux
        dispatch(setEdit({
          fileId: file_id as FileId,
          edits: updates
        }));

        return {
          success: true,
          questionId: newQuestionId,
          message: `Created question "${questionName}" (ID: ${newQuestionId}) and added to dashboard`,
          updates,
          queryResults: queryResults,
          queryError: queryError
        };
      } catch (addError) {
        // Question created but failed to add to dashboard
        return {
          success: true,
          questionId: newQuestionId,
          message: `Created question "${questionName}" (ID: ${newQuestionId}) but failed to add to dashboard: ${addError instanceof Error ? addError.message : 'Unknown error'}`,
          queryResults: queryResults,
          queryError: queryError
        };
      }
    }

    // Question created but not on dashboard page - just return success
    return {
      success: true,
      questionId: newQuestionId,
      message: `Created question "${questionName}" (ID: ${newQuestionId})`,
      queryResults: queryResults,
      queryError: queryError
    };
  } catch (error) {
    console.error('Failed to create question:', error);
    return {
      success: false,
      message: `Failed to create question: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Handle update_question operation - update existing question
 */
async function handleUpdateQuestion(
  args: any,
  context: FrontendToolContext
): Promise<any> {
  const {
    question_id,
    query,
    vizSettings,
    parameters,
    questionName,
    description,
    references
  } = args;
  const { dispatch, state } = context;

  // Validate required parameters
  if (!question_id) {
    return {
      success: false,
      message: 'question_id is required for update_question operation'
    };
  }

  // Convert question_id to number if needed
  const questionId = typeof question_id === 'string' ? parseInt(question_id, 10) : question_id;

  if (!dispatch || !state) {
    return {
      success: false,
      message: 'Missing dispatch or state context'
    };
  }

  // Check if question exists
  const questionFile = state.files.files[questionId];
  if (!questionFile || questionFile.type !== 'question') {
    return {
      success: false,
      message: `Question with ID ${questionId} not found`
    };
  }

  // Build updates object (only include provided fields)
  const updates: Partial<QuestionContent> = {};

  if (query !== undefined) {
    updates.query = query;
  }

  if (vizSettings !== undefined) {
    // Parse vizSettings if string
    if (typeof vizSettings === 'string') {
      try {
        updates.vizSettings = JSON.parse(vizSettings);
      } catch (e) {
        return {
          success: false,
          message: 'Invalid vizSettings JSON format. If you do not want to provide it, don\'t pass it at all.'
        };
      }
    } else {
      updates.vizSettings = vizSettings;
    }
  }

  if (parameters !== undefined) {
    // Parse parameters if string
    if (typeof parameters === 'string') {
      try {
        updates.parameters = JSON.parse(parameters);
      } catch (e) {
        return {
          success: false,
          message: 'Invalid parameters JSON format. If you do not want to provide it, don\'t pass it at all.'
        };
      }
    } else {
      updates.parameters = parameters;
    }
  }

  if (references !== undefined) {
    // Parse references if string
    if (typeof references === 'string') {
      try {
        updates.references = JSON.parse(references);
      } catch (e) {
        return {
          success: false,
          message: 'Invalid references JSON format. If you do not want to provide it, don\'t pass it at all.'
        };
      }
    } else {
      updates.references = references;
    }

    // Validate references structure
    if (updates.references && !Array.isArray(updates.references)) {
      return {
        success: false,
        message: 'references must be an array. If you do not want to provide it, don\'t pass it at all.'
      };
    }

    // Validate each reference has required fields and follows alias pattern
    if (updates.references) {
      for (const ref of updates.references) {
        if (typeof ref.id !== 'number' || typeof ref.alias !== 'string') {
          return {
            success: false,
            message: 'Each reference must have id (number) and alias (string)'
          };
        }

        // CRITICAL: Alias must end with _<id> for uniqueness
        const expectedSuffix = `_${ref.id}`;
        if (!ref.alias.endsWith(expectedSuffix)) {
          return {
            success: false,
            message: `Invalid alias "${ref.alias}" for question ID ${ref.id}. Alias must end with "${expectedSuffix}" (e.g., "base_data${expectedSuffix}")`
          };
        }
      }
    }
  }

  // Note: questionName updates file.name (metadata), not content
  // Metadata updates require a separate API call (not implemented yet)
  if (questionName !== undefined) {
    return {
      success: false,
      message: 'Renaming questions not supported yet (requires metadata update API). If you do not want to update the name, don\'t pass questionName at all.'
    };
  }

  if (description !== undefined) {
    updates.description = description;
  }

  // If no updates provided, return early
  if (Object.keys(updates).length === 0) {
    return {
      success: false,
      message: 'No update fields provided (query, vizSettings, parameters, references, or description)'
    };
  }

  try {
    // Dispatch update to Redux (sync - updates state immediately)
    dispatch(setEdit({
      fileId: questionId as FileId,
      edits: updates
    }));

    // Get FRESH state after dispatch
    // Note: state from context is passed from chat listener and contains current Redux state
    // After setEdit, we need to get updated state - but getStore().getState() in tool context may not work
    // Use the state from context and manually merge the edits
    const currentFile = state.files.files[questionId];
    if (!currentFile || !currentFile.content) {
      return {
        success: false,
        message: `Question ${questionId} not found in state`
      };
    }

    // Manually create merged content: original content + edits we just made
    const mergedContent = {
      ...currentFile.content,
      ...updates
    } as QuestionContent;

    const freshFile = currentFile;

    if (!mergedContent || !freshFile) {
      return {
        success: false,
        message: `Failed to get merged content or file for question ${questionId}`
      };
    }

    // Determine if we should execute query
    const shouldExecuteQuery =
      updates.query !== undefined ||
      updates.parameters !== undefined ||
      updates.references !== undefined;

    // Prepare query execution promise
    const queryPromise = shouldExecuteQuery
      ? (async () => {
          // Convert parameters array to key-value object for execution
          const paramsObj = (mergedContent.parameters || []).reduce((acc: any, p: any) => {
            acc[p.name] = p.value;
            return acc;
          }, {});

          return await fetchWithCache('/api/query', {
            method: 'POST',
            body: JSON.stringify({
              database_name: mergedContent.database_name || context.database?.databaseName || 'default',
              query: mergedContent.query,
              parameters: paramsObj,
              references: mergedContent.references
            }),
            signal: context.signal,
            cacheStrategy: API.query.execute.cache,
          });
        })()
      : Promise.resolve(null); // Skip query execution if not needed

    // Extract file metadata for save (from fresh state)
    const fileName = freshFile.name;
    const filePath = freshFile.path;

    // Extract references from content using proper helper (same as useFile hook)
    const references = extractReferencesFromContent(mergedContent, 'question');

    // Parallelize file save and query execution
    const [saveResult, queryResult] = await Promise.allSettled([
      FilesAPI.saveFile(questionId, fileName, filePath, mergedContent, references),  // Save to database
      queryPromise                                                                     // Execute query (or skip)
    ]);

    // Extract query results (non-fatal if failed or skipped)
    let queryResults = null;
    let queryError = null;
    if (shouldExecuteQuery && queryResult.status === 'fulfilled' && queryResult.value) {
      queryResults = queryResult.value.data || queryResult.value;
    } else if (shouldExecuteQuery && queryResult.status === 'rejected') {
      console.error('Failed to execute updated query:', queryResult.reason);
      queryError = queryResult.reason?.message || 'Query execution failed';
    }

    // Check file save (fatal if failed, but still return query info)
    if (saveResult.status === 'rejected') {
      console.error('Failed to save question:', saveResult.reason);
      return {
        success: false,
        message: `Failed to save question: ${saveResult.reason?.message || 'Unknown error'}`,
        questionId,
        queryResults,
        queryError
      };
    }

    const updatedFields = Object.keys(updates).join(', ');
    return {
      success: true,
      message: `Updated and saved question ${questionId}: ${updatedFields}`,
      questionId,
      queryResults,
      queryError
    };
  } catch (error) {
    console.error('Failed to update question:', error);
    return {
      success: false,
      message: `Failed to update question: ${error instanceof Error ? error.message : 'Unknown error'}`,
      questionId
    };
  }
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
 * Returns compact JSON strings for LLM consumption
 */
registerFrontendTool('ReadFiles', async (args, context) => {
  const { fileIds } = args;

  // Execute with compact JSON strings
  const result = await readFilesStr(fileIds, {});

  return result;
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
      const params = (finalContent.parameters || []).reduce((acc: any, p: any) => {
        acc[p.name] = p.value ?? '';
        return acc;
      }, {} as Record<string, any>);

      await getQueryResult({
        query: finalContent.query,
        params,
        database: finalContent.database_name
      });
    }
  }

  return result;
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
      virtualId,
      message: `Created draft question "${name}" (virtualId: ${virtualId}). Add to a dashboard: EditDashboard(operation="add_existing_question", question_id=${virtualId}, file_id=<dashboardId>). Changes are staged as drafts until the user publishes.`
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
 * PublishFile - Commit changes from Redux to database
 */
registerFrontendTool('PublishFile', async (args, context) => {
  const { fileId } = args;

  // Execute (new unified API)
  const result = await publishFile({ fileId });
  if (fileId < 0 && result.id) {
    const router = getRouter();
    if (!router) {
      return {
        success: false,
        message: 'Router not available'
      };
    }
    router.push(`/f/${result.id}`)
  }

  return result;
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
