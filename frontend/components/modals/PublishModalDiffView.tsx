'use client';

import { useAppSelector } from '@/store/hooks';
import { Box, Text, HStack, VStack } from '@chakra-ui/react';
import { selectEffectiveName } from '@/store/filesSlice';
import type { FileState } from '@/store/filesSlice';
import type { AssetReference, DocumentContent } from '@/lib/types';

export function DiffView({ file }: { file: FileState }) {
  const { content, persistableChanges, metadataChanges } = file;

  const changedKeys = Object.keys(persistableChanges ?? {});
  const hasMetadata = metadataChanges && (metadataChanges.name !== undefined || metadataChanges.path !== undefined);

  if (changedKeys.length === 0 && !hasMetadata) {
    return <Text color="fg.muted" fontSize="sm">No changes detected</Text>;
  }

  // Dashboards get a human-readable widget diff instead of raw JSON blobs
  if (file.type === 'dashboard') {
    return <DashboardDiffView file={file} />;
  }

  return (
    <VStack gap={3} align="stretch">
      {hasMetadata && (
        <Box>
          <Text fontWeight="700" color="fg.subtle" mb={1.5} textTransform="uppercase" letterSpacing="0.05em" fontSize="2xs">
            Metadata
          </Text>
          {metadataChanges?.name !== undefined && (
            <HStack gap={2} mb={1}>
              <Text color="fg.muted" minW="60px">name:</Text>
              <Text color="accent.danger" textDecoration="line-through">{file.name}</Text>
              <Text color="accent.teal">{metadataChanges.name}</Text>
            </HStack>
          )}
          {metadataChanges?.path !== undefined && (
            <HStack gap={2}>
              <Text color="fg.muted" minW="60px">path:</Text>
              <Text color="accent.danger" textDecoration="line-through">{file.path}</Text>
              <Text color="accent.teal">{metadataChanges.path}</Text>
            </HStack>
          )}
        </Box>
      )}

      {changedKeys.map(key => {
        const original = (content as Record<string, unknown>)?.[key];
        const changed = (persistableChanges as Record<string, unknown>)?.[key];

        return (
          <Box key={key}>
            <Text fontWeight="700" color="fg.subtle" mb={1.5} textTransform="uppercase" letterSpacing="0.05em" fontSize="2xs">
              {key}
            </Text>
            <HStack gap={3} align="start">
              <Box flex={1} bg="accent.danger/5" borderRadius="sm" p={2} border="1px solid" borderColor="accent.danger/20">
                <Text fontSize="2xs" color="accent.danger" fontWeight="600" mb={1}>Original</Text>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--chakra-colors-fg-default)', fontSize: '11px' }}>
                  {JSON.stringify(original ?? null, null, 2)}
                </pre>
              </Box>
              <Box flex={1} bg="accent.teal/5" borderRadius="sm" p={2} border="1px solid" borderColor="accent.teal/20">
                <Text fontSize="2xs" color="accent.teal" fontWeight="600" mb={1}>Changed</Text>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--chakra-colors-fg-default)', fontSize: '11px' }}>
                  {JSON.stringify(changed ?? null, null, 2)}
                </pre>
              </Box>
            </HStack>
          </Box>
        );
      })}
    </VStack>
  );
}

/** Human-readable diff for dashboard files: shows added/removed/moved question widgets by name */
function DashboardDiffView({ file }: { file: FileState }) {
  const { content, persistableChanges, metadataChanges } = file;

  const oldAssets: AssetReference[] = (content as DocumentContent | null)?.assets ?? [];
  const newAssets: AssetReference[] = (persistableChanges as Partial<DocumentContent> | undefined)?.assets
    ?? (content as DocumentContent | null)?.assets
    ?? [];

  const oldLayout: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const newLayout: Record<string, { x: number; y: number; w: number; h: number }> = {};

  for (const item of ((content as DocumentContent | null)?.layout?.items ?? [])) {
    oldLayout[String(item.id)] = { x: item.x, y: item.y, w: item.w, h: item.h };
  }
  const changedLayoutItems = (persistableChanges as Partial<DocumentContent> | undefined)?.layout?.items
    ?? (content as DocumentContent | null)?.layout?.items
    ?? [];
  for (const item of changedLayoutItems) {
    newLayout[String(item.id)] = { x: item.x, y: item.y, w: item.w, h: item.h };
  }

  const oldQuestionIds = new Set(
    oldAssets.filter(a => a.type === 'question').map(a => (a as { type: 'question'; id: number }).id)
  );
  const newQuestionIds = new Set(
    newAssets.filter(a => a.type === 'question').map(a => (a as { type: 'question'; id: number }).id)
  );

  const addedIds = [...newQuestionIds].filter(id => !oldQuestionIds.has(id));
  const removedIds = [...oldQuestionIds].filter(id => !newQuestionIds.has(id));
  const keptIds = [...oldQuestionIds].filter(id => newQuestionIds.has(id));

  const movedIds = keptIds.filter(id => {
    const key = String(id);
    const o = oldLayout[key];
    const n = newLayout[key];
    if (!o || !n) return false;
    return o.x !== n.x || o.y !== n.y || o.w !== n.w || o.h !== n.h;
  });

  const hasChanges = addedIds.length > 0 || removedIds.length > 0 || movedIds.length > 0 || metadataChanges;
  if (!hasChanges) {
    return <Text color="fg.muted" fontSize="sm">No changes detected</Text>;
  }

  return (
    <VStack gap={3} align="stretch">
      {metadataChanges?.name !== undefined && (
        <DashboardDiffSection label="Name">
          <HStack gap={2}>
            <Text fontSize="xs" color="accent.danger" textDecoration="line-through" fontFamily="mono">{file.name}</Text>
            <Text fontSize="xs" color="fg.muted">→</Text>
            <Text fontSize="xs" color="accent.teal" fontFamily="mono">{metadataChanges.name}</Text>
          </HStack>
        </DashboardDiffSection>
      )}

      {addedIds.length > 0 && (
        <DashboardDiffSection label={`Added (${addedIds.length})`} accent="teal">
          <VStack align="stretch" gap={1}>
            {addedIds.map(id => <QuestionDiffRow key={id} questionId={id} accent="teal" />)}
          </VStack>
        </DashboardDiffSection>
      )}

      {removedIds.length > 0 && (
        <DashboardDiffSection label={`Removed (${removedIds.length})`} accent="danger">
          <VStack align="stretch" gap={1}>
            {removedIds.map(id => <QuestionDiffRow key={id} questionId={id} accent="danger" />)}
          </VStack>
        </DashboardDiffSection>
      )}

      {movedIds.length > 0 && (
        <DashboardDiffSection label={`Repositioned (${movedIds.length})`} accent="orange">
          <VStack align="stretch" gap={1}>
            {movedIds.map(id => {
              const o = oldLayout[String(id)];
              const n = newLayout[String(id)];
              return (
                <HStack key={id} gap={2} align="center">
                  <QuestionDiffRow questionId={id} accent="orange" />
                  <Text fontSize="2xs" color="fg.muted" fontFamily="mono" flexShrink={0}>
                    {o.w}×{o.h}@({o.x},{o.y}) → {n.w}×{n.h}@({n.x},{n.y})
                  </Text>
                </HStack>
              );
            })}
          </VStack>
        </DashboardDiffSection>
      )}
    </VStack>
  );
}

function DashboardDiffSection({ label, accent, children }: {
  label: string;
  accent?: 'teal' | 'danger' | 'orange';
  children: React.ReactNode;
}) {
  const color = accent === 'teal' ? 'accent.teal' : accent === 'danger' ? 'accent.danger' : 'orange.500';
  const bg = accent === 'teal' ? 'accent.teal/5' : accent === 'danger' ? 'accent.danger/5' : 'orange.500/5';
  const border = accent === 'teal' ? 'accent.teal/20' : accent === 'danger' ? 'accent.danger/20' : 'orange.500/20';
  return (
    <Box>
      <Text fontWeight="700" color={color} mb={1.5} textTransform="uppercase" letterSpacing="0.05em" fontSize="2xs">
        {label}
      </Text>
      <Box bg={bg} borderRadius="sm" p={2} border="1px solid" borderColor={border}>
        {children}
      </Box>
    </Box>
  );
}

function QuestionDiffRow({ questionId, accent }: { questionId: number; accent: 'teal' | 'danger' | 'orange' }) {
  const name = useAppSelector(state => selectEffectiveName(state, questionId));
  const color = accent === 'teal' ? 'accent.teal' : accent === 'danger' ? 'accent.danger' : 'orange.500';
  return (
    <HStack gap={1.5}>
      <Text fontSize="xs" color={color} fontWeight="600" fontFamily="mono">
        {accent === 'teal' ? '+' : accent === 'danger' ? '−' : '~'}
      </Text>
      <Text fontSize="xs" fontFamily="mono" color="fg.default">
        {name || `#${questionId}`}
      </Text>
    </HStack>
  );
}
