/**
 * Client-side tool handlers
 *
 * These tools are executed on the client side (browser) rather than the server.
 * Used for tools that require user interaction or client-specific capabilities.
 */

import { ToolCall, ToolMessage, ToolCallDetails, EditFileDetails, ClarifyDetails, DatabaseWithSchema, AugmentedFile } from '@/lib/types';
import { setEphemeral, selectMergedContent, selectDirtyFiles, generateVirtualId, type FileId } from '@/store/filesSlice';
import type { AppDispatch, RootState } from '@/store/store';
import { getStore } from '@/store/store';
import type { UserInput } from './user-input-exception';
import { UserInputException } from './user-input-exception';
import { FilesAPI } from '../data/files';
import { getRouter } from '@/lib/navigation/use-navigation';
import { readFiles, editFileStr, buildCurrentFileStr, getQueryResult, createVirtualFile, editFile as editFileOp } from '@/lib/api/file-state';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { compressAugmentedFile, TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { validateFileState } from '@/lib/validation/content-validators';
import { canCreateFileType, canCreateFileByRole } from '@/lib/auth/access-rules.client';
import { selectEffectiveUser } from '@/store/authSlice';
import { selectAppState } from '@/store/appStateSelector';
import { clientChartImageRenderer } from '@/lib/chart/ChartImageRenderer.client';
import { RENDERABLE_CHART_TYPES } from '@/lib/chart/render-chart-svg';
import { uploadFile } from '@/lib/object-store/client';

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
    content: Array.isArray(result.content)
      ? result.content
      : typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
    details: result.details
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Render chart images for question files and upload to S3.
 * Returns image_url content blocks (OpenAI format — LiteLLM converts to Anthropic).
 * Browser-only. Never throws — returns [] on any failure.
 */
async function renderFileChartImageBlocks(
  files: AugmentedFile[],
): Promise<{ type: 'image_url'; image_url: { url: string } }[]> {
  if (typeof document === 'undefined') return [];
  const colorMode: 'light' | 'dark' =
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

  const entries = files.flatMap(f => {
    const vizType = (f.fileState.content as any)?.vizSettings?.type;
    const qr = f.queryResults?.[0];
    if (!qr || !RENDERABLE_CHART_TYPES.has(vizType)) return [];
    return [{ queryResult: qr, vizSettings: (f.fileState.content as any).vizSettings, titleOverride: f.fileState.name }];
  });
  if (entries.length === 0) return [];

  try {
    const rendered = await clientChartImageRenderer.renderCharts(entries, {
      width: 512, colorMode, addWatermark: false, padding: false,
    });
    const blocks = await Promise.all(
      rendered.map(async r => {
        if (!r) return null;
        const blob = await fetch(r.dataUrl).then(res => res.blob());
        const chartFile = new File([blob], 'chart.jpg', { type: 'image/jpeg' });
        const { publicUrl } = await uploadFile(chartFile, undefined, { keyType: 'charts' });
        return { type: 'image_url' as const, image_url: { url: publicUrl } };
      })
    );
    return blocks.filter(Boolean) as { type: 'image_url'; image_url: { url: string } }[];
  } catch {
    return [];
  }
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

    const virtualFileId = generateVirtualId();

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
  const { fileIds, maxChars: rawMaxChars, runQueries = true } = args;
  const maxChars = Math.min(rawMaxChars ?? TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS);

  const result = await readFiles(fileIds, { runQueries });
  const textContent = { success: true, files: result.map(f => compressAugmentedFile(f, maxChars)) };
  const imageBlocks = await renderFileChartImageBlocks(result);
  if (imageBlocks.length === 0) {
    return { content: textContent, details: { success: true } };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(textContent) }, ...imageBlocks],
    details: { success: true },
  };
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
/**
 * Checks whether any parameter's source changed and, if so, verifies the referenced
 * column exists in the source question's inferred output. Best-effort: returns an
 * empty array on any inference failure.
 */
async function validateParameterSources(
  paramsBefore: any[] | undefined,
  paramsAfter: any[] | undefined,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const param of paramsAfter ?? []) {
    if (!param.source || param.source.type !== 'question' || !param.source.column) continue;
    const prev = (paramsBefore ?? []).find((p: any) => p.name === param.name);
    const changed = !prev?.source
      || prev.source.id !== param.source.id
      || prev.source.column !== param.source.column;
    if (!changed) continue;

    try {
      const res = await fetch('/api/infer-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: param.source.id }),
      });
      const data = await res.json();
      const cols: string[] = (data.columns ?? []).map((c: any) => c.name);
      if (cols.length > 0 && !cols.includes(param.source.column)) {
        warnings.push(
          `Parameter "${param.name}" source column "${param.source.column}" was not found in question ${param.source.id}. ` +
          `Available columns: ${cols.join(', ')}`
        );
      }
    } catch {
      // Inference failure is non-fatal — skip warning
    }
  }
  return warnings;
}

registerFrontendTool('EditFile', async (args, _context) => {
  const { fileId, changes } = args;

  // Snapshot state before edit to compute delta
  const stateBefore = getStore().getState();
  const fileState = stateBefore.files.files[fileId];

  // Guard: context files — must be on the context page, and only docs[].content can change
  if (fileState?.type === 'context') {
    const state = _context.state ?? stateBefore;
    const { appState } = state.navigation ? selectAppState(state) : { appState: null };
    const currentFileId = appState?.type === 'file' ? appState.state.fileState.id : null;
    if (currentFileId != fileId) { // eslint-disable-line eqeqeq -- fileId may be string from tool args
      const errorContent = {
        success: false,
        error: 'Context files can only be edited when the user is on the context page. Navigate to the context file first.',
      };
      return { content: errorContent, details: { success: false, error: errorContent.error } };
    }
  }

  // Guard: check edit permission for this file type (same rule as create — createTypes gates both)
  if (fileState?.type) {
    const user = selectEffectiveUser(stateBefore);
    if (user && !canCreateFileByRole(user.role, fileState.type)) {
      const errorMsg = `This ${fileState.type} is read-only. Your role (${user.role}) does not have permission to edit ${fileState.type} files.`;
      return { content: { success: false, error: errorMsg }, details: { success: false, error: errorMsg } };
    }
  }

  const [augmentedBefore] = selectAugmentedFiles(stateBefore, [fileId]) ?? [];
  const prevQueryResultIds = new Set<string>(
    (augmentedBefore?.queryResults ?? []).map((qr: any) => qr.id).filter(Boolean)
  );
  const prevRefIds = new Set<number>(fileState?.references ?? []);

  // Validate all changes in memory first (atomic: no Redux writes until all pass)
  const built = buildCurrentFileStr(stateBefore, fileId);
  if (!built.success) {
    return { content: { success: false, error: built.error }, details: { success: false, error: built.error } };
  }
  let workingStr = built.fullFileStr;
  for (let i = 0; i < changes.length; i++) {
    const { oldMatch, newMatch, replaceAll } = changes[i];
    // Mirror editFileStr's \n normalization
    const normalizedOld = oldMatch.includes('\\n') ? oldMatch.replace(/\\n/g, '\n') : oldMatch;
    const normalizedNew = newMatch.includes('\\n') ? newMatch.replace(/\\n/g, '\n') : newMatch;
    const effectiveOld = workingStr.includes(oldMatch) ? oldMatch : normalizedOld;
    const effectiveNew = oldMatch === effectiveOld ? newMatch : normalizedNew;
    if (!workingStr.includes(effectiveOld)) {
      const err = `String "${oldMatch}" not found in file`;
      const failureContent = {
        success: false,
        error: `Change ${i + 1}/${changes.length} failed: ${err}`,
        failedIndex: i,
      };
      return { content: failureContent, details: { success: false, error: failureContent.error } };
    }
    workingStr = (replaceAll ?? true)
      ? workingStr.replaceAll(effectiveOld, effectiveNew)
      : workingStr.replace(effectiveOld, effectiveNew);
  }

  // All changes validated — dispatch as a single atomic replace
  const diffs: string[] = [];
  const result = await editFileStr({ fileId, oldMatch: built.fullFileStr, newMatch: workingStr });
  if (!result.success) {
    const err = result.error || 'Edit failed';
    return { content: { success: false, error: err }, details: { success: false, error: err } };
  }
  if (result.diff) diffs.push(result.diff);

  // Post-edit guard: context files — only docs[].content within versions can change
  if (fileState?.type === 'context') {
    const before = selectMergedContent(stateBefore, fileId) as any;
    const after = selectMergedContent(getStore().getState(), fileId) as any;

    const stripDocContent = (c: any) => {
      if (!c) return c;
      const { versions, ...rest } = c;
      return {
        ...rest,
        versions: versions?.map((v: any) => ({
          ...v,
          docs: v.docs?.map((d: any) => {
            const { content: _content, ...dRest } = d;
            return dRest;
          }),
        })),
      };
    };

    if (JSON.stringify(stripDocContent(before)) !== JSON.stringify(stripDocContent(after))) {
      const errorContent = {
        success: false,
        error: 'EditFile on context files can only modify doc content text (docs[].content within versions). Other fields (databases, published, evals, childPaths, draft, etc.) cannot be changed via EditFile.',
      };
      return { content: errorContent, details: { success: false, error: errorContent.error } };
    }
  }

  // Auto-execute query for questions (agent sees results immediately)
  if (fileState?.type === 'question') {
    const updatedState = getStore().getState();
    const finalContent = selectMergedContent(updatedState, fileId) as any;

    if (finalContent?.query && finalContent?.connection_name) {
      const params = finalContent.parameterValues || {};

      // Auto-execute is best-effort: a failed execution (e.g. no data, bad param) must NOT
      // cause EditFile to report failure. The edit was already staged successfully.
      try {
        await getQueryResult({
          query: finalContent.query,
          params,
          database: finalContent.connection_name
        });
        // Update lastExecuted so QuestionContainerV2 displays results for the new query.
        // Without this, the component keeps showing results for the old lastExecuted query.
        getStore().dispatch(setEphemeral({
          fileId: fileId as FileId,
          changes: {
            lastExecuted: {
              query: finalContent.query,
              params,
              database: finalContent.connection_name,
              references: finalContent.references || []
            }
          }
        }));
      } catch (execErr) {
        console.warn('[EditFile] Auto-execute failed (edit still staged):', execErr);
      }
    }
  }

  // Validate parameter source changes (best-effort — never blocks the edit)
  const sourceWarnings = fileState?.type === 'question'
    ? await validateParameterSources(
        (selectMergedContent(stateBefore, fileId) as any)?.parameters,
        (selectMergedContent(getStore().getState(), fileId) as any)?.parameters,
      )
    : [];

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

  const diff = diffs.join('\n');
  const content: Record<string, any> = {
    success: true,
    fileState: compressed.fileState,
    references: deltaReferences,
    queryResults: deltaQueryResults,
    ...(sourceWarnings.length > 0 ? { sourceWarnings } : {}),
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
registerFrontendTool('CreateFile', async (args, context) => {
  const { file_type, name, content } = args;
  let { path } = args;

  // --- Page-context guards for background file creation ---
  const state = context.state ?? getStore().getState();
  const { appState } = state.navigation ? selectAppState(state) : { appState: null };

  // Dashboards can never be created in the background
  if (file_type === 'dashboard') {
    const msg = 'Cannot create a dashboard in the background. Navigate to /new/dashboard instead.';
    return { content: { success: false, error: msg }, details: { success: false, error: msg } };
  }

  // On a question page, don't allow creating another question in the background
  if (appState?.type === 'file' && appState.state.fileState.type === 'question' && file_type === 'question') {
    const msg = 'Cannot create a background question when on a question page. Navigate to /new/question instead.';
    return { content: { success: false, error: msg }, details: { success: false, error: msg } };
  }

  // On the explore page, only allow question and folder creation in the background
  if (appState?.type === 'explore' && file_type !== 'question' && file_type !== 'folder') {
    const msg = `Cannot create a ${file_type} in the background from the explore page. Navigate to /new/${file_type} instead.`;
    return { content: { success: false, error: msg }, details: { success: false, error: msg } };
  }

  // Guard: check create permission for this file type by role
  const createUser = selectEffectiveUser(getStore().getState());
  if (createUser && !canCreateFileByRole(createUser.role, file_type)) {
    const errorMsg = `Your role (${createUser.role}) does not have permission to create ${file_type} files.`;
    return { content: { success: false, error: errorMsg }, details: { success: false, error: errorMsg } };
  }

  // Default empty/root path to the current mode root (e.g. /org, /tutorial)
  if (!path || path === '/') {
    const mode = getStore().getState().auth.user?.mode ?? 'org';
    path = `/${mode}`;
  }

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

  // Auto-execute query for questions (agent sees results immediately)
  if (file_type === 'question') {
    const updatedState = getStore().getState();
    const finalContent = selectMergedContent(updatedState, virtualId) as any;

    if (finalContent?.query && finalContent?.connection_name) {
      const params = finalContent.parameterValues || {};

      try {
        await getQueryResult({
          query: finalContent.query,
          params,
          database: finalContent.connection_name
        });
        getStore().dispatch(setEphemeral({
          fileId: virtualId as FileId,
          changes: {
            lastExecuted: {
              query: finalContent.query,
              params,
              database: finalContent.connection_name,
              references: finalContent.references || []
            }
          }
        }));
      } catch (execErr) {
        console.warn('[CreateFile] Auto-execute failed (file still created):', execErr);
      }
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

