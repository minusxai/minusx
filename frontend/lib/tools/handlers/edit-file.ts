/**
 * EditFile - String-based editing for native toolset
 * Routes to editFileStr for string find-and-replace with oldMatch/newMatch parameters.
 *
 * Returns a delta response: full data for changed parts, stubs for unchanged ones.
 * - fileState: always full (the edited file always changes)
 * - references: {id, unchanged: true} for pre-existing refs; full for new ones
 * - queryResults: {queryResultId, unchanged: true} for results with same hash; full for new/changed
 */
import type { EditFileDetails, NotebookContent, NotebookSqlCell } from '@/lib/types';
import { setEphemeral, setNotebookCellExecuted, selectMergedContent, selectEffectiveName, type FileId } from '@/store/filesSlice';
import { isTitleMissing, missingTitleFeedback } from '@/lib/data/story/file-title';
import { contextEditWithinBounds } from '@/lib/context/context-agent-view';
import { clearQueryResult } from '@/store/queryResultsSlice';
import { getStore } from '@/store/store';
import { readFiles, editFileStr, buildCurrentFileStr, getQueryResult, editFile as editFileOp } from '@/lib/file-state/file-state';
import { getRootParams, storyEmbedRuns } from '@/lib/data/helpers/param-resolution';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { compressAugmentedFile } from '@/lib/chat/compress-augmented';
import { compressedToAugmentedFiles } from '@/lib/projection/from-compressed';
import { stripEntryQueryData, stripEntryMarkup } from '@/lib/projection/project';
import type { AugmentedToolDetails } from '@/lib/projection/messages';
import { isImageViz, shouldDropRows } from '@/lib/chart/query-presentation';
import { canCreateFileByRole } from '@/lib/auth/access-rules.client';
import { selectEffectiveUser } from '@/store/authSlice';
import type { FrontendToolHandler } from './types';
import { renderFileChartImageBlocks } from './chart-images';
import { deterministicAgentRubric, reviewFile } from './file-review';
import { vizWarningForQuestion } from './viz-warning';

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

export const editFileHandler: FrontendToolHandler = async (args, context) => {
  const { fileId, changes = [], rawData = false } = args;
  // Optional rename: a file's TITLE is its `name` metadata, never part of the markup, so this is
  // the only way the agent can title a file.
  const renameTo = typeof args.name === 'string' ? args.name.trim() : undefined;

  if (changes.length === 0 && renameTo === undefined) {
    const err = 'EditFile requires `changes` (markup edits) and/or `name` (to set the title).';
    return { content: { success: false, error: err }, details: { success: false, error: err } };
  }

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

  // All markup changes validated + applied as a single atomic replace. Skipped entirely for a
  // rename-only edit (no `changes`), so it doesn't dirty the markup or re-run queries needlessly.
  const diffs: string[] = [];
  const autoCorrections: string[] = [];
  let editValidation: string[] | undefined;
  let editNormalized = false;
  if (changes.length > 0) {
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
      let effectiveOld = workingStr.includes(oldMatch) ? oldMatch : normalizedOld;
      const effectiveNew = oldMatch === effectiveOld ? newMatch : normalizedNew;
      // Auto-fix: when oldMatch is just a bare opening tag "<tagname>" and newMatch includes the
      // matching closing tag "</tagname>", the replacement would leave the original closing tag
      // dangling (double-close corruption → JSX parse failure). Expand effectiveOld to include
      // the current element content up to (and including) the first matching closing tag, and
      // report the correction so the model learns the correct full-element pattern.
      const bareOpenTagM = effectiveOld.match(/^<([a-zA-Z][\w-]*)>$/);
      if (bareOpenTagM) {
        const closingTag = `</${bareOpenTagM[1]}>`;
        if ((effectiveNew.includes(closingTag) || normalizedNew.includes(closingTag)) && workingStr.includes(effectiveOld)) {
          const openIdx = workingStr.indexOf(effectiveOld);
          const closeIdx = openIdx !== -1 ? workingStr.indexOf(closingTag, openIdx) : -1;
          if (closeIdx !== -1) {
            const expanded = workingStr.slice(openIdx, closeIdx + closingTag.length);
            autoCorrections.push(
              `Change ${i + 1}: oldMatch "${oldMatch}" is a bare opening tag — auto-expanded to "${expanded}" ` +
              `(use the full element as oldMatch to avoid duplicate closing tags)`
            );
            effectiveOld = expanded;
          }
        }
      }
      if (!workingStr.includes(effectiveOld)) {
        const err = `String "${oldMatch}" not found in file`;
        // The agent matches against its app-state markup, a TURN-START snapshot that goes stale
        // after any earlier successful EditFile this turn. Return the file's CURRENT markup so the
        // next attempt can rebuild oldMatch from truth instead of retrying blind (or burning a
        // ReadFiles round-trip). Edits are atomic — nothing before failedIndex was applied — so
        // the pre-edit markup IS the current file.
        const failureContent = {
          success: false,
          error: `Change ${i + 1}/${changes.length} failed: ${err}. No changes were applied (all changes in one EditFile call apply atomically). `
            + 'Your view of the file may be stale — the CURRENT file markup is in `currentMarkup`; rebuild oldMatch from it and retry.',
          failedIndex: i,
          currentMarkup: built.fullFileStr,
        };
        return { content: failureContent, details: { success: false, error: failureContent.error } };
      }
      workingStr = (replaceAll ?? true)
        ? workingStr.replaceAll(effectiveOld, effectiveNew)
        : workingStr.replace(effectiveOld, effectiveNew);
    }

    const result = await editFileStr({ fileId, oldMatch: built.fullFileStr, newMatch: workingStr });
    if (!result.success) {
      const err = result.error || 'Edit failed';
      return { content: { success: false, error: err }, details: { success: false, error: err } };
    }
    if (result.diff) diffs.push(result.diff);
    editValidation = result.validation;
    editNormalized = !!result.normalized;
  }

  // Apply the rename (metadata `name`) — the data layer supports `changes.name`; the agent's
  // markup surface does not, so this is the only path to (re)title a file.
  if (renameTo && renameTo !== selectEffectiveName(getStore().getState(), fileId)) {
    await editFileOp({ fileId, changes: { name: renameTo } });
    diffs.push(`Renamed to "${renameTo}"`);
  }

  // Post-edit guard: context files — the agent may edit the live version's AUTHORED knowledge fields
  // (docs, metrics, annotations) + content-level evals/skills. The whitelist, version identity, and
  // the published pointer must not change; the server-computed menus (fullSchema/parentSchema/full*)
  // are ignored (re-derived on load).
  if (fileState?.type === 'context') {
    const before = selectMergedContent(stateBefore, fileId);
    const after = selectMergedContent(getStore().getState(), fileId);
    if (!contextEditWithinBounds(before, after)) {
      const errorContent = {
        success: false,
        error: "EditFile on a context can only change docs, metrics, annotations, skills, or evals — the schema whitelist (managed in the Databases tab), version identity, and the published pointer can't be changed via EditFile.",
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
;
      if (!changed) continue;

      // Clear the cached result + record the executed snapshot before awaiting, so
      // the cell viz shows loading immediately (mirrors the question branch).
      getStore().dispatch(clearQueryResult({ query: cell.query, params, database: cell.connection_name }));
      getStore().dispatch(setNotebookCellExecuted({
        fileId: fileId as FileId,
        cellId: cell.id,
        executed: { query: cell.query, params, database: cell.connection_name },
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
    // (and therefore query hashes) match the cache the response reads from. Run the embeds in
    // PARALLEL (bounded by the shared querySemaphore) rather than serially — a story has many
    // embeds, and N × latency serialized was a big contributor to slow/"hung" story edits. Each
    // getQueryResult is bounded by QUERY_TIMEOUT_MS and honors the conversation's Stop signal.
    // Best-effort: a failed/timed-out run never fails the staged edit.
    await Promise.all(storyEmbedRuns(html, inheritedParams).map(r =>
      getQueryResult(
        { query: r.query, params: r.params, database: r.connection, filePath: fileState?.path },
        { signal: context.signal },
      ).catch(execErr => {
        console.warn('[EditFile] Story embed auto-execute failed (edit still staged):', execErr);
      }),
    ));
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
  // Result presentation matches ReadFiles/ExecuteQuery: a renderable chart returns the IMAGE
  // regardless of rawData (the image is additive); rawData ADDITIONALLY keeps the rows. table/number/
  // no-viz → rows + summary. Markup facet is always stripped.
  const vizType = (augmented.fileState.content as { vizSettings?: { type?: string } } | undefined)?.vizSettings?.type;
  const showImage = isImageViz(vizType);

  // Rubric v2: every successful EditFile returns the file's health review — a screenshot of the
  // live rendered view + the FULL rubric (deterministic + LLM visual judge + score) when the
  // file's view is mounted, degrading to the rules-only rubric for background edits. Best-effort:
  // a review failure never fails the staged edit. `review: false` skips the expensive
  // capture+judge round (intermediate edits of a batch) — the free rules-based rubric stays.
  const colorMode: 'light' | 'dark' = context.state?.ui?.colorMode === 'dark' ? 'dark' : 'light';
  const review = args.review !== false
    ? await reviewFile(fileId, { colorMode, fullHeight: true })
    : { rubric: deterministicAgentRubric(fileId), screenshotUrl: undefined, reviewMode: 'deterministic' as const };

  // Render the chart image only for the image presentation AND when the result/viz actually changed.
  const queryResultChanged = compressed.queryResults.some((qr: { id?: string }) => {
    const qrId = qr.id;
    return !qrId || !prevQueryResultIds.has(qrId);
  });
  const prevVizSettings = (augmentedBefore?.fileState.content as { vizSettings?: unknown } | undefined)?.vizSettings;
  const currVizSettings = (augmented.fileState.content as { vizSettings?: unknown } | undefined)?.vizSettings;
  const vizSettingsChanged = JSON.stringify(prevVizSettings) !== JSON.stringify(currVizSettings);
  // When a full-view screenshot was captured it already shows the rendered chart — skip the
  // separate chart image so the response doesn't carry two pictures of the same thing.
  const imageBlocks = !review.screenshotUrl && showImage && (queryResultChanged || vizSettingsChanged)
    ? await renderFileChartImageBlocks([augmented])
    : [];

  // Drop the rows ONLY when an image actually conveys the result: either a fresh image was rendered,
  // or it's an image-presented question whose result is unchanged (so the chart image was already
  // sent in app state / a prior turn — the projection dedups rows either way). If no image exists
  // (render failed / no rows), keep the rows so the agent is never left with neither image nor data.
  let entry = stripEntryMarkup(compressedToAugmentedFiles(compressed).file);
  if (shouldDropRows({ imagePresentation: showImage, imageRendered: imageBlocks.length > 0, resultUnchanged: !queryResultChanged && !vizSettingsChanged, rawData })) {
    entry = stripEntryQueryData(entry); // keep summary, drop rows
  }

  // projectMessages rebuilds the LLM-facing content from __status + __augmented (diffed query result,
  // no markup) and preserves the image block above. `content` here is kept for the chat UI.
  // Nudge the agent while a title-bearing file is still untitled (the title is metadata, not in the
  // markup, so it's easy to forget) — point it at EditFile's `name`.
  const titleWarning = fileState?.type && isTitleMissing(fileState.type, selectEffectiveName(getStore().getState(), fileId))
    ? missingTitleFeedback(fileState.type)
    : null;
  const status = {
    success: true,
    isDirty: true,
    ...(diff ? { diff } : {}),
    // The stored text differs from the newMatch you sent (whitespace/escaping normalization).
    // Future oldMatch strings must be built from the diff's `+` lines, not from memory.
    ...(editNormalized ? { editNote: 'Applied text was normalized on save — the diff above shows the EXACT stored form; build future oldMatch strings from it, not from the newMatch you sent.' } : {}),
    ...(sourceWarnings.length > 0 ? { sourceWarnings } : {}),
    ...(vizWarning ? { vizWarning } : {}),
    ...(titleWarning ? { titleWarning } : {}),
    ...(editValidation?.length ? { validation: editValidation } : {}),
    ...(autoCorrections.length > 0 ? { autoCorrections } : {}),
    // The health rubric for the edited file. ALWAYS fix `error` findings (an error gates the
    // score to 0); try to fix `warn` findings. Full (screenshot + rules + visual judge) when
    // the view was captured; rules-only otherwise.
    ...(review.rubric ? { rubric: review.rubric } : {}),
  };
  const augmentedDetails: AugmentedToolDetails = {
    __augmented: [{ file: entry, references: [] }],
    __jsonTag: 'Files',
    __status: status,
  };
  const screenshotBlocks = review.screenshotUrl
    ? [{ type: 'image_url', image_url: { url: review.screenshotUrl } }]
    : [];
  return {
    content: [{ type: 'text', text: JSON.stringify(status) }, ...imageBlocks, ...screenshotBlocks],
    details: { success: true, diff, screenshotUrl: review.screenshotUrl, ...augmentedDetails } as EditFileDetails,
  };
};

// SetJsx / EditJsx were removed in File Architecture v2 — a document's jsx body is edited
// through EditFile (the markup's <jsx> block), like any other file.
