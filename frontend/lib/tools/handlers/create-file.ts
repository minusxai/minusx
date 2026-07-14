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
import { type FileType } from '@/lib/types';
import { setEphemeral, selectMergedContent, type FileId } from '@/store/filesSlice';
import { isTitleMissing, missingTitleFeedback } from '@/lib/data/story/file-title';
import { clearQueryResult } from '@/store/queryResultsSlice';
import { getStore } from '@/store/store';
import { getTemplateDefaults } from '@/lib/data/story/template-defaults';
import { readFiles, getQueryResult, createDraftFile, editFile as editFileOp } from '@/lib/file-state/file-state';
import { markupToContent } from '@/lib/data/story/file-markup';
import { compressAugmentedFile } from '@/lib/chat/compress-augmented';
import { compressedToAugmentedFiles } from '@/lib/projection/from-compressed';
import type { AugmentedToolDetails } from '@/lib/projection/messages';
import { takeAugmentedMarkup, markupTextBlocks } from '@/lib/chat/markup-blocks';
import { validateFileState } from '@/lib/validation/content-validators';
import { canCreateFileByRole } from '@/lib/auth/access-rules.client';
import { selectEffectiveUser } from '@/store/authSlice';
import { selectAppState } from '@/store/appStateSelector';
import { selectUnrestrictedMode } from '@/store/uiSlice';
import type { FrontendToolHandler } from './types';
import { deterministicAgentRubric } from './file-review';
import { vizWarningForQuestion } from './viz-warning';

export const createFileHandler: FrontendToolHandler = async (args, context) => {
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
    // Dashboards and stories can never be created in the background: both are built
    // INTERACTIVELY — the user confirms the navigation and watches the file take shape.
    // A background CreateFile produced an invisible story the user never saw being made.
    if (file_type === 'dashboard' || file_type === 'story') {
      const msg = `Cannot create a ${file_type} in the background. Use the Navigate tool with new_file_type="${file_type}" first, then build it with EditFile on the new page.`;
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

  // Non-blocking feedback: a title-bearing file created without a real name. The file is still
  // created (drafts can be nameless); the agent is told to title it via EditFile's `name`.
  if (isTitleMissing(file_type as FileType, name)) {
    createValidation.push(missingTitleFeedback(file_type as FileType));
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
  // Rubric v2: a created file is always a BACKGROUND draft (this tool never navigates), so its
  // view isn't mounted and no screenshot/visual-judge review is possible — attach the rules-only
  // rubric. ALWAYS fix `error` findings (an error gates the score to 0); try to fix `warn`s.
  const rubric = deterministicAgentRubric(draftId);
  const result: Record<string, any> = { success: true, state: stateNoMarkup };
  if (rubric) result.rubric = rubric;
  if (vizWarning) result.vizWarning = vizWarning;
  if (createValidation.length) result.validation = createValidation; // non-blocking feedback
  // A nameless draft's path ends in a random token (DB uniqueness only) that is rewritten to the
  // name slug when the user saves — without this note the agent treats the token as a real
  // path/name, echoes it to the user, or references the file by a path that later changes.
  if (!name) {
    result.pathNote = 'This draft has no title yet, so its `path` ends in a random placeholder token. '
      + 'The path is PROVISIONAL — it is rewritten to the title slug when the user saves. '
      + 'Never show it to the user or reference the file by it; use the stable `id` (and set a title via EditFile `name`).';
  }
  // NO chart image for CreateFile: a created file is always a background draft (this tool never
  // navigates), so the agent isn't looking at it — the rows + viz settings in `state` already convey
  // the result. Attaching a rendered chart image per create was a major context-bloat source when
  // building many widgets (e.g. a 20-widget dashboard blew past the model's context window before it
  // could be assembled). If the agent later needs the visual, ReadFiles still renders one on demand.
  // Rich payload for the projection pass (see ReadFiles/EditFile); content kept for the chat UI.
  const augmentedDetails: AugmentedToolDetails = {
    __augmented: [compressedToAugmentedFiles(compressAugmentedFile(augmented))],
    __jsonTag: 'Files',
    __status: {
      success: true,
      ...(rubric ? { rubric } : {}),
      ...(vizWarning ? { vizWarning } : {}),
      ...(createValidation.length ? { validation: createValidation } : {}),
    },
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }, ...markupTextBlocks(createBlocks)],
    details: { success: true, ...augmentedDetails },
  };
};
