'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from '@chakra-ui/react';

import AgentHtml, { type NumberQueryEdit, type NumberQueryEditRequest } from '@/components/views/shared/AgentHtml';
import NumberQueryEditor from '@/components/views/story/NumberQueryEditor';
import StoryQuestionEditor from '@/components/views/story/StoryQuestionEditor';
import type { StoryParamQueryEditRequest, StoryQuestionEditRequest } from '@/components/views/shared/StoryEmbeds';
import { StoryEmptyState } from '@/components/views/shared/empty-states';
import { StoryContent, QuestionContent } from '@/lib/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { EditWithAgentSource } from '@/lib/chat/edit-with-agent';
import { applyStoryHtmlEdit } from '@/lib/file-state/file-state';
import {
  updateSavedQuestionVizInHtml, updateInlineQuestionInHtml, questionContentToInlineEmbed,
  updateSavedQuestionVizInJsx, updateInlineQuestionInJsx,
} from '@/lib/data/story/story-question';
import { updateNumberQueryInJsx } from '@/lib/data/story/story-number';
import { updateParamQueryInHtml, updateParamQueryInJsx } from '@/lib/data/story/story-params';
import { preloadStoryFonts } from '@/lib/data/story/story-fonts';
import { useStoryRebuildStability } from '@/lib/hooks/use-story-rebuild-stability';
import { STORY_W } from './ScaledStoryFrame';
import { PageMarkerDevOverlay } from './PageMarkerDevOverlay';

/**
 * Cheap stable hash of the story HTML, used to KEY (and thus remount) AgentHtml whenever the
 * RENDERED story changes — an external content change (agent edit, reload) while viewing, or
 * entering/leaving edit mode (the session counter). Remounting rebuilds the iframe cleanly instead
 * of resetting it under live portals (which crashes React's unmount).
 */
function hashStory(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

interface StoryViewProps {
  content: StoryContent;
  /** File id — enables inline visual editing (owned, non-public stories). */
  fileId?: number;
  /** Public read-only render (shared story): embedded charts hide actions + auth-gated links. */
  readOnly?: boolean;
  /** The shared header's fileEditMode for this file (selectFileEditMode), sourced by the container. */
  headerEditMode: boolean;
  /** The story file's path (selectFile), sourced by the container — schema/connection autocomplete + guest embed allowlist. */
  storyPath?: string;
  /** The story file's name (selectFile), sourced by the container — select-to-chat provenance fallback. */
  storyName?: string;
  colorMode: 'light' | 'dark';
  /** Design-system stylesheet for the rendered story (persisted or preview-compiled), sourced by the container. */
  compiledCss?: string | null;
  /** DEV-ONLY: overlay the app-state screenshot's position markers on the live view (sourced from
   *  devMode by the container). Never shown to end users; mounts OUTSIDE the captured subtree. */
  showDevMarkers?: boolean;
}

/**
 * Story view: a single-page scrolling story — one agent-authored, fluid HTML document with live
 * chart embeds. Editing is driven by the SHARED file
 * header's Edit/Save/Cancel (the file's `fileEditMode`), exactly like questions/dashboards — there is
 * no story-specific Edit button. While editing, inline edits stream into the file's dirty content via
 * `onChange` (so the header's Save persists them and Cancel reverts them); the html is frozen during
 * the session so the iframe doesn't rebuild mid-edit.
 */
export default function StoryView({ content, fileId, readOnly = false, headerEditMode, storyPath, storyName, colorMode, compiledCss, showDevMarkers = false }: StoryViewProps) {
  const numericId = typeof fileId === 'number' ? fileId : undefined;
  // New-format story (Story_Design_V2 §2): content.story holds JSX source, rendered through the
  // lib/story-ui interpreter (AgentHtml format="jsx"); anything else is the legacy HTML path.
  const storyFormat = content.format === 'jsx' ? ('jsx' as const) : undefined;
  const canEdit = !readOnly && numericId !== undefined;
  // WYSIWYG editing works on both paths: legacy HTML edits serialize from the DOM
  // (serializeEditedStory); jsx stories commit by AST write-back (applyDomEditsToJsx via
  // AgentHtml/StoryJsxBody) — the onChange contract is identical either way.
  const editing = canEdit && headerEditMode;

  // Story-local SQL editing (<Number> queries + query-backed <Param> option sources) opens the
  // full SqlEditor in a light-DOM modal (Monaco can't live in the story iframe). The story's path
  // feeds schema/connection autocomplete.
  const [numberEdit, setNumberEdit] = useState<NumberQueryEdit | null>(null);
  // Jsx-path number requests carry an AST path instead of an apply closure (the legacy path's
  // apply writes the placeholder's DOM attribute) — normalize by binding the source write-back
  // here, so the editor modal always receives an applyable request.
  const onEditNumber = useCallback((req: NumberQueryEditRequest) => {
    if ('apply' in req) {
      setNumberEdit(req);
      return;
    }
    setNumberEdit({
      query: req.query,
      connection: req.connection,
      apply: (newQuery) => {
        if (numericId === undefined) return;
        applyStoryHtmlEdit({ fileId: numericId, story: updateNumberQueryInJsx(content.story ?? '', req.astPath, newQuery) });
      },
    });
  }, [numericId, content.story]);
  const onEditParamQuery = useCallback((req: StoryParamQueryEditRequest) => {
    setNumberEdit({
      query: req.query,
      connection: req.connection,
      editorTitle: `Edit ${req.name} options query`,
      editorAriaSubject: 'parameter options query',
      apply: (newQuery) => {
        if (numericId === undefined) return;
        const story = content.story ?? '';
        const next = req.ref.format === 'jsx'
          ? updateParamQueryInJsx(story, req.ref.astPath, newQuery)
          : updateParamQueryInHtml(story, req.ref.occurrence, newQuery);
        applyStoryHtmlEdit({ fileId: numericId, story: next });
      },
    });
  }, [numericId, content.story]);
  // Question-embed editing (saved / override / ephemeral) opens the shared question modal at the
  // StoryView level (see StoryQuestionEditor); applies land as pure story transforms (html or jsx).
  const [questionEdit, setQuestionEdit] = useState<StoryQuestionEditRequest | null>(null);
  // Select-to-chat provenance: only for an owned story (canEdit); the popover itself is gated to edit
  // mode inside AgentHtml. The selection is rich-text (HTML).
  const selectionSource: EditWithAgentSource | undefined =
    canEdit && numericId !== undefined
      ? { editorKind: 'richtext', fileName: storyName ?? 'Story', filePath: storyPath, fileId: numericId }
      : undefined;

  // Freeze the html the iframe renders for the duration of an edit session: the user's INLINE edits
  // stream to the dirty content via onChange, and feeding that back as `html` would rebuild the iframe
  // and lose the cursor. But the freeze must only guard against the iframe's OWN echoes — an EXTERNAL
  // change to content.story while in edit mode (the agent authoring/editing via EditFile, or a JSON-tab
  // edit) must still render, otherwise a freshly-created draft — which opens in edit mode EMPTY and is
  // then populated by the agent — stays blank until Save. We tell the two apart with lastEmittedRef:
  // the last html the iframe serialized out via onChange. A session counter forces ONE clean remount
  // when edit mode exits (Save → persisted content; Cancel → reverted content).
  // Managed via the "adjust state during render" pattern (React re-renders synchronously) — no effects.
  const liveStory = content.story ?? '';
  const [session, setSession] = useState({ editing: false, snapshot: liveStory, lastEmitted: null as string | null, key: 0 });
  if (editing !== session.editing) {
    setSession(s => ({
      ...s,
      editing,
      snapshot: editing ? liveStory : s.snapshot, // freeze on enter
      key: editing ? s.key : s.key + 1,           // bump on exit → one clean remount
    }));
  } else if (editing && liveStory !== session.snapshot && liveStory !== session.lastEmitted) {
    // External change while editing (agent EditFile, JSON-tab edit) — NOT the iframe's own onChange
    // echo (tracked in lastEmitted). Adopt it so the new content renders, and bump the key so the
    // iframe cleanly rebuilds. This is what lets a freshly-created draft — which opens in edit mode
    // EMPTY and is then populated by the agent — actually show its content instead of staying blank.
    setSession(s => ({ ...s, snapshot: liveStory, key: s.key + 1 }));
  }
  const htmlForRender = session.editing ? session.snapshot : liveStory;

  // Keyed to remount AgentHtml on content change (see hashStory); the same key drives the
  // rebuild-stability hook (height pin + scroll restore) so it fires exactly when the iframe
  // rebuilds — see lib/hooks/use-story-rebuild-stability.
  const canvasRef = useRef<HTMLDivElement>(null);
  const renderKey = `${session.key}:${hashStory(htmlForRender)}`;
  const pinHeight = useStoryRebuildStability(canvasRef, renderKey);

  // Warm the TOP document's font cache for the theme's platform fonts, so every iframe
  // remount (each agent edit) re-registers its font-display:swap @font-face against
  // already-cached files instead of flashing fallback text (jsx stories only — legacy
  // stories bring their own @import fonts).
  const themeName = content.theme ?? undefined;
  useEffect(() => {
    if (storyFormat === 'jsx') preloadStoryFonts(themeName);
  }, [storyFormat, themeName]);

  const onStoryChange = useCallback((story: string) => {
    // Record our own serialized echo so the render-phase logic above doesn't mistake it for an
    // external edit and needlessly rebuild the iframe mid-typing (which would drop the cursor).
    setSession(s => ({ ...s, lastEmitted: story }));
    if (numericId !== undefined) applyStoryHtmlEdit({ fileId: numericId, story });
  }, [numericId]);

  // Question-modal write-backs: pure transforms over the CURRENT story body — the request's ref
  // picks the html (placeholder occurrence) or jsx (AST path) transform — staged like any other
  // story edit (header Save persists, Cancel reverts). The content change makes StoryView adopt the
  // new body and cleanly rebuild the iframe — exactly what we want after a modal apply.
  const onApplySavedViz = useCallback((req: Extract<StoryQuestionEditRequest, { kind: 'saved' }>, viz: VizEnvelope) => {
    if (numericId === undefined) return;
    const story = content.story ?? '';
    const next = req.ref.format === 'jsx'
      ? updateSavedQuestionVizInJsx(story, req.ref.astPath, req.questionId, viz)
      : updateSavedQuestionVizInHtml(story, req.questionId, req.ref.occurrence, viz);
    applyStoryHtmlEdit({ fileId: numericId, story: next });
  }, [numericId, content.story]);

  const onApplyInline = useCallback((req: Extract<StoryQuestionEditRequest, { kind: 'inline' }>, edited: QuestionContent) => {
    if (numericId === undefined) return;
    const embed = questionContentToInlineEmbed(edited, req.embed.height);
    const story = content.story ?? '';
    const next = req.ref.format === 'jsx'
      ? updateInlineQuestionInJsx(story, req.ref.astPath, embed)
      : updateInlineQuestionInHtml(story, req.ref.occurrence, embed);
    applyStoryHtmlEdit({ fileId: numericId, story: next });
  }, [numericId, content.story]);

  if (!content.story) {
    return <StoryEmptyState />;
  }

  // Render the story as a FLUID responsive document — no transform scale or artificial reading
  // cap. AgentHtml measures this canvas and reflows the story to the width supplied by its parent.
  return (
    // pb clears the floating chat bar — it hovers over the page bottom and would cover the
    // story's last line. OUTSIDE the capture box (data-story-capture), so captures are unpadded.
    <Box aria-label="Story page" w="100%" minH="420px">
      <Box display="flex" justifyContent="center" pb="24" mb="24">
        {/* Relative wrapper anchors the DEV marker overlay OVER the captured box without being INSIDE
            it — so the serialized capture sees the story alone, and the app-state screenshot's baked
            gutter is the only numbering in the image (no double markers). */}
        <Box position="relative" w="100%" aria-label="Story canvas" ref={canvasRef} style={{ minHeight: pinHeight ? `${pinHeight}px` : undefined }}>
        {/* data-story-capture → OG share-card preview; data-file-id → the standard FileView capture
            (useScreenshot / Dev Tools "Download Image"), like question/dashboard views. */}
        <Box w="100%" {...(numericId !== undefined ? { 'data-story-capture': numericId, 'data-file-id': numericId } : {})}>
          {/* AgentHtml defaults to the svg surface — the story body mounts inside
              <svg><foreignObject> in the iframe, so the capture serializes the live surface. */}
          <AgentHtml
            // Remount on external content change (viewing) AND once per edit-session exit (see above).
            key={renderKey}
            html={htmlForRender}
            format={storyFormat}
            width={STORY_W}
            fluid
            editable={editing}
            readOnly={readOnly}
            colorMode={colorMode}
            theme={content.theme ?? null}
            compiledCss={compiledCss}
            filePath={storyPath}
            paramValues={content.parameterValues ?? undefined}
            onEditNumber={onEditNumber}
            onEditQuestion={editing ? setQuestionEdit : undefined}
            onEditParamQuery={editing ? onEditParamQuery : undefined}
            onChange={onStoryChange}
            selectionSource={selectionSource}
          />
        </Box>
          <PageMarkerDevOverlay enabled={showDevMarkers} colorMode={colorMode} />
        </Box>
      </Box>
      <NumberQueryEditor request={numberEdit} filePath={storyPath} onClose={() => setNumberEdit(null)} />
      <StoryQuestionEditor
        request={questionEdit}
        storyPath={storyPath}
        onClose={() => setQuestionEdit(null)}
        onApplySavedViz={onApplySavedViz}
        onApplyInline={onApplyInline}
      />
    </Box>
  );
}
