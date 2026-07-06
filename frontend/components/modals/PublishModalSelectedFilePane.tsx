'use client';

import { useState, useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import { Box, Text, HStack, IconButton } from '@chakra-ui/react';
import { LuUndo2, LuCheck, LuCode, LuEye } from 'react-icons/lu';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import FileView from '@/components/file-browser/FileView';
import { selectFile, selectEffectiveName } from '@/store/filesSlice';
import type { DocumentContent, DashboardLayoutItem } from '@/lib/types';
import { DashboardPublishHighlightsContext, type PublishHighlight } from '@/lib/context/dashboard-publish-highlights';
import { DiffView } from './PublishModalDiffView';

function SelectedFileName({ fileId }: { fileId: number }) {
  const name = useAppSelector(state => selectEffectiveName(state, fileId));
  const fileState = useAppSelector(state => selectFile(state, fileId));
  const meta = fileState ? getFileTypeMetadata(fileState.type as any) : null;
  const FileIcon = meta?.icon;
  return (
    <HStack gap={2} minW="0" flex="1">
      {FileIcon && (
        <Box color={meta?.color} flexShrink={0}>
          <FileIcon size={15} />
        </Box>
      )}
      <Text
        fontSize="sm"
        fontWeight="700"
        fontFamily="mono"
        truncate
        color="fg.default"
      >
        {name || 'Untitled'}
      </Text>
    </HStack>
  );
}

export function SelectedFilePane({ fileId, publishingSingleId, onDiscard, onPublish }: {
  fileId: number;
  publishingSingleId: number | null;
  onDiscard: () => void;
  onPublish: () => void;
}) {
  const showJson = useAppSelector(state => state.ui.devMode);
  const [viewMode, setViewMode] = useState<'preview' | 'diff'>(showJson ? 'diff' : 'preview');
  const file = useAppSelector(state => selectFile(state, fileId));

  // For dashboards in preview mode: compute add/moved question IDs so widgets get colored borders
  const publishHighlightsValue = useMemo(() => {
    if (!file || file.type !== 'dashboard' || viewMode !== 'preview') {
      return { highlights: null };
    }
    const content = file.content as DocumentContent | null;
    const changes = file.persistableChanges as Partial<DocumentContent> | undefined;
    if (!changes?.assets && !changes?.layout) return { highlights: null };

    const oldIds = new Set(
      (content?.assets ?? [])
        .filter(a => a.type === 'question')
        .map(a => (a as { type: 'question'; id: number }).id)
    );
    const newIds = new Set(
      (changes?.assets ?? content?.assets ?? [])
        .filter(a => a.type === 'question')
        .map(a => (a as { type: 'question'; id: number }).id)
    );

    const oldLayoutMap = new Map<string, DashboardLayoutItem>(
      ((content?.layout?.items ?? []) as DashboardLayoutItem[]).map(i => [String(i.id), i])
    );
    const newLayoutMap = new Map<string, DashboardLayoutItem>(
      ((changes?.layout?.items ?? content?.layout?.items ?? []) as DashboardLayoutItem[]).map(i => [String(i.id), i])
    );

    const map = new Map<number, PublishHighlight>();
    for (const id of newIds) {
      if (!oldIds.has(id)) {
        map.set(id, 'added');
      } else {
        const o = oldLayoutMap.get(String(id));
        const n = newLayoutMap.get(String(id));
        if (o && n && (o.x !== n.x || o.y !== n.y || o.w !== n.w || o.h !== n.h)) {
          map.set(id, 'moved');
        }
      }
    }
    return { highlights: map.size > 0 ? map : null };
  }, [file, viewMode]);

  return (
    <>
      <HStack
        px={4}
        py={2}
        borderBottom="1px solid"
        borderColor="border.default"
        flexShrink={0}
        justify="space-between"
      >
        <HStack gap={2} flex={1} minW={0}>
          <SelectedFileName fileId={fileId} />
          {showJson && (
            <HStack gap={0} bg="bg.muted" borderRadius="sm" p={0.5}>
              <IconButton
                aria-label="Preview"
                size="2xs"
                variant={viewMode === 'preview' ? 'solid' : 'ghost'}
                bg={viewMode === 'preview' ? 'accent.teal' : undefined}
                color={viewMode === 'preview' ? 'white' : 'fg.muted'}
                onClick={() => setViewMode('preview')}
              >
                <LuEye />
              </IconButton>
              <IconButton
                aria-label="Diff"
                size="2xs"
                variant={viewMode === 'diff' ? 'solid' : 'ghost'}
                bg={viewMode === 'diff' ? 'accent.teal' : undefined}
                color={viewMode === 'diff' ? 'white' : 'fg.muted'}
                onClick={() => setViewMode('diff')}
              >
                <LuCode />
              </IconButton>
            </HStack>
          )}
        </HStack>
        <HStack gap={0.5} flexShrink={0}>
          <IconButton
            aria-label="Discard changes"
            size="2xs"
            variant="ghost"
            color="accent.danger"
            onClick={onDiscard}
          >
            <LuUndo2 />
          </IconButton>
          <IconButton
            aria-label="Save file"
            size="2xs"
            variant="ghost"
            color="accent.teal"
            loading={publishingSingleId === fileId}
            onClick={onPublish}
          >
            <LuCheck />
          </IconButton>
        </HStack>
      </HStack>

      {viewMode === 'preview' ? (
        <DashboardPublishHighlightsContext.Provider value={publishHighlightsValue}>
          <Box flex="1" minH="0" display="flex" flexDirection="column" overflowY="auto">
            <FileView key={fileId} fileId={fileId} mode="preview" hideHeader />
          </Box>
        </DashboardPublishHighlightsContext.Provider>
      ) : (
        <Box flex="1" minH="0" overflowY="auto" p={4} fontSize="xs" fontFamily="mono">
          {file && <DiffView file={file} />}
        </Box>
      )}
    </>
  );
}
