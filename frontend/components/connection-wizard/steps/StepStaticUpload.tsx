'use client';

import { useState, useCallback, useRef } from 'react';
import { Box, VStack, HStack, Heading, Text, Button, Spinner, Progress } from '@chakra-ui/react';
import { LuArrowLeft } from 'react-icons/lu';
import { useAgentProgress, getProgressMessage } from '../useAgentProgress';
import { useAppSelector } from '@/store/hooks';
import { resolvePath } from '@/lib/mode/path-resolver';
import { useFileByPath, useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, publishFile, reloadFile } from '@/lib/file-state/file-state';
import { StaticConnectionConfig } from '@/components/views/connection-configs';
import type { ConnectionContent, CsvFileInfo } from '@/lib/types';

interface StepStaticUploadProps {
  tab: 'csv' | 'sheets';
  onComplete: (connectionId: number, connectionName: string, schemaNames: string[]) => void;
  onBack: () => void;
}

function getSchemaNames(config: Record<string, unknown>): string[] {
  const files = (config?.files ?? []) as CsvFileInfo[];
  return [...new Set(files.map(f => f.schema_name))];
}

function SaveConnectionProgress() {
  const progress = useAgentProgress(true, false, 9);
  return (
    <VStack gap={2} align="stretch" pt={2}>
      <style>{`@keyframes saveShimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
      <Text fontSize="xs" fontFamily="mono" color="accent.teal">
        {getProgressMessage(progress, [
          [0, 'Saving connection...'],
          [25, 'Registering tables...'],
          [50, 'Fetching metadata...'],
          [80, 'Almost there...'],
        ])}
      </Text>
      <Progress.Root size="sm" value={progress} colorPalette="teal">
        <Progress.Track borderRadius="full" overflow="hidden">
          <Progress.Range
            style={{ transition: 'width 0.4s ease-out' }}
            css={{
              position: 'relative',
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                animation: 'saveShimmer 1.5s ease-in-out infinite',
              },
            }}
          />
        </Progress.Track>
      </Progress.Root>
    </VStack>
  );
}

export default function StepStaticUpload({ tab, onComplete, onBack }: StepStaticUploadProps) {
  const userMode = useAppSelector(state => state.auth.user?.mode) ?? 'org';
  const staticConnectionPath = resolvePath(userMode, '/database/static');
  const { file: staticFile, loading: staticLoading } = useFileByPath(staticConnectionPath);
  const fileId = staticFile?.fileState.id as number | undefined;
  const { fileState } = useFile(fileId) ?? {};

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Track schemas added during this session
  const addedSchemasRef = useRef<Set<string>>(new Set());
  // Track whether there are un-uploaded pending files
  const [hasPendingFiles, setHasPendingFiles] = useState(false);

  const content = fileState
    ? { ...fileState.content, ...fileState.persistableChanges } as ConnectionContent
    : undefined;

  const hasFiles = ((content?.config as Record<string, unknown>)?.files as unknown[] | undefined)?.length ?? 0;

  // Track new schemas by comparing before/after on each config change
  const prevSchemasRef = useRef<Set<string> | null>(null);
  if (prevSchemasRef.current === null && content?.config) {
    prevSchemasRef.current = new Set(getSchemaNames(content.config as Record<string, unknown>));
  }

  const handleChange = useCallback((newConfig: Record<string, unknown>) => {
    if (!fileId) return;
    // Detect newly added schemas
    const newSchemas = getSchemaNames(newConfig);
    const prev = prevSchemasRef.current ?? new Set();
    for (const s of newSchemas) {
      if (!prev.has(s)) addedSchemasRef.current.add(s);
    }
    prevSchemasRef.current = new Set(newSchemas);
    editFile({ fileId, changes: { content: { config: newConfig } } });
  }, [fileId]);

  // Called by StaticConnectionConfig after successful upload — auto-save
  const handleInternalSave = useCallback(async () => {
    if (!fileId) return;
    setSaveError(null);
    try {
      await publishFile({ fileId });
    } catch (err) {
      console.error('[StepStaticUpload] Auto-save error:', err);
    }
  }, [fileId]);

  // Called by the explicit "Save & Continue" button
  const handleContinue = useCallback(async () => {
    if (!fileId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await publishFile({ fileId });
      // Saving only persists config.files — the connection's cached schema is
      // still the pre-upload (empty) one and is marked "fresh" in Redux, so the
      // context step's useConnections would skip the server fetch and show
      // "No tables found". Force a refresh now so the loader re-introspects the
      // newly uploaded files and the populated schema is in Redux before we
      // advance. The "Fetching metadata..." progress bar covers this wait.
      await reloadFile({ fileId: result.id, silent: true });
      const added = [...addedSchemasRef.current];
      // Fallback: if nothing tracked as new, pass all schemas
      const schemaNames = added.length > 0
        ? added
        : getSchemaNames((content?.config ?? {}) as Record<string, unknown>);
      onComplete(result.id, 'static', schemaNames);
    } catch (err) {
      console.error('[StepStaticUpload] Save error:', err);
      setSaveError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [fileId, onComplete, content]);

  if (staticLoading || !content || !fileId) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minH="400px">
        <Spinner size="lg" />
      </Box>
    );
  }

  return (
    <VStack gap={6} align="stretch">
      <HStack gap={3} align="center">
        <Button variant="ghost" size="sm" p={0} minW="auto" onClick={onBack}>
          <LuArrowLeft size={20} />
        </Button>
        <Box>
          <Heading fontSize="2xl" fontWeight="900" letterSpacing="-0.02em">
            {tab === 'csv' ? 'Upload CSV / XLSX' : 'Import Google Sheets'}
          </Heading>
          <Text color="fg.muted" fontSize="sm">
            {tab === 'csv'
              ? 'Upload files to add them to your static connection.'
              : 'Import a public Google Sheet to query it like a database.'}
          </Text>
        </Box>
      </HStack>

      <StaticConnectionConfig
        config={content.config || {}}
        onChange={handleChange}
        mode="view"
        userMode={userMode}
        onError={setSaveError}
        onSave={handleInternalSave}
        initialTab={tab}
        singleTab={tab}
        onPendingChange={setHasPendingFiles}
      />

      {saveError && (
        <Text color="accent.danger" fontSize="sm">{saveError}</Text>
      )}

      {saving ? (
        <SaveConnectionProgress />
      ) : (
        <HStack justify="flex-end" pt={2}>
          <Button
            aria-label="Save and continue"
            bg="accent.teal"
            color="white"
            _hover={{ opacity: 0.9 }}
            size="sm"
            fontFamily="mono"
            onClick={handleContinue}
            disabled={!hasFiles || hasPendingFiles}
          >
            Save & Continue &rarr;
          </Button>
        </HStack>
      )}
    </VStack>
  );
}
