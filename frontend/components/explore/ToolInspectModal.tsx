'use client';

import { useState, useRef } from 'react';
import {
  Dialog,
  Portal,
  Button,
  VStack,
  HStack,
  Text,
  Box,
  Badge,
  Spinner,
  IconButton,
} from '@chakra-ui/react';
import { LuRotateCcw } from 'react-icons/lu';
import Editor from '@monaco-editor/react';
import type { ToolCall, ToolMessage } from '@/lib/types';
import { isFrontendTool, executeToolCall } from '@/lib/api/tool-handlers';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { DatabaseWithSchema } from '@/lib/types';

interface ToolInspectModalProps {
  toolCall: ToolCall;
  toolMessage: ToolMessage;
  isOpen: boolean;
  onClose: () => void;
}

function toJsonString(value: unknown): string {
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return JSON.stringify(value, null, 2);
}

interface JsonEditorProps {
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  colorMode: string;
  height?: string;
}

function JsonEditor({ value, readOnly = true, onChange, colorMode, height = '300px' }: JsonEditorProps) {
  return (
    <Box border="1px solid" borderColor="border.default" borderRadius="md" overflow="hidden">
      <Editor
        height={height}
        defaultLanguage="json"
        value={value}
        onChange={(v) => onChange?.(v ?? '')}
        theme={colorMode === 'dark' ? 'vs-dark' : 'vs-light'}
        options={{
          readOnly,
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
          padding: { top: 8, bottom: 8 },
        }}
        onMount={(_editor, monaco) => {
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
  );
}

export default function ToolInspectModal({
  toolCall,
  toolMessage,
  isOpen,
  onClose,
}: ToolInspectModalProps) {
  const dispatch = useAppDispatch();
  const reduxState = useAppSelector(state => state);
  const colorMode = useAppSelector(state => state.ui.colorMode);

  const originalArgs = JSON.stringify(toolCall.function.arguments ?? {}, null, 2);
  const [argsText, setArgsText] = useState(originalArgs);
  const [argsValid, setArgsValid] = useState(true);
  const [resultTab, setResultTab] = useState<'content' | 'details'>('content');
  const [isRunning, setIsRunning] = useState(false);
  const [rerunResult, setRerunResult] = useState<unknown>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [toolNotExecutable, setToolNotExecutable] = useState(false);
  const hasRerun = rerunResult !== null || rerunError !== null || toolNotExecutable;
  const abortRef = useRef<AbortController | null>(null);

  const handleArgsChange = (text: string) => {
    setArgsText(text);
    try {
      JSON.parse(text);
      setArgsValid(true);
    } catch {
      setArgsValid(false);
    }
  };

  const handleReset = () => {
    setArgsText(originalArgs);
    setArgsValid(true);
  };

  const handleRerun = async () => {
    if (!argsValid) return;
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(argsText);
    } catch {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsRunning(true);
    setRerunResult(null);
    setRerunError(null);
    setToolNotExecutable(false);

    const syntheticCall: ToolCall = {
      ...toolCall,
      function: { ...toolCall.function, arguments: parsedArgs as Record<string, any> },
    };

    try {
      // 1. Try frontend registry first (no network round-trip)
      if (isFrontendTool(syntheticCall.function.name)) {
        const result = await executeToolCall(
          syntheticCall,
          {} as DatabaseWithSchema,  // most frontend tools don't use database
          dispatch,
          controller.signal,
          reduxState,
        );
        setRerunResult(result.content);
        return;
      }

      // 2. Fall back to server registry via API
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: syntheticCall.function.name, args: parsedArgs }),
        signal: controller.signal,
      });

      const json = await res.json();

      if (!res.ok) {
        setRerunError(json?.error?.message ?? `HTTP ${res.status}`);
      } else if (json?.data?.error) {
        setToolNotExecutable(true);
        setRerunError(json.data.error);
      } else {
        setRerunResult(json?.data?.result ?? null);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setRerunError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsRunning(false);
    }
  };

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  const toolName = toolCall.function.name;
  const status = toolMessage.content
    ? (typeof toolMessage.content === 'string' && toolMessage.content.includes('"success":false'))
      ? 'error'
      : 'success'
    : 'unknown';

  const executionTarget = isFrontendTool(toolName) ? 'frontend' : 'server';

  return (
    <Dialog.Root open={isOpen} onOpenChange={(e) => !e.open && handleClose()} size="xl">
      <Portal>
      <Dialog.Backdrop zIndex={100000} />
      <Dialog.Positioner zIndex={100000}>
        <Dialog.Content maxW="900px" p={0} borderRadius="lg" bg="bg.surface" overflow="hidden">

          {/* Header */}
          <Dialog.Header px={5} py={4} borderBottom="1px solid" borderColor="border.default">
            <HStack gap={3}>
              <Text fontFamily="mono" fontWeight="bold" fontSize="md">{toolName}</Text>
              <Badge
                colorPalette={status === 'success' ? 'green' : status === 'error' ? 'red' : 'gray'}
                size="sm"
              >
                {status}
              </Badge>
              <Badge colorPalette={executionTarget === 'frontend' ? 'blue' : 'purple'} size="sm" variant="outline">
                {executionTarget}
              </Badge>
            </HStack>
          </Dialog.Header>

          {/* Body */}
          <Dialog.Body p={5}>
            <HStack gap={4} align="start" wrap={{ base: 'wrap', md: 'nowrap' }}>
              {/* Args Panel */}
              <VStack flex="1" align="stretch" gap={2} minW="0">
                <HStack justify="space-between">
                  <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase">
                    Arguments
                  </Text>
                  <IconButton
                    aria-label="Reset to original args"
                    size="xs"
                    variant="ghost"
                    onClick={handleReset}
                    title="Reset to original"
                  >
                    <LuRotateCcw />
                  </IconButton>
                </HStack>
                <JsonEditor
                  value={argsText}
                  readOnly={false}
                  onChange={handleArgsChange}
                  colorMode={colorMode}
                />
                {!argsValid && (
                  <Text fontSize="xs" color="red.500">Invalid JSON</Text>
                )}
              </VStack>

              {/* Result Panel */}
              <VStack flex="1" align="stretch" gap={2} minW="0">
                <HStack justify="space-between" align="center">
                  <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase">
                    Result
                  </Text>
                  <HStack gap={0} border="1px solid" borderColor="border.default" borderRadius="md" overflow="hidden">
                    {(['content', 'details'] as const).map((tab) => (
                      <Box
                        key={tab}
                        as="button"
                        px={2}
                        py={0.5}
                        fontSize="xs"
                        fontWeight="500"
                        cursor="pointer"
                        bg={resultTab === tab ? 'bg.emphasized' : 'transparent'}
                        color={resultTab === tab ? 'fg' : 'fg.muted'}
                        _hover={{ bg: 'bg.emphasized' }}
                        onClick={() => setResultTab(tab)}
                        textTransform="capitalize"
                      >
                        {tab}
                      </Box>
                    ))}
                  </HStack>
                </HStack>
                <JsonEditor
                  value={resultTab === 'content' ? toJsonString(toolMessage.content) : toJsonString(toolMessage.details ?? null)}
                  colorMode={colorMode}
                />

                {hasRerun && (
                  <>
                    <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" mt={2}>
                      Re-run Result
                    </Text>
                    {rerunError ? (
                      <Box p={3} bg="red.50" _dark={{ bg: 'red.900/20' }} borderRadius="md" border="1px solid" borderColor="red.200">
                        <Text fontSize="xs" color="red.600" _dark={{ color: 'red.400' }} fontFamily="mono">
                          {rerunError}
                        </Text>
                      </Box>
                    ) : (
                      <JsonEditor value={toJsonString(rerunResult)} colorMode={colorMode} />
                    )}
                  </>
                )}
              </VStack>
            </HStack>
          </Dialog.Body>

          {/* Footer */}
          <Dialog.Footer px={5} py={4} borderTop="1px solid" borderColor="border.default">
            <HStack gap={3} justify="flex-end" w="full">
              <Button variant="ghost" onClick={handleClose} size="sm">
                Close
              </Button>
              <Button
                onClick={handleRerun}
                disabled={!argsValid || isRunning}
                size="sm"
                bg="accent.teal"
                color="white"
                _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                minW="90px"
              >
                {isRunning ? <Spinner size="xs" /> : 'Re-run'}
              </Button>
            </HStack>
          </Dialog.Footer>

          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
