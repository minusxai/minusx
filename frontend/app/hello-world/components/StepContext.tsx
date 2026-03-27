'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Spinner } from '@chakra-ui/react';
import { LuSparkles } from 'react-icons/lu';
import SchemaTreeView, { type WhitelistItem, type SchemaTreeItem } from '@/components/SchemaTreeView';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { pulseKeyframes, sparkleKeyframes } from '@/lib/ui/animations';
import { useConnections } from '@/lib/hooks/useConnections';
import { useAppSelector } from '@/store/hooks';
import Editor from '@monaco-editor/react';
import Markdown from '@/components/Markdown';
import type { ContextContent, DatabaseContext } from '@/lib/types';

interface StepContextProps {
  connectionName: string;
  connectionId: number;
  onComplete: (contextFileId: number) => void;
}

/**
 * Onboarding Step 2: Simplified context setup.
 * - Reads schema from Redux (already loaded by useConnections)
 * - Shows SchemaTreeView with all tables pre-whitelisted
 * - Lets user add a data description (optional)
 * - Creates a root context file on save
 */
export default function StepContext({ connectionName, connectionId, onComplete }: StepContextProps) {
  const { connections, loading: connectionsLoading } = useConnections({ skip: false });
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [docView, setDocView] = useState<'editor' | 'preview' | null>(null); // null = side-by-side

  // Debounced markdown change (same pattern as ContextEditorV2)
  const descriptionRef = useRef(description);
  descriptionRef.current = description;
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDescription(value || '');
    }, 300);
  }, []);

  // Get schema from Redux (already fetched by useConnections)
  const schemas: SchemaTreeItem[] = useMemo(() => {
    const conn = connections[connectionName];
    return conn?.schema?.schemas ?? [];
  }, [connections, connectionName]);

  const loading = connectionsLoading;

  // Build initial whitelist: all schemas whitelisted by default
  const defaultWhitelist: WhitelistItem[] = useMemo(() => {
    return schemas.map(s => ({ type: 'schema' as const, name: s.schema }));
  }, [schemas]);

  const [whitelist, setWhitelist] = useState<WhitelistItem[] | null>(null);
  // Use local whitelist if user changed it, otherwise use default
  const effectiveWhitelist = whitelist ?? defaultWhitelist;

  const handleWhitelistChange = useCallback((newWhitelist: WhitelistItem[]) => {
    setWhitelist(newWhitelist);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);

    try {
      // Build context content
      const databases: DatabaseContext[] = [{
        databaseName: connectionName,
        whitelist: effectiveWhitelist,
      }];

      const docs = description.trim()
        ? [{ content: description.trim() }]
        : [];

      const contextContent: ContextContent = {
        versions: [{
          version: 1,
          databases,
          docs,
          createdAt: new Date().toISOString(),
          createdBy: 0, // Will be overridden by server
          description: 'Initial setup',
        }],
        published: { all: 1 },
      };

      // Create context file at root via POST /api/files
      const result = await fetchWithCache('/api/files', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Knowledge Base',
          path: '/org/context',
          type: 'context',
          content: contextContent,
          references: [],
        }),
        cacheStrategy: { ttl: 0, deduplicate: false },
      });

      const fileId = result?.data?.id;
      if (fileId) {
        onComplete(fileId);
      } else {
        setError('Failed to create context. Please try again.');
      }
    } catch (err) {
      console.error('[StepContext] Save error:', err);
      setError('Failed to save context. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [connectionName, effectiveWhitelist, description, onComplete]);

  const totalTables = useMemo(() => {
    return schemas.reduce((sum, s) => sum + s.tables.length, 0);
  }, [schemas]);

  const whitelistedCount = useMemo(() => {
    let count = 0;
    for (const item of effectiveWhitelist) {
      if (item.type === 'schema') {
        const schema = schemas.find(s => s.schema === item.name);
        count += schema?.tables.length ?? 0;
      } else {
        count += 1;
      }
    }
    return count;
  }, [effectiveWhitelist, schemas]);

  if (loading) {
    return (
      <VStack gap={4} py={10} align="center">
        <style>{pulseKeyframes}</style>
        <style>{sparkleKeyframes}</style>
        <HStack gap={2} color="accent.teal">
          <Box css={{ animation: 'sparkle 2s ease-in-out infinite' }}>
            <LuSparkles size={16} />
          </Box>
          <Text fontFamily="mono" fontSize="sm" color="fg.muted">
            Loading your schema...
          </Text>
          <HStack gap={0.5}>
            <Box w="4px" h="4px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out infinite' }} />
            <Box w="4px" h="4px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.2s infinite' }} />
            <Box w="4px" h="4px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.4s infinite' }} />
          </HStack>
        </HStack>
      </VStack>
    );
  }

  return (
    <VStack gap={6} align="stretch">
      {/* Header */}
      <Box>
        <Heading size="md" fontFamily="mono" fontWeight="500" mb={1}>
          Tell us about your data
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          {totalTables > 0
            ? <>We&apos;ve auto-selected {totalTables === 1 ? '' : 'all '}<Text as="span" color="accent.teal" fontWeight="600">{totalTables} {totalTables === 1 ? 'table' : 'tables'}</Text>. Deselect anything you don&apos;t need.</>
            : 'Add a description of your data to help us generate better queries.'
          }
        </Text>
      </Box>

      {/* Schema browser */}
      {schemas.length > 0 && (
        <Box
          border="1px solid"
          borderColor="border.default"
          borderRadius="lg"
          p={4}
          maxH="300px"
          overflowY="auto"
        >
          <HStack justify="space-between" mb={3}>
            <Text fontSize="xs" fontFamily="mono" color="fg.subtle">
              {whitelistedCount}/{totalTables} tables selected
            </Text>
          </HStack>
          <SchemaTreeView
            schemas={schemas}
            selectable
            whitelist={effectiveWhitelist}
            onWhitelistChange={handleWhitelistChange}
            showColumns={false}
            connectionName={connectionName}
            defaultExpandedSchemas
          />
        </Box>
      )}

      {schemas.length === 0 && (
        <Box p={4} bg="bg.muted" borderRadius="lg">
          <Text color="fg.muted" fontSize="sm">
            No schema found for this connection. You can still add a description below.
          </Text>
        </Box>
      )}

      {/* Data description */}
      <Box>
        <HStack justify="space-between" mb={2}>
          <Text fontSize="sm" fontWeight="500">
            Data description <Text as="span" color="fg.subtle">(optional, markdown)</Text>
          </Text>
          <HStack gap={1}>
            <Button
              size="xs"
              variant={docView === 'editor' ? 'solid' : 'ghost'}
              onClick={() => setDocView(docView === 'editor' ? null : 'editor')}
            >
              Editor
            </Button>
            <Button
              size="xs"
              variant={docView === 'preview' ? 'solid' : 'ghost'}
              onClick={() => setDocView(docView === 'preview' ? null : 'preview')}
            >
              Preview
            </Button>
            <Box w="1px" h="16px" bg="border.default" mx={1} />
            <Button
              variant="ghost"
              size="xs"
              fontFamily="mono"
              color="accent.teal"
              _hover={{ bg: 'bg.muted' }}
              onClick={handleSave}
              disabled={saving}
            >
              <LuSparkles size={12} />
              Let the agent figure it out
            </Button>
          </HStack>
        </HStack>
        <Box
          border="1px solid"
          borderColor="border.default"
          borderRadius="lg"
          overflow="hidden"
        >
          {/* Preview-only mode */}
          {docView === 'preview' && (
            <Box p={4} minH="250px" maxH="250px" overflowY="auto">
              {description.trim() ? (
                <Markdown context="mainpage">{description}</Markdown>
              ) : (
                <Text color="fg.muted" fontSize="sm">No content to preview.</Text>
              )}
            </Box>
          )}

          {/* Editor + optional preview panel */}
          <HStack gap={0} align="stretch" display={docView === 'preview' ? 'none' : 'flex'}>
            <Box flex={1} minW={0}>
              <Editor
                height="250px"
                language="markdown"
                defaultValue={description}
                onChange={handleEditorChange}
                theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                options={{
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  lineNumbers: 'off',
                  fontSize: 13,
                  fontFamily: 'JetBrains Mono, monospace',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  placeholder: 'Describe your data here... e.g.,\n\n# My Database\n\nThis contains our e-commerce data: orders, customers, products.',
                }}
              />
            </Box>
            {/* Side-by-side preview (default null mode) */}
            {docView === null && (
              <Box
                flex={1}
                p={3}
                bg="bg.muted"
                maxH="250px"
                overflowY="auto"
                borderLeft="1px solid"
                borderColor="border.default"
                minW={0}
              >
                {description.trim() ? (
                  <Markdown context="mainpage">{description}</Markdown>
                ) : (
                  <Text color="fg.muted" fontSize="sm">Preview will appear here...</Text>
                )}
              </Box>
            )}
          </HStack>
        </Box>
      </Box>

      {/* Error */}
      {error && (
        <Text color="accent.danger" fontSize="sm">{error}</Text>
      )}

      {/* Actions */}
      <HStack justify="flex-end" gap={3} pt={2}>
        <Button
          bg="accent.teal"
          color="white"
          _hover={{ opacity: 0.9 }}
          size="sm"
          fontFamily="mono"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <Spinner size="xs" mr={2} /> : null}
          Continue
        </Button>
      </HStack>
    </VStack>
  );
}
