'use client';

/**
 * ConfigEditor - Pure Controlled Component
 * JSON editor for config files
 * NO internal state for content - fully controlled by container
 */

import { Box, VStack, Heading, HStack, Button, Text } from '@chakra-ui/react';
import { useState, useEffect, useRef } from 'react';
import { LuSave, LuCircleAlert, LuUndo } from 'react-icons/lu';
import { ConfigContent } from '@/lib/types';
import Editor from '@monaco-editor/react';
import { useAppSelector } from '@/store/hooks';

interface ConfigEditorProps {
  content: ConfigContent;
  isDirty: boolean;
  isSaving: boolean;
  onChange: (updates: Partial<ConfigContent>) => void;
  onSave: () => Promise<void>;
  onRevert: () => void;
}

export default function ConfigEditor({
  content,
  isDirty,
  isSaving,
  onChange,
  onSave,
  onRevert
}: ConfigEditorProps) {
  const [jsonText, setJsonText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const isEditingRef = useRef(false);

  // Sync content to JSON text only when NOT actively editing
  useEffect(() => {
    // Skip sync if user is actively editing
    if (isEditingRef.current) {
      return;
    }

    try {
      // Remove undefined fields (name is now in file metadata, not content)
      const cleanedConfig = JSON.parse(JSON.stringify(content));

      const newJson = JSON.stringify(cleanedConfig, null, 2);
      setJsonText(newJson);
      setError(null);
    } catch (err) {
      console.error('Error serializing config:', err);
      setError('Failed to serialize config');
    }
  }, [content]);

  // Handle JSON editor changes
  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return;

    // Mark as editing to prevent sync loop
    isEditingRef.current = true;
    setJsonText(value);

    // Try to parse and update content
    try {
      const parsed = JSON.parse(value);
      onChange(parsed);
      setError(null);
    } catch (err) {
      // Don't update content if JSON is invalid
      setError('Invalid JSON');
    }

    // Clear editing flag after a short delay to allow sync on next external change
    setTimeout(() => {
      isEditingRef.current = false;
    }, 100);
  };

  // Handle save
  const handleSave = async () => {
    if (error) {
      alert('Cannot save: ' + error);
      return;
    }

    try {
      isEditingRef.current = false;  // Allow sync after save
      await onSave();
    } catch (err) {
      console.error('Save failed:', err);
      alert('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  return (
    <VStack align="stretch" gap={0} h="100%">
      {/* Header with Save/Revert buttons */}
      <HStack
        justify="space-between"
        p={4}
        borderBottom="1px solid"
        borderColor="border.default"
        bg="bg.surface"
      >
        <Heading size="md" fontFamily="mono">
          Config Editor
        </Heading>
        <HStack gap={2}>
          {/* Error indicator */}
          {error && (
            <HStack color="accent.danger" fontSize="sm" fontFamily="mono">
              <LuCircleAlert />
              <Text>{error}</Text>
            </HStack>
          )}

          {/* Dirty indicator */}
          {isDirty && !error && (
            <Text fontSize="sm" color="accent.warning" fontFamily="mono">
              Unsaved changes
            </Text>
          )}

          {/* Revert button */}
          <Button
            onClick={() => {
              isEditingRef.current = false;  // Allow sync after revert
              onRevert();
            }}
            disabled={!isDirty || isSaving}
            variant="outline"
            size="sm"
          >
            <LuUndo />
            Revert
          </Button>

          {/* Save button */}
          <Button
            onClick={handleSave}
            disabled={!isDirty || isSaving || !!error}
            loading={isSaving}
            colorPalette="teal"
            size="sm"
          >
            <LuSave />
            Save
          </Button>
        </HStack>
      </HStack>

      {/* JSON Editor */}
      <Box flex={1} overflow="hidden">
        <Editor
          height="100%"
          language="json"
          value={jsonText}
          onChange={handleEditorChange}
          theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            wrappingIndent: 'indent',
            automaticLayout: true,
            tabSize: 2,
            formatOnPaste: true,
            formatOnType: true,
          }}
        />
      </Box>

      {/* Help text */}
      <Box
        p={4}
        borderTop="1px solid"
        borderColor="border.default"
        bg="bg.muted"
      >
        <Text fontSize="sm" color="fg.muted" fontFamily="mono">
          <strong>Config Structure:</strong> This file configures company-specific settings like branding.
        </Text>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" mt={2}>
          Example: <code>{`{ "branding": { "logoLight": "/logo.svg", "logoDark": "/logo-dark.svg", "displayName": "Company", "agentName": "Agent" } }`}</code>
        </Text>
      </Box>
    </VStack>
  );
}
