'use client';

/**
 * StoryQuestionEditor — the story-level host for editing a question embed in a modal (the story
 * counterpart of the dashboard's QuestionStackLayer flow). Renders in a light-DOM Dialog at the
 * StoryView level (Monaco/ark-ui can't live inside the story iframe), hosting the same
 * CreateQuestionModalContainer the dashboard uses. The save target follows the embed type:
 * - kind:'saved', no override   → edits stage on the SAVED question file (dashboard semantics).
 * - kind:'saved', with override → 'saved-override' mode: viz edits come back via onApplySavedViz
 *   (→ the story body's data-question-viz), everything else stages on the file.
 * - kind:'inline'               → 'ephemeral' mode: a THROWAWAY draft file (created here, seeded
 *   with the embed's content) powers the editor; Update hands the content back via onApplyInline
 *   and the modal deletes the draft.
 * Closing is explicit (the modal's Cancel/Update) — backdrop/Esc are disabled so an ephemeral
 * draft can't leak by closing around the modal's cleanup paths.
 */
import { useEffect, useState } from 'react';
import { Dialog, Portal, Box, Spinner } from '@chakra-ui/react';
import CreateQuestionModalContainer from '@/components/modals/CreateQuestionModalContainer';
import { createDraftFile, editFile, deleteFile } from '@/lib/file-state/file-state';
import { inlineEmbedToQuestionContent } from '@/lib/data/story/story-question';
import type { QuestionContent } from '@/lib/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { StoryQuestionEditRequest } from '@/components/views/shared/StoryEmbeds';

type SavedRequest = Extract<StoryQuestionEditRequest, { kind: 'saved' }>;
type InlineRequest = Extract<StoryQuestionEditRequest, { kind: 'inline' }>;

interface StoryQuestionEditorProps {
  request: StoryQuestionEditRequest | null;
  /** The hosting story's path — the ephemeral draft is created in its folder (schema context). */
  storyPath?: string;
  onClose: () => void;
  onApplySavedViz: (req: SavedRequest, viz: VizEnvelope) => void;
  onApplyInline: (req: InlineRequest, content: QuestionContent) => void;
}

/** Parent folder of a file path ('/org/reports/growth' → '/org/reports'); '/org' fallback. */
function folderOf(path?: string): string {
  const parts = (path ?? '').split('/').filter(Boolean);
  return parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : '/org';
}

export default function StoryQuestionEditor({ request, storyPath, onClose, onApplySavedViz, onApplyInline }: StoryQuestionEditorProps) {
  return (
    <Dialog.Root
      open={!!request}
      onOpenChange={(e: { open: boolean }) => { if (!e.open) onClose(); }}
      size="cover"
      closeOnInteractOutside={false}
      closeOnEscape={false}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content
            w="96vw"
            h="92vh"
            maxW="1600px"
            bg="bg.canvas"
            borderRadius="lg"
            border="1px solid"
            borderColor="border.default"
            overflow="hidden"
          >
            {request?.kind === 'saved' && (
              <SavedBody request={request} storyPath={storyPath} onClose={onClose} onApplySavedViz={onApplySavedViz} />
            )}
            {request?.kind === 'inline' && (
              <InlineBody request={request} storyPath={storyPath} onClose={onClose} onApplyInline={onApplyInline} />
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function SavedBody({ request, storyPath, onClose, onApplySavedViz }: {
  request: SavedRequest; storyPath?: string; onClose: () => void;
  onApplySavedViz: StoryQuestionEditorProps['onApplySavedViz'];
}) {
  return (
    <CreateQuestionModalContainer
      isOpen
      onClose={onClose}
      onQuestionCreated={() => {}}
      folderPath={folderOf(storyPath)}
      questionId={request.questionId}
      isNewQuestion={false}
      sourceBadge="saved"
      storyEmbedMode={request.vizOverride ? 'saved-override' : undefined}
      vizOverride={request.vizOverride}
      onApplyVizOverride={(viz) => onApplySavedViz(request, viz)}
    />
  );
}

/** Separate body so the draft lifecycle only runs while an inline edit is actually open. */
function InlineBody({ request, storyPath, onClose, onApplyInline }: {
  request: InlineRequest; storyPath?: string; onClose: () => void;
  onApplyInline: StoryQuestionEditorProps['onApplyInline'];
}) {
  const [draftId, setDraftId] = useState<number | null>(null);

  // One throwaway draft per open, seeded with the embed's content. The modal's Update/Cancel
  // paths delete it; if this body unmounts before the draft even lands, delete it here.
  useEffect(() => {
    let cancelled = false;
    createDraftFile('question', { folder: folderOf(storyPath) })
      .then((id) => {
        editFile({ fileId: id, changes: { content: inlineEmbedToQuestionContent(request.embed) } });
        if (cancelled) deleteFile({ fileId: id }).catch(() => {});
        else setDraftId(id);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [request, storyPath]);

  if (draftId === null) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" h="100%">
        <Spinner size="lg" aria-label="Preparing question editor" />
      </Box>
    );
  }
  return (
    <CreateQuestionModalContainer
      isOpen
      onClose={onClose}
      onQuestionCreated={() => {}}
      folderPath={folderOf(storyPath)}
      questionId={draftId}
      sourceBadge="ephemeral"
      storyEmbedMode="ephemeral"
      onEphemeralApply={(content) => onApplyInline(request, content)}
    />
  );
}
