'use client';

import { useCallback, useState } from 'react';
import { Box, Text } from '@chakra-ui/react';
import { LuScrollText, LuSparkles } from 'react-icons/lu';

import AgentHtml, { type NumberQueryEditRequest } from '@/components/views/shared/AgentHtml';
import NumberQueryEditor from '@/components/views/story/NumberQueryEditor';
import { StoryContent } from '@/lib/types';
import type { EditWithAgentSource } from '@/lib/chat/edit-with-agent';
import { useAppSelector } from '@/store/hooks';
import { selectFile } from '@/store/filesSlice';
import { selectBranding } from '@/store/configsSlice';
import { selectFileEditMode } from '@/store/uiSlice';
import { applyStoryHtmlEdit } from '@/lib/api/file-state';
import { STORY_W } from './ScaledStoryFrame';

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

/**
 * Empty state: a blank story is conceptually a blank page, so we lean into that — a small
 * "manuscript" tile that visibly drafts itself (title bar, text lines, then a mini bar chart),
 * sitting in a soft atmospheric glow. Pure CSS, theme-token driven, dark/light aware. One
 * orchestrated entrance (staggered fade-up) rather than scattered micro-interactions.
 */
function EmptyStory() {
  const agentName = useAppSelector(selectBranding)?.agentName ?? 'the agent';
  return (
    <Box
      aria-label="No story"
      position="relative"
      minH="460px"
      overflow="hidden"
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      p={10}
      css={{
        '@keyframes story-rise': {
          from: { opacity: 0, transform: 'translateY(10px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        '@keyframes story-float': {
          '0%, 100%': { transform: 'rotate(-4deg) translateY(0)' },
          '50%': { transform: 'rotate(-4deg) translateY(-7px)' },
        },
        '@keyframes story-draw': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
        '@keyframes story-grow': {
          from: { transform: 'scaleY(0)' },
          to: { transform: 'scaleY(1)' },
        },
        '@keyframes story-glow': {
          '0%, 100%': { opacity: 0.55 },
          '50%': { opacity: 0.9 },
        },
      }}
    >
      {/* Atmosphere: radial glow + faint dotted grid, masked so it fades at the edges. */}
      <Box
        aria-hidden
        position="absolute"
        inset={0}
        pointerEvents="none"
        css={{
          backgroundImage:
            'radial-gradient(circle at center, color-mix(in srgb, var(--chakra-colors-accent-sun) 16%, transparent), transparent 62%)',
          animation: 'story-glow 5s ease-in-out infinite',
        }}
      />
      <Box
        aria-hidden
        position="absolute"
        inset={0}
        pointerEvents="none"
        opacity={0.5}
        css={{
          backgroundImage:
            'radial-gradient(var(--chakra-colors-border-default) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(circle at center, black 0%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(circle at center, black 0%, transparent 70%)',
        }}
      />

      {/* The self-drafting manuscript tile. */}
      <Box
        aria-hidden
        position="relative"
        w="184px"
        h="224px"
        mb={9}
        css={{ animation: 'story-rise 0.5s ease-out both, story-float 6s ease-in-out 0.5s infinite' }}
      >
        {/* Shadow page behind, for depth. */}
        <Box
          position="absolute"
          inset={0}
          transform="rotate(5deg)"
          bg="bg.surface"
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="lg"
          opacity={0.45}
        />
        {/* Foreground page. */}
        <Box
          position="absolute"
          inset={0}
          transform="rotate(-4deg)"
          bg="bg.surface"
          borderWidth="1px"
          borderColor="border.default"
          borderRadius="lg"
          boxShadow="xl"
          p={5}
          display="flex"
          flexDirection="column"
          gap={2.5}
        >
          {/* Title bar. */}
          <Box
            h="9px"
            w="62%"
            borderRadius="full"
            bg="accent.sun"
            transformOrigin="left"
            css={{ animation: 'story-draw 0.45s ease-out 0.55s both' }}
          />
          {/* Text lines, drawn in sequence. */}
          {[
            { w: '100%', d: '0.7s' },
            { w: '92%', d: '0.78s' },
            { w: '100%', d: '0.86s' },
            { w: '74%', d: '0.94s' },
          ].map((line, i) => (
            <Box
              key={i}
              h="6px"
              w={line.w}
              borderRadius="full"
              bg="border.emphasized"
              transformOrigin="left"
              css={{ animation: `story-draw 0.4s ease-out ${line.d} both` }}
            />
          ))}
          {/* Mini bar chart — the "data" half of a data story, growing up from the baseline. */}
          <Box mt="auto" display="flex" alignItems="flex-end" gap={1.5} h="46px">
            {[
              { h: '40%', d: '1.05s', c: 'accent.warning' },
              { h: '70%', d: '1.13s', c: 'accent.sun' },
              { h: '52%', d: '1.21s', c: 'accent.warning' },
              { h: '100%', d: '1.29s', c: 'accent.sun' },
              { h: '64%', d: '1.37s', c: 'accent.warning' },
            ].map((bar, i) => (
              <Box
                key={i}
                flex="1"
                h={bar.h}
                borderRadius="sm"
                bg={bar.c}
                transformOrigin="bottom"
                css={{ animation: `story-grow 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) ${bar.d} both` }}
              />
            ))}
          </Box>
        </Box>
        {/* The scroll glyph, badged onto the corner of the page. */}
        <Box
          position="absolute"
          bottom="-14px"
          right="-14px"
          w="46px"
          h="46px"
          borderRadius="full"
          bg="bg.canvas"
          borderWidth="1px"
          borderColor="border.default"
          color="accent.sun"
          boxShadow="md"
          display="flex"
          alignItems="center"
          justifyContent="center"
          css={{ animation: 'story-rise 0.5s ease-out 1.3s both' }}
        >
          <LuScrollText size={22} strokeWidth={1.75} />
        </Box>
      </Box>

      {/* Eyebrow → headline → supporting copy, staggered. */}
      <Text
        css={{ animation: 'story-rise 0.5s ease-out 0.7s both' }}
        fontFamily="mono"
        fontSize="xs"
        letterSpacing="0.22em"
        fontWeight={600}
        textTransform="uppercase"
        color="accent.sun"
        mb={2.5}
      >
        Data Story
      </Text>
      <Text
        css={{ animation: 'story-rise 0.5s ease-out 0.8s both' }}
        fontSize="2xl"
        fontWeight={700}
        letterSpacing="-0.02em"
        color="fg.default"
        textAlign="center"
        lineHeight="1.2"
      >
        Plot twist: there&rsquo;s no story yet
      </Text>
      <Text
        css={{ animation: 'story-rise 0.5s ease-out 0.9s both' }}
        fontSize="sm"
        color="fg.muted"
        mt={3}
        maxW="390px"
        textAlign="center"
        lineHeight="1.6"
      >
        Ask {agentName} to spin one up. It weaves your narrative, charts, and headline numbers into a single scrolling page.
      </Text>

      {/* Pro-tip chip — the fastest path to a first story. */}
      <Box
        css={{ animation: 'story-rise 0.5s ease-out 1.05s both' }}
        mt={6}
        display="inline-flex"
        alignItems="center"
        gap={2}
        px={3.5}
        py={2}
        borderRadius="full"
        bg="bg.surface"
        borderWidth="1px"
        borderColor="border.default"
        boxShadow="sm"
        color="fg.muted"
        _hover={{ borderColor: 'accent.sun', color: 'fg.default' }}
        transition="border-color 0.2s, color 0.2s"
      >
        <Box color="accent.sun" display="flex">
          <LuSparkles size={14} strokeWidth={2} />
        </Box>
        <Text fontSize="xs">
          <Box as="span" fontWeight={700} color="accent.sun">Pro tip:</Box>{' '}
          <Box as="span" fontFamily="mono">@</Box>tag a dashboard and {agentName} turns its charts into a story.
        </Text>
      </Box>
    </Box>
  );
}

interface StoryViewProps {
  content: StoryContent;
  /** File id — enables inline visual editing (owned, non-public stories). */
  fileId?: number;
  /** Public read-only render (shared story): embedded charts hide actions + auth-gated links. */
  readOnly?: boolean;
}

/**
 * Story view: a single-page scrolling data story — one agent-authored HTML document on a fixed
 * 1280px-wide canvas (any height), with live chart embeds. Editing is driven by the SHARED file
 * header's Edit/Save/Cancel (the file's `fileEditMode`), exactly like questions/dashboards — there is
 * no story-specific Edit button. While editing, inline edits stream into the file's dirty content via
 * `onChange` (so the header's Save persists them and Cancel reverts them); the html is frozen during
 * the session so the iframe doesn't rebuild mid-edit.
 */
export default function StoryView({ content, fileId, readOnly = false }: StoryViewProps) {
  const numericId = typeof fileId === 'number' ? fileId : undefined;
  const canEdit = !readOnly && numericId !== undefined;
  const headerEditMode = useAppSelector(s => (numericId !== undefined ? selectFileEditMode(s, numericId) : false));
  const editing = canEdit && headerEditMode;

  // Inline <Number> query editing opens the full SqlEditor in a light-DOM modal (Monaco can't live
  // in the story iframe). The story's path feeds schema/connection autocomplete.
  const [numberEdit, setNumberEdit] = useState<NumberQueryEditRequest | null>(null);
  const storyFile = useAppSelector(s => (numericId !== undefined ? selectFile(s, numericId) : undefined));
  const storyPath = storyFile?.path;
  // Select-to-chat provenance: only for an owned story (canEdit); the popover itself is gated to edit
  // mode inside AgentHtml. The selection is rich-text (HTML).
  const selectionSource: EditWithAgentSource | undefined =
    canEdit && numericId !== undefined
      ? { editorKind: 'richtext', fileName: storyFile?.name ?? 'Story', filePath: storyPath, fileId: numericId }
      : undefined;

  // Freeze the html the iframe renders for the duration of an edit session: inline edits stream to
  // the dirty content via onChange, but feeding that back as `html` would rebuild the iframe and lose
  // the cursor. A session counter forces ONE clean remount when edit mode exits (Save → persisted
  // content; Cancel → reverted content), so the post-edit DOM always reflects the final content.
  // Managed via the "adjust state during render" pattern (React re-renders synchronously) — no effects.
  const liveStory = content.story ?? '';
  const [session, setSession] = useState({ editing: false, snapshot: liveStory, key: 0 });
  if (editing !== session.editing) {
    setSession(s => ({
      editing,
      snapshot: editing ? liveStory : s.snapshot, // freeze on enter
      key: editing ? s.key : s.key + 1,           // bump on exit → one clean remount
    }));
  }
  const htmlForRender = session.editing ? session.snapshot : liveStory;

  const onStoryChange = useCallback((story: string) => {
    if (numericId !== undefined) applyStoryHtmlEdit({ fileId: numericId, story });
  }, [numericId]);

  if (!content.story) {
    return <EmptyStory />;
  }

  // Render the story as a FLUID responsive document — no transform scale. Full-bleed on mobile;
  // capped at STORY_MAX_W and centered on desktop so it matches its ~1280px design canvas.
  return (
    <Box aria-label="Story page" w="100%" minH="420px">
      <Box display="flex" justifyContent="center">
        {/* data-story-capture → OG share-card preview; data-file-id → the standard FileView capture
            (useScreenshot / Dev Tools "Download Image"), like question/dashboard views. */}
        <Box w="100%" maxW={STORY_MAX_W} {...(numericId !== undefined ? { 'data-story-capture': numericId, 'data-file-id': numericId } : {})}>
          <AgentHtml
            // Remount on external content change (viewing) AND once per edit-session exit (see above).
            key={`${session.key}:${hashStory(htmlForRender)}`}
            html={htmlForRender}
            width={STORY_W}
            fluid
            editable={editing}
            readOnly={readOnly}
            paramValues={content.parameterValues ?? undefined}
            onEditNumber={setNumberEdit}
            onChange={onStoryChange}
            selectionSource={selectionSource}
          />
        </Box>
      </Box>
      <NumberQueryEditor request={numberEdit} filePath={storyPath} onClose={() => setNumberEdit(null)} />
    </Box>
  );
}
