'use client';

import { useAppSelector } from '@/store/hooks';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { Box } from '@chakra-ui/react';
import { useState } from 'react';

interface JsonEditorProps {
  value: string;
  /** Called with the new text on every VALID JSON edit. May return an error
   *  string (e.g. schema validation failure) to display instead of applying. */
  onChange: (value: string) => string | null | void;
  originalValue?: string; // If provided, shows diff view
  readOnly?: boolean; // Default true — pass false to enable direct editing
}

/** Parse-insensitive equality: same JSON document regardless of formatting. */
function jsonEquals(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return false;
  }
}

export default function JsonEditor({ value, onChange, originalValue, readOnly = true }: JsonEditorProps) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const [error, setError] = useState<string | null>(null);
  const isDiffMode = originalValue !== undefined;

  // Buffer the text locally so a value prop that round-trips through Redux
  // (parse → store → re-stringify, different formatting) doesn't clobber the
  // user's in-progress text and cursor. Only semantically NEW external values
  // (file switch, agent edit) replace the buffer. Adjust-during-render pattern
  // (https://react.dev/learn/you-might-not-need-an-effect).
  const [text, setText] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (!jsonEquals(value, text)) {
      setText(value);
      setError(null);
    }
  }

  const handleChange = (newValue: string | undefined) => {
    if (newValue === undefined) return;
    setText(newValue);

    try {
      JSON.parse(newValue);
    } catch (e) {
      // Mid-edit invalid JSON: keep typing, show error, don't propagate
      setError(e instanceof Error ? e.message : 'Invalid JSON');
      return;
    }

    const result = onChange(newValue);
    setError(typeof result === 'string' ? result : null);
  };

  const editorOptions = {
    readOnly,
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
          aria-label="JSON error"
          mb={2}
          p={2}
          bg="accent.danger/10"
          color="accent.danger"
          borderRadius="md"
          fontSize="sm"
          fontFamily="mono"
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
              readOnly: true, // Diff view is always read-only
              renderSideBySide: true,
              enableSplitViewResizing: true,
            }}
          />
        ) : (
          <Editor
            height="100%"
            defaultLanguage="json"
            value={text}
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
