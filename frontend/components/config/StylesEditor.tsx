'use client';

/**
 * StylesEditor - Pure Controlled Component
 * CSS editor for styles.css files
 * NO internal state for content - fully controlled by container
 */

import { Box, VStack, Heading, HStack, Button, Text } from '@chakra-ui/react';
import { useState, useEffect, useRef } from 'react';
import { LuSave, LuUndo } from 'react-icons/lu';
import { StylesContent } from '@/lib/types';
import Editor from '@monaco-editor/react';
import { useAppSelector } from '@/store/hooks';

interface StylesEditorProps {
  content: StylesContent;
  isDirty: boolean;
  isSaving: boolean;
  onChange: (updates: Partial<StylesContent>) => void;
  onSave: () => Promise<void>;
  onRevert: () => void;
}

export default function StylesEditor({
  content,
  isDirty,
  isSaving,
  onChange,
  onSave,
  onRevert
}: StylesEditorProps) {
  const [cssText, setCssText] = useState<string>('');
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const isEditingRef = useRef(false);

  // Sync content to CSS text only when NOT actively editing
  useEffect(() => {
    // Skip sync if user is actively editing
    if (isEditingRef.current) {
      return;
    }

    setCssText(content.styles || '');
  }, [content]);

  // Handle CSS editor changes
  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return;

    // Mark as editing to prevent sync loop
    isEditingRef.current = true;
    setCssText(value);

    // Update content with new CSS
    onChange({ styles: value });

    // Clear editing flag after a short delay to allow sync on next external change
    setTimeout(() => {
      isEditingRef.current = false;
    }, 100);
  };

  // Handle save
  const handleSave = async () => {
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
          Styles Editor
        </Heading>
        <HStack gap={2}>
          {/* Dirty indicator */}
          {isDirty && (
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
            disabled={!isDirty || isSaving}
            loading={isSaving}
            colorPalette="teal"
            size="sm"
          >
            <LuSave />
            Save
          </Button>
        </HStack>
      </HStack>

      {/* CSS Editor */}
      <Box flex={1} overflow="hidden">
        <Editor
          height="100%"
          language="css"
          value={cssText}
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
          <strong>Styles:</strong> CSS rules for company branding (logos, colors, etc.)
        </Text>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" mt={2}>
          Example: <code>{`[aria-label="Company logo"] { background-image: url('/logo.svg'); }`}</code>
        </Text>
      </Box>
    </VStack>
  );
}
