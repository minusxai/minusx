'use client';

import { useRef, useState } from 'react';
import { Box, Button, HStack, Icon, Text } from '@chakra-ui/react';
import { LuBookOpen, LuCheck, LuPencil, LuX } from 'react-icons/lu';

import AgentHtml, { type AgentHtmlHandle, type NumberQueryEditRequest } from '@/components/views/shared/AgentHtml';
import NumberQueryEditor from '@/components/views/story/NumberQueryEditor';
import { StoryContent } from '@/lib/types';
import { useAppSelector } from '@/store/hooks';
import { selectFile } from '@/store/filesSlice';
import { applyStoryHtmlEdit } from '@/lib/api/file-state';
import { toaster } from '@/components/ui/toaster';
import { STORY_W } from './ScaledStoryFrame';

// Max on-screen width of the reading column. Stories render FLUID (no transform
// scale): full-bleed on mobile, capped + centered here on desktop. Authored
// against a ~1280px canvas, so cap at the same so desktop matches the design
// while everything below reflows responsively (container queries + cqi).
const STORY_MAX_W = '1280px';

interface StoryViewProps {
  content: StoryContent;
  /** File id — enables inline visual editing (owned, non-public stories). */
  fileId?: number;
  /** Public read-only render (shared story): embedded charts hide actions + auth-gated links. */
  readOnly?: boolean;
}

/**
 * Story view: a single-page scrolling data story — one agent-authored HTML
 * document on a fixed 1280px-wide canvas (any height), with live chart embeds.
 * The visual canvas is a viewer (the story is written by the agent via EditFile
 * on `content.story`). The JSON/XML "Code view" is rendered centrally by FileView.
 */
export default function StoryView({ content, fileId, readOnly = false }: StoryViewProps) {
  // Inline visual editing: a contenteditable canvas behind an Edit toggle, only
  // when this is an owned (non-public) story file.
  const canEdit = !readOnly && fileId !== undefined;
  const [editing, setEditing] = useState(false);
  // Bumped to force-remount AgentHtml, rebuilding the shadow DOM from the
  // current story — used to discard unsaved inline edits on Cancel.
  const [renderKey, setRenderKey] = useState(0);
  const agentRef = useRef<AgentHtmlHandle>(null);
  // Inline <Number> query editing opens the full SqlEditor in a light-DOM modal (Monaco can't live
  // in the story shadow root). The story's path feeds schema/connection autocomplete.
  const [numberEdit, setNumberEdit] = useState<NumberQueryEditRequest | null>(null);
  const storyPath = useAppSelector(s => (fileId !== undefined ? selectFile(s, fileId)?.path : undefined));

  const handleSave = () => {
    if (fileId === undefined) return;
    const story = agentRef.current?.serialize();
    if (story == null) return;
    const result = applyStoryHtmlEdit({ fileId, story });
    if (result.success) {
      setEditing(false);
      toaster.create({ title: 'Story updated — Publish to save', type: 'success' });
    } else {
      toaster.create({ title: 'Could not save story', description: result.error, type: 'error' });
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setRenderKey(k => k + 1); // discard in-DOM edits by rebuilding from content
  };

  if (!content.story) {
    return (
      <Box aria-label="No story" minH="420px" p={10} display="flex" flexDirection="column" alignItems="center" justifyContent="center">
        <Box mb={3} opacity={0.3}><LuBookOpen size={64} strokeWidth={1.5} /></Box>
        <Text fontSize="lg" fontWeight={700} color="fg.default">No story yet</Text>
        <Text fontSize="sm" color="fg.muted" mt={1}>Ask the agent to write a data story.</Text>
      </Box>
    );
  }

  // Render the story as a FLUID responsive document — no transform scale.
  // Full-bleed on mobile; capped at STORY_MAX_W and centered on desktop so it
  // matches its ~1280px design canvas. Everything below STORY_MAX_W reflows via
  // the story's own container queries / cqi units.
  return (
    <Box aria-label="Story page" w="100%" minH="420px">
      {canEdit && (
        <HStack
          position="sticky"
          top={0}
          zIndex={30}
          justify="flex-end"
          gap={2}
          px={3}
          py={2}
          bg="bg.canvas/85"
          backdropFilter="blur(6px)"
        >
          {editing ? (
            <>
              <Button size="xs" variant="outline" aria-label="Cancel story edits" onClick={handleCancel}>
                <Icon as={LuX} boxSize={4} /> Cancel
              </Button>
              <Button size="xs" colorPalette="teal" aria-label="Save story edits" onClick={handleSave}>
                <Icon as={LuCheck} boxSize={4} /> Save
              </Button>
            </>
          ) : (
            <Button size="xs" variant="outline" aria-label="Edit story" onClick={() => setEditing(true)}>
              <Icon as={LuPencil} boxSize={4} /> Edit
            </Button>
          )}
        </HStack>
      )}
      <Box display="flex" justifyContent="center">
        {/* data-story-capture → OG share-card preview; data-file-id → the standard FileView
            capture (useScreenshot / Dev Tools "Download Image"), like question/dashboard views. */}
        <Box w="100%" maxW={STORY_MAX_W} {...(fileId !== undefined ? { 'data-story-capture': fileId, 'data-file-id': fileId } : {})}>
          <AgentHtml
            key={renderKey}
            ref={agentRef}
            html={content.story}
            width={STORY_W}
            fluid
            editable={canEdit && editing}
            readOnly={readOnly}
            paramValues={content.parameterValues ?? undefined}
            onEditNumber={setNumberEdit}
          />
        </Box>
      </Box>
      <NumberQueryEditor request={numberEdit} filePath={storyPath} onClose={() => setNumberEdit(null)} />
    </Box>
  );
}
