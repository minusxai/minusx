/**
 * Edit operations — the 5 variants for staging in-memory changes to a file
 * (not saved to the database until PublishFile/publishAll is called):
 *
 * - editFile: partial deep-merge edit (content/name/path)
 * - editFileStr: string find/replace over the file's full MARKUP representation
 * - replaceFileState: replace the entire file via editFileStr (diff-line apply)
 * - applyJsonContentEdit: full-content replace from the JSON editor view
 * - applyStoryHtmlEdit: merge new story HTML (contenteditable) into content
 */

import { getStore } from '@/store/store';
import { selectFile, selectMergedContent, setEdit, setFullContent, setMetadataEdit, selectEffectiveName, setEphemeral, type FileId } from '@/store/filesSlice';
import { deepMerge, generateDiff } from '@/lib/file-state/shared';
import { fileToMarkup, markupToContent } from '@/lib/data/story/file-markup';
import { shapeContextForAgent, foldContextAgentView } from '@/lib/context/context-agent-view';
import { extractStoryParams, lintStoryParams, lintDashboardParams, lintStoryParamSources, type EmbeddedQuestion } from '@/lib/data/story/story-params';
import { extractSavedQuestionIds, extractInlineQuestions } from '@/lib/data/story/story-question';
import { paramTypeMap, buildQueryParamValues } from '@/lib/sql/sql-params';
import type { FileState, FileType, DbFile, QuestionContent } from '@/lib/types';
import { validateFileState } from '@/lib/validation/content-validators';
import { getQueryResult } from '@/lib/file-state/query-results';

/**
 * Options for editFile
 */
export interface EditFileOptions {
  fileId: number;
  changes: {
    name?: string;
    path?: string;
    content?: Partial<DbFile['content']>;  // Allow partial content updates
  };
}

/**
 * EditFile - Apply changes to a file with deep merge
 *
 * Accepts partial file changes (name, path, content) and deep merges them.
 * Stores changes in persistableChanges/metadataChanges (doesn't save to database).
 * Auto-executes query for question files.
 *
 * @param options - File ID and changes
 */
export async function editFile(options: EditFileOptions): Promise<void> {
  const { fileId, changes } = options;
  const state = getStore().getState();

  // Validate file exists
  const fileState = selectFile(state, fileId);
  if (!fileState) {
    throw new Error(`File ${fileId} not found`);
  }

  // Handle metadata changes (name, path)
  if (changes.name !== undefined || changes.path !== undefined) {
    getStore().dispatch(setMetadataEdit({
      fileId,
      changes: {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.path !== undefined && { path: changes.path })
      }
    }));
  }

  // Handle content changes
  if (changes.content !== undefined) {
    // Deep merge with existing persistableChanges (NOT full content!)
    // This way we only store the changes, not the full merged content
    const currentPersistableChanges = state.files.files[fileId].persistableChanges || {};
    const mergedChanges = deepMerge(currentPersistableChanges, changes.content);

    // Store ONLY changes in persistableChanges
    getStore().dispatch(setEdit({
      fileId,
      edits: mergedChanges
    }));

    // NOTE: Removed auto-execute for questions (Phase 3: explicit execute pattern)
    // Queries should only execute when user clicks Run button (handleExecute)
    // Not on every edit!
  }
}


/**
 * Replace a file's entire state via editFileStr (same code path as EditFile tool).
 * Also auto-executes query for question files so viz/columns update immediately.
 *
 * @param fileId - The file to replace
 * @param targetFileObj - The full file object to apply (as parsed from a diff line)
 */
export async function replaceFileState(fileId: number, targetFileObj: { name?: string; path?: string; content: any }): Promise<{ success: boolean; error?: string }> {
  const state = getStore().getState();
  const built = buildCurrentFileStr(state, fileId);
  if (!built.success) return built;

  // Replace the entire file string via editFileStr — the agent's edit surface is MARKUP.
  const targetStr = fileToMarkup(selectFile(state, fileId)!.type, targetFileObj.content);
  const result = await editFileStr({ fileId, oldMatch: built.fullFileStr, newMatch: targetStr });
  if (!result.success) return result;

  // Auto-execute query for questions (same as EditFile tool handler)
  const fileState = selectFile(state, fileId);
  if (fileState?.type === 'question') {
    const updatedState = getStore().getState();
    const finalContent = selectMergedContent(updatedState, fileId) as any;
    if (finalContent?.query && finalContent?.connection_name) {
      const types = paramTypeMap(finalContent.parameters);
      // Canonical params (effective + None-coerced) so the stored key matches the augmentation lookup.
      const params = buildQueryParamValues(finalContent.parameters ?? [], finalContent.parameterValues ?? {}, {});
      try {
        await getQueryResult({ query: finalContent.query, params, parameterTypes: types, database: finalContent.connection_name, filePath: fileState.path, fileId, fileVersion: fileState.version });
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
      } catch (err) {
        console.warn('[replaceFileState] Auto-execute failed:', err);
      }
    }
  }

  return result;
}

/**
 * Options for editFileStr (string-based editing)
 */
export interface EditFileStrOptions {
  fileId: number;
  oldMatch: string;    // String to search for
  newMatch: string;    // String to replace with
  replaceAll?: boolean; // default true: replace all occurrences; false: error if multiple found
}

/**
 * Build the full encoded file string for a file from Redux state.
 * Must match compressFileState exactly so oldMatch copied from ReadFiles/appState works verbatim.
 * Used by editFileStr and replaceFileState.
 */
export function buildCurrentFileStr(state: ReturnType<typeof getStore>['getState'] extends () => infer R ? R : never, fileId: number): { success: true; fullFileStr: string; mergedContent: any } | { success: false; error: string } {
  const fileState = selectFile(state, fileId);
  if (!fileState) {
    return { success: false, error: `File ${fileId} not found` };
  }
  const baseContent = fileState.content;
  if (!baseContent) {
    return { success: false, error: `File ${fileId} has no content` };
  }
  const mergedContent = fileState.persistableChanges && Object.keys(fileState.persistableChanges).length > 0
    ? { ...baseContent, ...fileState.persistableChanges }
    : baseContent;
  const currentName = selectEffectiveName(state, fileId) || '';
  // File Architecture v2: the agent reads + edits the file as MARKUP (jsx body for
  // documents, keyvalue→XML for structured props) — never escaped JSON. The id/name/path
  // wrapper is not part of the editable surface (EditFile targets by fileId; renames go
  // through metadata). `mergedContent` is still returned for the structured callers.
  void currentName;
  // Context: the agent reads/edits a FLAT view of the live version (shapeContextForAgent), so the
  // markup baseline here must match compressFileState's — else an oldMatch copied from app-state /
  // ReadFiles wouldn't match. `mergedContent` is still returned FULL (version-based) for the fold.
  const markupContent = fileState.type === 'context' ? shapeContextForAgent(mergedContent) : mergedContent;
  const fullFileStr = fileToMarkup(fileState.type, markupContent);
  return { success: true, fullFileStr, mergedContent };
}

/**
 * EditFileStr - String-based editing using find and replace
 *
 * Searches for oldMatch in the FULL file JSON (including name, path, type, content)
 * and replaces with newMatch. Detects what changed and updates Redux accordingly.
 * Uses string replace (replaces first occurrence only).
 * Validates JSON after edit.
 * Changes are stored in Redux but NOT saved to database until PublishFile is called.
 *
 * @param options - File ID and search/replace strings
 * @returns Success status with diff
 */
export async function editFileStr(
  options: EditFileStrOptions
): Promise<{ success: boolean; diff?: string; error?: string; validation?: string[]; normalized?: boolean }> {
  const { fileId, oldMatch, newMatch } = options;
  const state = getStore().getState();

  const built = buildCurrentFileStr(state, fileId);
  if (!built.success) return built;
  const { fullFileStr, mergedContent } = built;
  const fileState = selectFile(state, fileId)!;
  const currentName = selectEffectiveName(state, fileId) || '';

  // Normalize \n escape sequences to literal newlines (LLM sometimes outputs \\n instead of real newlines)
  const normalizedOldMatch = oldMatch.includes('\\n') ? oldMatch.replace(/\\n/g, '\n') : oldMatch;
  const normalizedNewMatch = newMatch.includes('\\n') ? newMatch.replace(/\\n/g, '\n') : newMatch;
  const effectiveOldMatch = fullFileStr.includes(oldMatch) ? oldMatch : normalizedOldMatch;
  const effectiveNewMatch = oldMatch === effectiveOldMatch ? newMatch : normalizedNewMatch;

  if (!fullFileStr.includes(effectiveOldMatch)) {
    return { success: false, error: `String "${oldMatch}" not found in file` };
  }

  const replaceAll = options.replaceAll ?? true;
  let editedStr: string;

  if (!replaceAll) {
    const count = fullFileStr.split(effectiveOldMatch).length - 1;
    if (count > 1) {
      return { success: false, error: `oldMatch found ${count} times — it is not unique. Either (a) add more surrounding context to oldMatch so it matches exactly one location, or (b) use replaceAll=true to replace all ${count} occurrences` };
    }
    editedStr = fullFileStr.replace(effectiveOldMatch, effectiveNewMatch);
  } else {
    editedStr = fullFileStr.split(effectiveOldMatch).join(effectiveNewMatch);
  }

  // File Architecture v2: the edited string is MARKUP — parse it back to typed content. A
  // PARSE failure is the only hard error (there's nothing to apply); everything else applies.
  const parsedContent = markupToContent(fileState.type, editedStr);
  if (!parsedContent.ok) {
    return { success: false, error: `Invalid ${fileState.type} after edit: ${parsedContent.error}` };
  }
  // Merge over the existing content so unedited fields (and any not surfaced in the markup
  // projection) are preserved; the markup carries the editable surface. Context is special: the
  // parsed markup is the FLAT agent view, so fold it back into the live version (versions[]/published
  // preserved) rather than spreading it over the version-based content.
  const newContent = fileState.type === 'context'
    ? foldContextAgentView(mergedContent, parsedContent.content)
    : { ...(mergedContent as Record<string, unknown>), ...parsedContent.content };
  // StoryContent no longer has an `assets` field — saved-question deps derive from the body. Drop
  // any legacy `assets` carried over from a migrated story's stored content so re-saves are clean.
  // Set to `undefined` (not `delete`): newContent becomes persistableChanges, and the save path
  // re-merges {...originalContent, ...persistableChanges} — a spread can't delete a key, but an
  // explicit `undefined` overrides it and JSON.stringify drops it on persist. (Existing unedited
  // files keep theirs harmlessly; it's inert — references come from the body.)
  if (fileState.type === 'story') (newContent as Record<string, unknown>).assets = undefined;
  void currentName;

  const contentChanged = JSON.stringify(newContent) !== JSON.stringify(mergedContent);

  // Truthful no-op guard: the find/replace altered the markup STRING but the parsed CONTENT is
  // unchanged. This is the trap behind "1 FILE EDIT" showing on a blank story — the string diff is
  // non-empty (so the UI renders an edit) yet nothing is staged, and the agent reads success and moves
  // on. Report failure so it retries against the real markup instead of hallucinating a saved change.
  if (!contentChanged && editedStr !== fullFileStr) {
    return {
      success: false,
      error: 'Edit replaced text but produced NO change to the file content — the new markup was not '
        + 'recognized as this file\'s fields (loose top-level tags are ignored; a story body must be '
        + `wrapped in <story>…</story>). Re-read the file's current markup and edit that exact structure.`,
    };
  }

  // Permissive edit: ALWAYS stage the change, and return validation as non-blocking feedback
  // (schema + story param lint). The agent iterates freely; Publish is the validation gate.
  let validation: string[] = [];
  if (contentChanged) {
    getStore().dispatch(setEdit({ fileId, edits: newContent }));
    validation = collectEditValidation(getStore().getState(), fileState, newContent);
  }

  // Diff against the CANONICAL post-edit markup, not the agent's replacement text. The round
  // trip (markup → content → markup) normalizes what the agent wrote (class-prop whitespace,
  // attribute escaping/ordering) — echoing its own text back hid that, so its next oldMatch,
  // built from memory of newMatch, missed the stored form and edits failed in a retry/rewrite
  // loop. The diff is the agent's anchor for future edits, so it must show the stored text.
  const rebuilt = buildCurrentFileStr(getStore().getState(), fileId);
  const canonicalStr = rebuilt.success ? rebuilt.fullFileStr : editedStr;
  const diff = generateDiff(fullFileStr, canonicalStr);
  const normalized = canonicalStr !== editedStr;

  return { success: true, diff, ...(normalized ? { normalized } : {}), ...(validation.length ? { validation } : {}) };
}

/**
 * Collect non-blocking validation feedback for an applied edit: the content-schema check
 * (reported as feedback, not a block) plus the story `<Param>` lint (unsatisfied / mismatched
 * params for embedded questions). Best-effort — embedded questions are read from Redux.
 */
/**
 * Resolve a story/dashboard's embedded questions to their SQL + stored params (for the param lint).
 * - Story: derived from the BODY — saved `<Question id>` embeds (resolved from Redux) plus inline
 *   `<Question query>` embeds (carried in the body). No assets field.
 * - Dashboard: the `assets` manifest (dashboards have no body).
 */
function collectEmbeddedQuestions(
  state: ReturnType<ReturnType<typeof getStore>['getState']>,
  content: Record<string, unknown>,
  type: FileType,
): EmbeddedQuestion[] {
  if (type === 'story') {
    const html = content.story as string | null | undefined;
    const saved = extractSavedQuestionIds(html)
      .map((id): EmbeddedQuestion | null => {
        const qc = selectMergedContent(state, id) as QuestionContent | undefined;
        return qc ? { id, query: qc.query ?? '', parameters: qc.parameters ?? [] } : null;
      })
      .filter((q): q is EmbeddedQuestion => q !== null);
    const inline = extractInlineQuestions(html).map((e, i): EmbeddedQuestion => ({
      id: 0, inlineIndex: i + 1, query: e.query, parameters: e.parameters ?? [],
    }));
    return [...saved, ...inline];
  }
  const assets = (content.assets as { type?: string; id?: number }[] | undefined) ?? [];
  return assets
    .filter((a) => a.type === 'question' && typeof a.id === 'number')
    .map((a): EmbeddedQuestion | null => {
      const qc = selectMergedContent(state, a.id as number) as QuestionContent | undefined;
      return qc ? { id: a.id as number, query: qc.query ?? '', parameters: qc.parameters ?? [] } : null;
    })
    .filter((q): q is EmbeddedQuestion => q !== null);
}

function collectEditValidation(state: ReturnType<ReturnType<typeof getStore>['getState']>, fileState: FileState, content: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const schemaError = validateFileState({ type: fileState.type, content, name: fileState.name, path: fileState.path });
  if (schemaError) issues.push(schemaError);
  if (fileState.type === 'story') {
    const declared = extractStoryParams(content.story as string | null | undefined);
    issues.push(...lintStoryParams(declared, collectEmbeddedQuestions(state, content, 'story')));
    issues.push(...lintStoryParamSources(declared, (id) => selectFile(state, id)?.type));
  } else if (fileState.type === 'dashboard') {
    // Dashboards auto-derive their params from embedded questions (merged by name+type). Warn
    // when two questions use the same :param name with conflicting types — auto-derive silently
    // splits them into separate filters. Non-blocking, same channel as the story lint.
    issues.push(...lintDashboardParams(collectEmbeddedQuestions(state, content, 'dashboard')));
  }
  return issues;
}

/**
 * ApplyJsonContentEdit - Full-content edit from the JSON view
 *
 * Takes the complete new content as a JSON string (what the JSON editor holds),
 * parses + validates it, and stores it via setFullContent (replace, not merge —
 * so key deletions persist on save). Changes are saved on the next PublishFile.
 */
export function applyJsonContentEdit(options: { fileId: number; jsonString: string }): { success: boolean; error?: string } {
  const { fileId, jsonString } = options;
  const state = getStore().getState();
  const fileState = selectFile(state, fileId);
  if (!fileState) {
    return { success: false, error: `File ${fileId} not found` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (error) {
    return { success: false, error: `Invalid JSON: ${error instanceof Error ? error.message : 'parse error'}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { success: false, error: 'Content must be a JSON object' };
  }

  const validationError = validateFileState({
    type: fileState.type as FileType,
    content: parsed,
    name: selectEffectiveName(state, fileId),
    path: fileState.metadataChanges?.path ?? fileState.path,
  });
  if (validationError) {
    return { success: false, error: `Invalid ${fileState.type} content: ${validationError}` };
  }

  getStore().dispatch(setFullContent({ fileId, content: parsed as DbFile['content'] }));
  return { success: true };
}

/**
 * Apply an inline (contenteditable) story edit: merge the new `story` HTML into
 * the story's current content, validate, and store it via setFullContent — the
 * same Redux path as a JSON-tab edit (marks the file dirty; Publish persists).
 */
export function applyStoryHtmlEdit(options: { fileId: number; story: string }): { success: boolean; error?: string } {
  const { fileId, story } = options;
  const state = getStore().getState();
  const fileState = selectFile(state, fileId);
  if (!fileState) {
    return { success: false, error: `File ${fileId} not found` };
  }
  const current = selectMergedContent(state, fileId);
  if (!current || typeof current !== 'object') {
    return { success: false, error: `File ${fileId} has no content to edit` };
  }
  const content = { ...(current as object), story };

  const validationError = validateFileState({
    type: fileState.type as FileType,
    content,
    name: selectEffectiveName(state, fileId),
    path: fileState.metadataChanges?.path ?? fileState.path,
  });
  if (validationError) {
    return { success: false, error: `Invalid ${fileState.type} content: ${validationError}` };
  }

  getStore().dispatch(setFullContent({ fileId, content: content as DbFile['content'] }));
  return { success: true };
}
