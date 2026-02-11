'use client';

import { useAppSelector } from '@/store/hooks';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { Box } from '@chakra-ui/react';
import { useState } from 'react';

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  originalValue?: string; // If provided, shows diff view
}

export default function JsonEditor({ value, onChange, originalValue }: JsonEditorProps) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const [error, setError] = useState<string | null>(null);
  const isDiffMode = originalValue !== undefined;

  const handleChange = (newValue: string | undefined) => {
    if (!newValue) return;

    try {
      // Validate JSON
      JSON.parse(newValue);
      setError(null);
      onChange(newValue);
    } catch (e) {
      // Show error but don't update state
      setError(e instanceof Error ? e.message : 'Invalid JSON');
      console.error('Invalid JSON:', e);
    }
  };

  const editorOptions = {
    readOnly: true,
    minimap: { enabled: false },
    fontFamily: 'var(--font-jetbrains-mono)',
    formatOnPaste: true,
    formatOnType: true,
    lineNumbers: 'on' as const,
    folding: true,
    scrollBeyondLastLine: false,
    wordWrap: 'on' as const,
    wrappingIndent: 'indent' as const,
    automaticLayout: true,
    tabSize: 2,
    padding: {
      top: 12,
      bottom: 12,
    },
  };

  return (
    <Box>
      {error && (
        <Box
          mb={2}
          p={2}
          bg="accent.danger"
          color="accent.danger"
          borderRadius="md"
          fontSize="sm"
        >
          {error}
        </Box>
      )}
      <Box
        height="600px"
        border="1px solid"
        borderColor="border.default"
        borderRadius="md"
        overflow="hidden"
      >
        {isDiffMode ? (
          <DiffEditor
            height="100%"
            language="json"
            original={originalValue}
            modified={value}
            theme={colorMode === 'dark' ? 'vs-dark' : 'vs-light'}
            onMount={(editor, monaco) => {
              // Define custom theme
              monaco.editor.defineTheme('custom-theme', {
                base: colorMode === 'dark' ? 'vs-dark' : 'vs',
                inherit: true,
                rules: [],
                colors: {
                  'editor.background': colorMode === 'dark' ? '#161b22' : '#ffffff',
                },
              });
              monaco.editor.setTheme('custom-theme');
            }}
            options={{
              ...editorOptions,
              renderSideBySide: true,
              enableSplitViewResizing: true,
            }}
          />
        ) : (
          <Editor
            height="100%"
            defaultLanguage="json"
            value={value}
            onChange={handleChange}
            theme={colorMode === 'dark' ? 'vs-dark' : 'vs-light'}
            onMount={(editor, monaco) => {
              // Define custom theme
              monaco.editor.defineTheme('custom-theme', {
                base: colorMode === 'dark' ? 'vs-dark' : 'vs',
                inherit: true,
                rules: [],
                colors: {
                  'editor.background': colorMode === 'dark' ? '#161b22' : '#ffffff',
                },
              });
              monaco.editor.setTheme('custom-theme');
            }}
            options={editorOptions}
          />
        )}
      </Box>
    </Box>
  );
}
