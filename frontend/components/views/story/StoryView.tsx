'use client';

import { useCallback, useState } from 'react';
import { Box } from '@chakra-ui/react';

import AgentHtml, { type NumberQueryEditRequest } from '@/components/views/shared/AgentHtml';
import NumberQueryEditor from '@/components/views/story/NumberQueryEditor';
import StoryQuestionEditor from '@/components/views/story/StoryQuestionEditor';
import type { StoryQuestionEditRequest } from '@/components/views/shared/StoryEmbeds';
import { StoryEmptyState } from '@/components/views/shared/empty-states';
import { StoryContent, QuestionContent } from '@/lib/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { EditWithAgentSource } from '@/lib/chat/edit-with-agent';
import type { StoryRenderer } from '@/lib/branding/whitelabel';
import { applyStoryHtmlEdit } from '@/lib/file-state/file-state';
import {
  updateSavedQuestionVizInHtml, updateInlineQuestionInHtml, questionContentToInlineEmbed,
} from '@/lib/data/story/story-question';
import { STORY_W } from './ScaledStoryFrame';
import CanvasStoryView from './CanvasStoryView';
import { PageMarkerDevOverlay } from './PageMarkerDevOverlay';

// Max on-screen width of the reading column. Stories render FLUID (no transform
// scale): full-bleed on mobile, capped + centered here on desktop. Authored
// against a ~1280px canvas, so cap at the same so desktop matches the design
// while everything below reflows responsively (container queries + cqi).
const STORY_MAX_W = '1280px';

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
  /** Which engine renders the story (Settings → "Story Renderer"), sourced by the container from
   *  configs. 'canvas' and 'svg' fall back to the DOM path per story on failure. */
  storyRenderer?: StoryRenderer;
  /** DEV-ONLY: overlay the app-state screenshot's position markers on the live view (sourced from
   *  devMode by the container). Never shown to end users; mounts OUTSIDE the captured subtree. */
  showDevMarkers?: boolean;
}

/**
 * Story view: a single-page scrolling story — one agent-authored HTML document on a fixed
 * 1280px-wide canvas (any height), with live chart embeds. Editing is driven by the SHARED file
 * header's Edit/Save/Cancel (the file's `fileEditMode`), exactly like questions/dashboards — there is
 * no story-specific Edit button. While editing, inline edits stream into the file's dirty content via
 * `onChange` (so the header's Save persists them and Cancel reverts them); the html is frozen during
 * the session so the iframe doesn't rebuild mid-edit.
 */
export default function StoryView({ content, fileId, readOnly = false, headerEditMode, storyPath, storyName, colorMode, compiledCss, storyRenderer = 'dom', showDevMarkers = false }: StoryViewProps) {
  const numericId = typeof fileId === 'number' ? fileId : undefined;
  const canEdit = !readOnly && numericId !== undefined;
  const editing = canEdit && headerEditMode;

  // Inline <Number> query editing opens the full SqlEditor in a light-DOM modal (Monaco can't live
  // in the story iframe). The story's path feeds schema/connection autocomplete.
  const [numberEdit, setNumberEdit] = useState<NumberQueryEditRequest | null>(null);
  // Question-embed editing (saved / override / ephemeral) opens the shared question modal at the
  // StoryView level (see StoryQuestionEditor); applies land as pure story-HTML transforms.
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

  const onStoryChange = useCallback((story: string) => {
    // Record our own serialized echo so the render-phase logic above doesn't mistake it for an
    // external edit and needlessly rebuild the iframe mid-typing (which would drop the cursor).
    setSession(s => ({ ...s, lastEmitted: story }));
    if (numericId !== undefined) applyStoryHtmlEdit({ fileId: numericId, story });
  }, [numericId]);

  // Question-modal write-backs: pure transforms over the CURRENT story body, staged like any other
  // story edit (header Save persists, Cancel reverts). The content change makes StoryView adopt the
  // new html and cleanly rebuild the iframe — exactly what we want after a modal apply.
  const onApplySavedViz = useCallback((req: Extract<StoryQuestionEditRequest, { kind: 'saved' }>, viz: VizEnvelope) => {
    if (numericId === undefined) return;
    applyStoryHtmlEdit({ fileId: numericId, story: updateSavedQuestionVizInHtml(content.story ?? '', req.questionId, req.occurrence, viz) });
  }, [numericId, content.story]);

  const onApplyInline = useCallback((req: Extract<StoryQuestionEditRequest, { kind: 'inline' }>, edited: QuestionContent) => {
    if (numericId === undefined) return;
    const embed = questionContentToInlineEmbed(edited, req.embed.height);
    applyStoryHtmlEdit({ fileId: numericId, story: updateInlineQuestionInHtml(content.story ?? '', req.index, embed) });
  }, [numericId, content.story]);

  if (!content.story) {
    return <StoryEmptyState />;
  }

  // Render the story as a FLUID responsive document — no transform scale. Full-bleed on mobile;
  // capped at STORY_MAX_W and centered on desktop so it matches its ~1280px design canvas.
  return (
    <Box aria-label="Story page" w="100%" minH="420px">
      <Box display="flex" justifyContent="center">
        {/* Relative wrapper anchors the DEV marker overlay OVER the captured box without being INSIDE
            it — so snapdom/canvas/svg capture the story alone, and the app-state screenshot's baked
            gutter is the only numbering in the image (no double markers). */}
        <Box position="relative" w="100%" maxW={STORY_MAX_W}>
        {/* data-story-capture → OG share-card preview; data-file-id → the standard FileView capture
            (useScreenshot / Dev Tools "Download Image"), like question/dashboard views. */}
        <Box w="100%" {...(numericId !== undefined ? { 'data-story-capture': numericId, 'data-file-id': numericId } : {})}>
          {storyRenderer === 'canvas' ? (
            <CanvasStoryView
              // While editing, render the LIVE story (each block commit re-rasters from
              // source — the overlay owns the caret, so there's no cursor to preserve).
              // STABLE key: unlike the iframe path, the canvas path re-rasters on an html
              // prop change while keeping the old bitmap on screen — keying by content
              // hash would remount the whole surface (blank flash) on every block commit.
              key="canvas"
              html={editing ? liveStory : htmlForRender}
              compiledCss={compiledCss}
              width={STORY_W}
              readOnly={readOnly}
              colorMode={colorMode}
              editable={editing}
              onStoryChange={onStoryChange}
              paramValues={content.parameterValues ?? undefined}
              storyPath={storyPath}
              fallback={
                <AgentHtml
                  key={`${session.key}:${hashStory(htmlForRender)}`}
                  html={htmlForRender}
                  width={STORY_W}
                  fluid
                  editable={false}
                  readOnly={readOnly}
                  colorMode={colorMode}
                  compiledCss={compiledCss}
                  filePath={storyPath}
                  paramValues={content.parameterValues ?? undefined}
                  onEditNumber={setNumberEdit}
                  onEditQuestion={editing ? setQuestionEdit : undefined}
                  onChange={onStoryChange}
                  selectionSource={selectionSource}
                />
              }
            />
          ) : (
          <AgentHtml
            // Remount on external content change (viewing) AND once per edit-session exit (see above).
            key={`${session.key}:${hashStory(htmlForRender)}`}
            html={htmlForRender}
            width={STORY_W}
            fluid
            // 'svg' mounts the same story body inside <svg><foreignObject> in the same iframe, so the
            // capture can serialize the live surface instead of re-deriving it with snapdom.
            surface={storyRenderer === 'svg' ? 'svg' : 'dom'}
            editable={editing}
            readOnly={readOnly}
            colorMode={colorMode}
            compiledCss={compiledCss}
            filePath={storyPath}
            paramValues={content.parameterValues ?? undefined}
            onEditNumber={setNumberEdit}
            onEditQuestion={editing ? setQuestionEdit : undefined}
            onChange={onStoryChange}
            selectionSource={selectionSource}
          />
          )}
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
