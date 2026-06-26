/**
 * Client-side tool handlers
 *
 * These tools are executed on the client side (browser) rather than the server.
 * Used for tools that require user interaction or client-specific capabilities.
 */

import { ToolCall, ToolMessage, ToolCallDetails, EditFileDetails, ClarifyDetails, DatabaseWithSchema, AugmentedFile, ContextContent, ReadFilesResult, NotebookContent, NotebookSqlCell, type FileType, type ScreenshotDetails } from '@/lib/types';
import { setEphemeral, setNotebookCellExecuted, selectMergedContent, selectDirtyFiles, selectContextFromPath, type FileId } from '@/store/filesSlice';
import { clearQueryResult, selectQueryResult } from '@/store/queryResultsSlice';
import type { AppDispatch, RootState } from '@/store/store';
import { getStore } from '@/store/store';
import type { UserInput } from './user-input-exception';
import { UserInputException } from './user-input-exception';
import { FilesAPI } from '../data/files';
import { getTemplateDefaults } from '@/lib/data/template-defaults';
import { mergeSkillsByName } from '@/lib/context/context-utils';
import { getRouter } from '@/lib/navigation/use-navigation';
import { readFiles, editFileStr, buildCurrentFileStr, getQueryResult, createDraftFile, editFile as editFileOp } from '@/lib/api/file-state';
import { getRootParams, storyEmbedRuns } from '@/lib/data/helpers/param-resolution';
import { markupToContent } from '@/lib/data/file-markup';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { compressAugmentedFile, TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS, stripAugmentedContentForLlm } from '@/lib/api/compress-augmented';
import { compressedToAugmentedFiles } from '@/lib/projection/from-compressed';
import { stripEntryQueryData, stripEntryMarkup } from '@/lib/projection/project';
import type { AugmentedToolDetails } from '@/lib/projection/messages';
import { queryPresentation } from '@/lib/chart/query-presentation';
import { takeFilesMarkup, takeAugmentedMarkup, markupTextBlocks } from '@/lib/api/markup-blocks';
import { captureFileViewBlob } from '@/lib/screenshot/capture';
import { AGENT_IMAGE_MAX_PX } from '@/lib/screenshot/constants';
import { uploadBlobOrEmbed } from '@/lib/object-store/client';
import { validateFileState } from '@/lib/validation/content-validators';
import { canCreateFileType, canCreateFileByRole } from '@/lib/auth/access-rules.client';
import { selectEffectiveUser } from '@/store/authSlice';
import { selectAppState } from '@/store/appStateSelector';
import { selectUnrestrictedMode } from '@/store/uiSlice';
import { clientChartImageRenderer } from '@/lib/chart/ChartImageRenderer.client';
import { RENDERABLE_CHART_TYPES } from '@/lib/chart/render-chart-svg';
import { uploadChartOrEmbed } from '@/lib/chart/chart-attachments';
import { getVizSettingsWarning } from '@/lib/chart/viz-constraints';
import type { VizSettings } from '@/lib/types';

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
        const url = await uploadChartOrEmbed(r.dataUrl);
        return { type: 'image_url' as const, image_url: { url } };
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
 * Resolve a user-defined Knowledge Base skill from the active conversation's
 * already-loaded context state. Shared by two tool names:
 *  - 'LoadSkillFrontend' — spawned by the server-side LoadSkill for user-defined skills
 *  - 'LoadSkill'         — v2 (the LoadSkill tool resolves system skills
 *    server-side and pauses to here for user-defined skills)
 */
const resolveUserSkillFrontend: FrontendToolHandler = async (args, context) => {
  const name = String(args.name ?? '');

  if (!name) {
    return {
      content: { success: false, error: 'name is required' },
      details: { success: false, error: 'name is required' }
    };
  }

  if (!context.state) {
    const error = `No active frontend context available to resolve user skill '${name}'`;
    return {
      content: { success: false, error },
      details: { success: false, error }
    };
  }

  if (!context.contextPath) {
    const error = `No active Knowledge Base context available to resolve user skill '${name}'`;
    return {
      content: { success: false, error },
      details: { success: false, error }
    };
  }

  const contextFile = selectContextFromPath(context.state, context.contextPath);
  const content = contextFile
    ? selectMergedContent(context.state, contextFile.id) as ContextContent | undefined
    : undefined;

  if (!content) {
    const error = `Active Knowledge Base context is not loaded for user skill '${name}'`;
    return {
      content: { success: false, error },
      details: { success: false, error }
    };
  }

  const skill = mergeSkillsByName(content.fullSkills || [], content.skills || []).find(s => s.name === name);

  if (!skill) {
    const error = `User skill '${name}' not found in the active Knowledge Base context`;
    return {
      content: { success: false, error },
      details: { success: false, error }
    };
  }

  if (!skill.enabled) {
    const error = `User skill '${skill.name}' is disabled`;
    return {
      content: { success: false, error },
      details: { success: false, error }
    };
  }

  return {
    content: {
      success: true,
      skill: skill.name,
      description: skill.description,
      content: skill.content,
    },
    details: {
      success: true,
      message: `Loaded skill ${skill.name}`,
    }
  };
};

registerFrontendTool('LoadSkillFrontend', resolveUserSkillFrontend);
registerFrontendTool('LoadSkill', resolveUserSkillFrontend);

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

    if (userConfirmed === false || userConfirmed?.declined) {
      // User cancelled — include their reason if provided
      const reason = userConfirmed?.reason;
      const msg = reason
        ? `Navigation cancelled by user. Reason: ${reason}`
        : 'Navigation cancelled by user';
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

  // Create a draft file and navigate directly to it
  if (newFileType !== undefined) {
    const canCreate = canCreateFileType(newFileType);
    if (!canCreate) {
      const msg = `You don't have permission to create ${newFileType} files`;
      return { content: { success: false, message: msg }, details: { success: false, error: msg } };
    }

    const draftId = await createDraftFile(newFileType, path ? { folder: path } : {});
    router.push(`/f/${draftId}`);
    const msg = path
      ? `Created new ${newFileType} in ${path}, navigating to /f/${draftId}`
      : `Created new ${newFileType}, navigating to /f/${draftId}`;
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
  const { fileIds, maxChars: rawMaxChars, runQueries = true, rawData = false } = args;
  const maxChars = Math.min(rawMaxChars ?? TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS);

  const result = await readFiles(fileIds, { runQueries });
  // The agent reads `markup`, not JSON `content` — strip the duplicate content, then pull the
  // JSX `markup` out into a separate raw <file_markup> block (real JSX, not escaped JSON).
  const { files: noMarkup, blocks } = takeFilesMarkup(
    result.map(f => stripAugmentedContentForLlm(compressAugmentedFile(f, maxChars))),
  );
  const textContent: ReadFilesResult = { success: true, files: noMarkup };
  const imageBlocks = await renderFileChartImageBlocks(result);
  // Rich payload for the projection pass (cross-turn diffing): the same files in the projector's
  // shape. The `content` above is kept verbatim for the chat UI; projectMessages rebuilds the
  // LLM-facing content from `__augmented` (diffed against the conversation) at send time.
  // Presentation: a question with a renderable chart viz returns the rendered IMAGE (above) + summary
  // instead of rows (unless rawData). Drop the row data facet for those files; keep it otherwise.
  const augmented: AugmentedToolDetails = {
    __augmented: result.map(f => {
      const aug = compressedToAugmentedFiles(compressAugmentedFile(f, maxChars));
      const vizType = (f.fileState.content as { vizSettings?: { type?: string } } | undefined)?.vizSettings?.type;
      if (queryPresentation(vizType, rawData) === 'image') {
        aug.file = stripEntryQueryData(aug.file);
      }
      return aug;
    }),
    __jsonTag: 'Files',
    __status: { success: true },
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(textContent) }, ...markupTextBlocks(blocks), ...imageBlocks],
    details: { success: true, ...augmented },
  };
});

// Screenshot — capture the LIVE rendered DOM of the current file as an image the agent can
// see. Frontend-only (needs the browser DOM). Reuses the shared capture core + the SAME upload
// path (S3 / base64 / local FS, per config) as the auto chart-image attachments.
registerFrontendTool('Screenshot', async (args, context) => {
  const fileId = Number(args.fileId);
  const fullHeight = !!args.fullHeight;
  const colorMode: 'light' | 'dark' = context.state?.ui?.colorMode === 'dark' ? 'dark' : 'light';
  try {
    // Yield once so the chat's "Capturing" tool state can paint before the capture runs —
    // the capture is synchronous main-thread work (DOM clone + rasterize) that briefly freezes the UI.
    await new Promise((r) => setTimeout(r, 0));
    const blob = await captureFileViewBlob(fileId, { colorMode, fullHeight, maxWidth: AGENT_IMAGE_MAX_PX, format: 'jpeg' });
    const url = await uploadBlobOrEmbed(blob, 'screenshot.jpg', 'image/jpeg');
    return {
      content: [
        { type: 'text', text: `Screenshot of file ${fileId} (rendered view).` },
        { type: 'image_url', image_url: { url } },
      ],
      // screenshotUrl rides in `details` (UI-only, survives the turn) so the chat image
      // doesn't vanish when the persisted content is reloaded in a different shape.
      details: { success: true, screenshotUrl: url } as ScreenshotDetails,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Could not capture a screenshot of file ${fileId}: ${message}` }],
      details: { success: false, error: message },
    };
  }
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

/**
 * Compute the viz-constraint warning for a question, resolving the X-axis column
 * types from the executed query result. This catches type-dependent errors (e.g.
 * "trend charts require a date X axis") that the chart renderer shows but that the
 * structural-only check misses — so the agent gets the signal and can fix the
 * chart instead of finishing with a broken widget.
 */
function vizWarningForQuestion(fileId: number): string | null {
  const mc = selectMergedContent(getStore().getState(), fileId) as
    | { vizSettings?: VizSettings; query?: string; connection_name?: string; parameterValues?: Record<string, unknown> }
    | undefined;
  if (!mc) return null;
  const qr =
    mc.query && mc.connection_name
      ? selectQueryResult(getStore().getState(), mc.query, mc.parameterValues ?? {}, mc.connection_name)
      : undefined;
  // The stored result keeps columns/types under `.data` ({ columns, types, rows }).
  const data = qr?.data as { columns?: string[]; types?: string[] } | undefined;
  return getVizSettingsWarning(mc.vizSettings, data?.columns, data?.types);
}

registerFrontendTool('EditFile', async (args, _context) => {
  const { fileId, changes, rawData = false } = args;

  // Snapshot state before edit to compute delta
  const stateBefore = getStore().getState();
  const fileState = stateBefore.files.files[fileId];

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

  // Validate all changes in memory first (atomic: no Redux writes until all pass)
  const built = buildCurrentFileStr(stateBefore, fileId);
  if (!built.success) {
    return { content: { success: false, error: built.error }, details: { success: false, error: built.error } };
  }
  let workingStr = built.fullFileStr;
  for (let i = 0; i < changes.length; i++) {
    const { oldMatch, newMatch, replaceAll } = changes[i];
    if (typeof oldMatch !== 'string' || typeof newMatch !== 'string') {
      const err = `Change ${i + 1}/${changes.length} is missing oldMatch or newMatch`;
      return { content: { success: false, error: err }, details: { success: false, error: err } };
    }
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

  // Post-edit guard: context files — only docs[] within versions can change
  if (fileState?.type === 'context') {
    const before = selectMergedContent(stateBefore, fileId) as any;
    const after = selectMergedContent(getStore().getState(), fileId) as any;

    const stripDocs = (c: any) => {
      if (!c) return c;
      const { versions, docs: _topDocs, ...rest } = c;
      return {
        ...rest,
        versions: versions?.map((v: any) => {
          const { docs: _docs, ...vRest } = v;
          return vRest;
        }),
      };
    };

    if (JSON.stringify(stripDocs(before)) !== JSON.stringify(stripDocs(after))) {
      const errorContent = {
        success: false,
        error: 'EditFile on context files can only modify docs within versions. Other fields (databases, published, evals, childPaths, etc.) cannot be changed via EditFile.',
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

      // Show loading in the viz immediately by clearing cached result and setting lastExecuted
      // before awaiting the query. Mirrors handleExecute in QuestionContainerV2.
      getStore().dispatch(clearQueryResult({ query: finalContent.query, params, database: finalContent.connection_name }));
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

      // Auto-execute is best-effort: a failed execution (e.g. no data, bad param) must NOT
      // cause EditFile to report failure. The edit was already staged successfully.
      try {
        await getQueryResult({
          query: finalContent.query,
          params,
          database: finalContent.connection_name,
          filePath: fileState?.path,
        });
      } catch (execErr) {
        console.warn('[EditFile] Auto-execute failed (edit still staged):', execErr);
      }
    }
  }

  // Auto-execute changed cells for notebooks (agent + UI see results immediately).
  // A notebook is one file holding many inline-question cells, so we diff before/after
  // to find which SQL cell(s) the edit touched and run only those — mirroring the
  // question branch but per cell, writing each cell's executed snapshot to Redux so
  // NotebookView's cell displays its result without a manual Run.
  if (fileState?.type === 'notebook') {
    const beforeContent = selectMergedContent(stateBefore, fileId) as NotebookContent | undefined;
    const afterContent = selectMergedContent(getStore().getState(), fileId) as NotebookContent | undefined;
    const beforeById = new Map<string, NotebookSqlCell>();
    for (const c of beforeContent?.cells ?? []) {
      if (c.type === 'sql') beforeById.set(c.id, c);
    }
    for (const cell of afterContent?.cells ?? []) {
      if (cell.type !== 'sql' || !cell.query || !cell.connection_name) continue;
      const params = cell.parameterValues || {};
      const prev = beforeById.get(cell.id);
      const changed = !prev
        || prev.query !== cell.query
        || prev.connection_name !== cell.connection_name
        || JSON.stringify(prev.parameterValues || {}) !== JSON.stringify(params)
        || JSON.stringify(prev.references || []) !== JSON.stringify(cell.references || []);
      if (!changed) continue;

      // Clear the cached result + record the executed snapshot before awaiting, so
      // the cell viz shows loading immediately (mirrors the question branch).
      getStore().dispatch(clearQueryResult({ query: cell.query, params, database: cell.connection_name }));
      getStore().dispatch(setNotebookCellExecuted({
        fileId: fileId as FileId,
        cellId: cell.id,
        executed: { query: cell.query, params, database: cell.connection_name, references: cell.references || [] },
      }));

      // Best-effort: a failed execution must NOT fail the edit (already staged).
      try {
        await getQueryResult({ query: cell.query, params, database: cell.connection_name, filePath: fileState?.path });
      } catch (execErr) {
        console.warn('[EditFile] Notebook cell auto-execute failed (edit still staged):', execErr);
      }
    }
  }

  // Auto-execute a story's INLINE questions + inline numbers so the agent sees their LIVE results
  // in this EditFile response (and the next app-state). The agent edited the body, so a changed
  // inline query has a NEW hash and isn't cached — without this it would come back with NO rows.
  // Saved <Question id>/<Number id> embeds resolve via references (already cached on render). Run
  // each under the SAME param key augmentWithParams uses (story root params), so the result lands
  // in the cache the response reads from. Best-effort: a failed run never fails the staged edit.
  if (fileState?.type === 'story') {
    const state = getStore().getState();
    const html = (selectMergedContent(state, fileId) as { story?: string | null } | undefined)?.story;
    const inheritedParams = getRootParams(state, fileState);
    // storyEmbedRuns is the SAME extraction the client + server augmentation use, so the params
    // (and therefore query hashes) match the cache the response reads from.
    for (const r of storyEmbedRuns(html, inheritedParams)) {
      try {
        await getQueryResult({ query: r.query, params: r.params, database: r.connection, filePath: fileState?.path });
      } catch (execErr) {
        console.warn('[EditFile] Story embed auto-execute failed (edit still staged):', execErr);
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

  // Re-read the edited file (auto-executed above) for its updated query result + metadata. The
  // projection pass diffs it against the conversation; we don't compute manual deltas here.
  const [augmented] = await readFiles([fileId], {});
  const compressed = compressAugmentedFile(augmented);

  // Check viz constraint violations (incl. type-dependent ones) to feed back to the LLM
  const vizWarning = fileState?.type === 'question' ? vizWarningForQuestion(fileId) : null;

  const diff = diffs.join('\n');

  // EditFile echoes the new query RESULT (data the agent can't derive) + a summary + diff/status, but
  // NOT the markup — the agent already knows its edit from the prior app state + the change args.
  // Result presentation matches ReadFiles/ExecuteQuery: renderable chart → image + summary (unless
  // rawData); table/number/no-viz → rows + summary. Markup facet is always stripped.
  const vizType = (augmented.fileState.content as { vizSettings?: { type?: string } } | undefined)?.vizSettings?.type;
  const showImage = queryPresentation(vizType, rawData) === 'image';
  let entry = stripEntryMarkup(compressedToAugmentedFiles(compressed).file);
  if (showImage) entry = stripEntryQueryData(entry); // image conveys the result; keep summary, drop rows

  // Render the chart image only for the image presentation AND when the result/viz actually changed.
  const queryResultChanged = compressed.queryResults.some((qr: { id?: string }) => {
    const qrId = qr.id;
    return !qrId || !prevQueryResultIds.has(qrId);
  });
  const prevVizSettings = (augmentedBefore?.fileState.content as { vizSettings?: unknown } | undefined)?.vizSettings;
  const currVizSettings = (augmented.fileState.content as { vizSettings?: unknown } | undefined)?.vizSettings;
  const vizSettingsChanged = JSON.stringify(prevVizSettings) !== JSON.stringify(currVizSettings);
  const imageBlocks = showImage && (queryResultChanged || vizSettingsChanged)
    ? await renderFileChartImageBlocks([augmented])
    : [];

  // projectMessages rebuilds the LLM-facing content from __status + __augmented (diffed query result,
  // no markup) and preserves the image block above. `content` here is kept for the chat UI.
  const status = {
    success: true,
    isDirty: true,
    ...(diff ? { diff } : {}),
    ...(sourceWarnings.length > 0 ? { sourceWarnings } : {}),
    ...(vizWarning ? { vizWarning } : {}),
    ...(result.validation?.length ? { validation: result.validation } : {}),
  };
  const augmentedDetails: AugmentedToolDetails = {
    __augmented: [{ file: entry, references: [] }],
    __jsonTag: 'Files',
    __status: status,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(status) }, ...imageBlocks],
    details: { success: true, diff, ...augmentedDetails } as EditFileDetails,
  };
});

// SetJsx / EditJsx were removed in File Architecture v2 — a document's jsx body is edited
// through EditFile (the markup's <jsx> block), like any other file.

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
  const { file_type, name } = args;
  let { path } = args;

  // The `content` arg is schema-typed `Type.Unknown`, so the LLM frequently sends
  // it as a JSON STRING. If left as a string it gets spread character-by-character
  // into the file content (producing `{ "0":"{", "1":"\n", ... }` garbage with an
  // empty `query`, while still returning success:true). Parse it to a real object
  // first. (EditFile is unaffected — it uses oldMatch/newMatch string replacement.)
  let content = args.content;
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      const err = 'CreateFile: `content` must be a JSON object (or a valid JSON string), not a raw string.';
      return { content: { success: false, error: err }, details: { success: false, error: err } };
    }
  }

  // File Architecture v2: prefer the `markup` arg — parse it into typed content (the same
  // markup EditFile edits). Merges over any structured `content` fallback.
  if (typeof args.markup === 'string' && args.markup.trim()) {
    const parsed = markupToContent(file_type as FileType, args.markup);
    if (!parsed.ok) {
      const err = `CreateFile: invalid markup for '${file_type}': ${parsed.error}`;
      return { content: { success: false, error: err }, details: { success: false, error: err } };
    }
    content = { ...((content as Record<string, unknown>) ?? {}), ...parsed.content };
  }

  // --- Page-context guards for background file creation ---
  const state = context.state ?? getStore().getState();
  const unrestrictedMode = selectUnrestrictedMode(state);
  const { appState } = state.navigation ? selectAppState(state) : { appState: null };

  if (!unrestrictedMode) {
    // Dashboards can never be created in the background
    if (file_type === 'dashboard') {
      const msg = 'Cannot create a dashboard in the background. Use the Navigate tool with new_file_type="dashboard" instead.';
      return { content: { success: false, error: msg }, details: { success: false, error: msg } };
    }

    // On a question page, don't allow creating another question in the background
    if (appState?.type === 'file' && appState.state.fileState.type === 'question' && file_type === 'question') {
      const msg = 'Cannot create a background question when on a question page. Use the Navigate tool with new_file_type="question" instead.';
      return { content: { success: false, error: msg }, details: { success: false, error: msg } };
    }

    // On the explore page, only allow question and folder creation in the background
    if (appState?.type === 'explore' && file_type !== 'question' && file_type !== 'folder') {
      const msg = `Cannot create a ${file_type} in the background from the explore page. Use the Navigate tool with new_file_type="${file_type}" instead.`;
      return { content: { success: false, error: msg }, details: { success: false, error: msg } };
    }
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
  // Normalize: collapse double slashes and strip trailing slash
  path = path.replace(/\/+/g, '/').replace(/\/$/, '');

  const draftFiles = Object.values(getStore().getState().files.files).filter(f => f.draft);
  const effectiveDraftPath = (f: { path: string; metadataChanges?: { path?: string } }) =>
    f.metadataChanges?.path || f.path;

  // Guard: the folder path must not already be a draft file's path.
  // e.g. if a dashboard already lives at /org/Getting Started, you cannot
  // also create files *inside* /org/Getting Started — a file and its containing
  // folder cannot share the same path.
  const folderConflict = draftFiles.find(f => f.type !== 'folder' && effectiveDraftPath(f) === path);
  if (folderConflict) {
    const err = `Path conflict: '${path}' is already occupied by a ${folderConflict.type} file — you cannot create files inside it. Choose a different folder.`;
    return { content: { success: false, error: err }, details: { success: false, error: err } };
  }

  // Pre-creation slug conflict check — when name is given we can compute the final
  // path upfront and detect conflicts before creating anything in DB.
  if (name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const previewPath = `${path}/${slug}`;
    for (const other of draftFiles) {
      const otherPath = effectiveDraftPath(other);
      if (previewPath === otherPath) {
        const err = `Path conflict: '${previewPath}' is already used by another virtual ${other.type} file. Use a different name or path.`;
        return { content: { success: false, error: err }, details: { success: false, error: err } };
      }
      if (other.type !== 'folder' && otherPath.startsWith(previewPath + '/')) {
        const err = `Path conflict: '${previewPath}' would be treated as a folder by existing virtual ${other.type} '${otherPath}' — but it is a file. Use a different name or path.`;
        return { content: { success: false, error: err }, details: { success: false, error: err } };
      }
    }
  }

  // Validate the would-be content (pure template defaults + override) as non-blocking
  // FEEDBACK — the file is still created with the agent's content. The shallow top-level merge
  // mirrors setEdit/selectMergedContent, so this is the exact content the save path validates.
  const createValidation: string[] = [];
  if (content && Object.keys(content).length > 0) {
    const defaults = getTemplateDefaults(file_type as FileType);
    const mergedContent = { ...(defaults ?? {}), ...content };
    const validationError = validateFileState({ type: file_type as FileType, content: mergedContent });
    // Permissive: a schema issue is non-blocking FEEDBACK, not a rejection — the file is still
    // created with the agent's content; it sees this and can fix. (Publish is the gate.)
    if (validationError) createValidation.push(validationError);
  }

  // Create draft file on server — returns real positive ID with draft:true.
  // Passing name here ensures the DB path uses the slug immediately (important
  // for folders that will be used as parents for other files in the same session).
  const draftId = await createDraftFile(file_type, { folder: path, name: name ?? undefined });
  if (content && Object.keys(content).length > 0) {
    await editFileOp({ fileId: draftId, changes: { content } });
  }

  // Auto-execute query for questions (agent sees results immediately)
  if (file_type === 'question') {
    const updatedState = getStore().getState();
    const finalContent = selectMergedContent(updatedState, draftId) as any;

    if (finalContent?.query && finalContent?.connection_name) {
      const params = finalContent.parameterValues || {};

      // Show loading in the viz immediately
      getStore().dispatch(clearQueryResult({ query: finalContent.query, params, database: finalContent.connection_name }));
      getStore().dispatch(setEphemeral({
        fileId: draftId as FileId,
        changes: {
          lastExecuted: {
            query: finalContent.query,
            params,
            database: finalContent.connection_name,
            references: finalContent.references || []
          }
        }
      }));

      try {
        await getQueryResult({
          query: finalContent.query,
          params,
          database: finalContent.connection_name,
          filePath: path,
        });
      } catch (execErr) {
        console.warn('[CreateFile] Auto-execute failed (file still created):', execErr);
      }
    }
  }

  const [augmented] = await readFiles([draftId], {});
  if (!augmented) {
    const err = `Failed to read created file (draftId: ${draftId})`;
    return { content: { success: false, error: err }, details: { success: false, error: err } };
  }

  // Check viz constraint violations (incl. type-dependent ones) to feed back to the LLM
  const vizWarning = file_type === 'question' ? vizWarningForQuestion(draftId) : null;

  // Pull the new file's JSX `markup` out of its `state` JSON → a separate raw <file_markup> block.
  const { value: stateNoMarkup, blocks: createBlocks } = takeAugmentedMarkup(compressAugmentedFile(augmented));
  const result: Record<string, any> = { success: true, state: stateNoMarkup };
  if (vizWarning) result.vizWarning = vizWarning;
  if (createValidation.length) result.validation = createValidation; // non-blocking feedback
  const imageBlocks = await renderFileChartImageBlocks([augmented]);
  // Rich payload for the projection pass (see ReadFiles/EditFile); content kept for the chat UI.
  const augmentedDetails: AugmentedToolDetails = {
    __augmented: [compressedToAugmentedFiles(compressAugmentedFile(augmented))],
    __jsonTag: 'Files',
    __status: {
      success: true,
      ...(vizWarning ? { vizWarning } : {}),
      ...(createValidation.length ? { validation: createValidation } : {}),
    },
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }, ...markupTextBlocks(createBlocks), ...imageBlocks],
    details: { success: true, ...augmentedDetails },
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
