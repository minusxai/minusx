'use client';

import { Box, HStack, IconButton, Text } from '@chakra-ui/react';
import { LuCopy, LuCheck } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import Editor from '@monaco-editor/react';
import { useState } from 'react';
import { AppState, appStateForLlm, takeAppStateMarkup } from '@/lib/appState';
import { renderMarkupBlocks } from '@/lib/api/markup-blocks';

interface AppStateViewerProps {
  appState: AppState | null | undefined;
  maxHeight?: string;
}

export default function AppStateViewer({ appState, maxHeight = '400px' }: AppStateViewerProps) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const [copied, setCopied] = useState(false);

  // Show what the AGENT actually sees, mirroring `buildUserContent`: `content` is stripped
  // (`appStateForLlm`) and each file's `markup` is pulled OUT of the JSON into separate raw
  // `<file_markup>` blocks (`takeAppStateMarkup`) — so this is not valid JSON, it's the
  // prompt-shaped text. Rendered as plaintext below.
  const jsonString = (() => {
    if (!appState) return JSON.stringify(appState, null, 2);
    const { value, blocks } = takeAppStateMarkup(appStateForLlm(appState));
    const markupText = blocks.length ? `\n${renderMarkupBlocks(blocks)}` : '';
    return `<AppState>${JSON.stringify(value, null, 2)}</AppState>${markupText}`;
  })();

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box
      p={3}
      bg="accent.teal/10"
      borderLeft="3px solid"
      borderColor="accent.teal"
      borderRadius="md"
      maxH={maxHeight}
      overflow="hidden"
      display="flex"
      flexDirection="column"
    >
      <HStack justify="space-between" mb={2}>
        <Text fontSize="xs" fontWeight="700" color="accent.teal">
          Current App State
        </Text>
        <IconButton
          aria-label="Copy to clipboard"
          size="xs"
          variant="ghost"
          colorPalette="teal"
          onClick={handleCopy}
        >
          {copied ? <LuCheck /> : <LuCopy />}
        </IconButton>
      </HStack>
      <Box
        height="300px"
        border="1px solid"
        borderColor="border.default"
        borderRadius="md"
        overflow="hidden"
      >
        <Editor
          height="300px"
          defaultLanguage="plaintext"
          value={jsonString}
          theme={colorMode === 'dark' ? 'vs-dark' : 'vs-light'}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontFamily: 'var(--font-jetbrains-mono)',
            fontSize: 11,
            lineNumbers: 'off',
            folding: true,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            wrappingIndent: 'indent',
            automaticLayout: true,
            tabSize: 2,
            padding: {
              top: 8,
              bottom: 8,
            },
          }}
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
        />
      </Box>
    </Box>
  );
}
