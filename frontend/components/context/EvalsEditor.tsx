'use client';

import {
  Box, VStack, HStack, Button, Text, Badge, Input, Textarea,
  Collapsible, Field, NativeSelect
} from '@chakra-ui/react';
import { useState } from 'react';
import { LuPlus, LuTrash2, LuChevronDown, LuChevronRight, LuPlay, LuCircleCheck, LuCircleX } from 'react-icons/lu';
import { EvalItem, EvalAssertion, EvalAppState, DatabaseWithSchema } from '@/lib/types';
import type { CompletedToolCallFromPython } from '@/lib/chat-orchestration';
import DatabaseSelector from '@/components/DatabaseSelector';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import SimpleChatMessage from '@/components/explore/SimpleChatMessage';

interface ContextInfo {
  schema: DatabaseWithSchema[];
  documentation: string;
  connection_id: string;
}

interface EvalResult {
  passed: boolean;
  details: Record<string, unknown>;
  error?: string;
  log?: CompletedToolCallFromPython[];
}

interface EvalsEditorProps {
  evals: EvalItem[];
  onChange: (evals: EvalItem[]) => void;
  contextInfo: ContextInfo;
  fileId?: number;
}

function makeDefaultEval(): EvalItem {
  return {
    question: '',
    assertion: { type: 'binary', answer: true },
    app_state: { type: 'explore' },
  };
}

function EvalTrace({ log }: { log: CompletedToolCallFromPython[] }) {
  const [open, setOpen] = useState(false);
  const [showThinking, setShowThinking] = useState(false);

  return (
    <Collapsible.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
      <Collapsible.Trigger asChild>
        <HStack gap={1} cursor="pointer" color="fg.muted" _hover={{ color: 'fg.default' }} w="fit-content">
          {open ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
          <Text fontSize="xs">Agent trace ({log.length} steps)</Text>
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <VStack gap={1} align="stretch" pt={2} pl={2} borderLeft="2px solid" borderColor="border.muted">
          {log.map((tc) => (
            <SimpleChatMessage
              key={tc.tool_call_id}
              message={tc as any}
              databaseName=""
              isCompact
              showThinking={showThinking}
              toggleShowThinking={() => setShowThinking(v => !v)}
            />
          ))}
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export default function EvalsEditor({ evals, onChange, contextInfo, fileId: _fileId }: EvalsEditorProps) {
  const [runningAll, setRunningAll] = useState(false);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, EvalResult>>({});
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const { files: questionFiles } = useFilesByCriteria({ criteria: { type: 'question' }, partial: true });

  function handleAdd() {
    const newEvals = [...evals, makeDefaultEval()];
    onChange(newEvals);
    setExpandedItems(prev => new Set([...prev, newEvals.length - 1]));
  }

  function handleDelete(index: number) {
    const newEvals = evals.filter((_, i) => i !== index);
    onChange(newEvals);
    setResults(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function handleChange(index: number, updates: Partial<EvalItem>) {
    const newEvals = evals.map((item, i) => (i === index ? { ...item, ...updates } : item));
    onChange(newEvals);
  }

  function handleAssertionTypeChange(index: number, type: string) {
    const assertion: EvalAssertion =
      type === 'binary'
        ? { type: 'binary', answer: true }
        : { type: 'number_match', answer: 0 };
    handleChange(index, { assertion });
  }

  function handleAppStateTypeChange(index: number, type: string) {
    const app_state: EvalAppState =
      type === 'explore'
        ? { type: 'explore' }
        : { type: 'file', file_id: 0 };
    handleChange(index, { app_state });
  }

  function toggleExpand(index: number) {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function runEval(index: number): Promise<EvalResult> {
    const item = evals[index];
    const response = await fetch('/api/evals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eval_item: item,
        schema: contextInfo.schema,
        documentation: contextInfo.documentation,
        connection_id: contextInfo.connection_id,
      }),
    });
    const data = await response.json();
    return data as EvalResult;
  }

  async function handleRunOne(index: number) {
    setRunningIndex(index);
    try {
      const result = await runEval(index);
      setResults(prev => ({ ...prev, [index]: result }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setResults(prev => ({ ...prev, [index]: { passed: false, details: {}, error: msg } }));
    } finally {
      setRunningIndex(null);
    }
  }

  async function handleRunAll() {
    setRunningAll(true);
    const newResults: Record<number, EvalResult> = {};
    for (let i = 0; i < evals.length; i++) {
      setRunningIndex(i);
      try {
        newResults[i] = await runEval(i);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        newResults[i] = { passed: false, details: {}, error: msg };
      }
    }
    setResults(newResults);
    setRunningIndex(null);
    setRunningAll(false);
  }

  const totalRan = Object.keys(results).length;
  const totalPassed = Object.values(results).filter(r => r.passed).length;

  return (
    <VStack gap={3} align="stretch">
      {/* Run All bar */}
      {evals.length > 0 && (
        <HStack justify="space-between">
          <HStack gap={2}>
            {totalRan > 0 && (
              <Badge colorPalette={totalPassed === totalRan ? 'green' : 'red'} variant="subtle">
                {totalPassed}/{totalRan} passed
              </Badge>
            )}
          </HStack>
          <Button
            size="sm"
            variant="outline"
            colorPalette="blue"
            onClick={handleRunAll}
            loading={runningAll}
            disabled={runningAll || evals.length === 0}
          >
            <LuPlay />
            Run All
          </Button>
        </HStack>
      )}

      {/* Eval list */}
      <VStack gap={2} align="stretch">
        {evals.map((item, index) => {
          const isExpanded = expandedItems.has(index);
          const result = results[index];
          const isRunning = runningIndex === index;

          return (
            <Box
              key={index}
              border="1px solid"
              borderColor={result ? (result.passed ? 'green.500' : 'red.500') : 'border.default'}
              borderRadius="md"
              overflow="hidden"
            >
              {/* Header */}
              <HStack
                px={3}
                py={2}
                bg="bg.muted"
                cursor="pointer"
                onClick={() => toggleExpand(index)}
                justify="space-between"
              >
                <HStack gap={2} flex={1} minW={0}>
                  {isExpanded ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
                  <Text fontSize="sm" fontWeight="600" truncate>
                    {item.question || `Eval ${index + 1}`}
                  </Text>
                </HStack>
                <HStack gap={2} onClick={e => e.stopPropagation()}>
                  <Badge size="sm" variant="outline" colorPalette="gray">
                    {item.assertion.type}
                  </Badge>
                  <Badge size="sm" variant="outline" colorPalette="gray">
                    {item.app_state.type}
                  </Badge>
                  {result && (
                    result.passed
                      ? <LuCircleCheck size={16} color="var(--chakra-colors-green-500)" />
                      : <LuCircleX size={16} color="var(--chakra-colors-red-500)" />
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    colorPalette="blue"
                    onClick={() => handleRunOne(index)}
                    loading={isRunning}
                    disabled={isRunning || runningAll}
                  >
                    <LuPlay />
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    colorPalette="red"
                    onClick={() => handleDelete(index)}
                    disabled={runningAll || isRunning}
                  >
                    <LuTrash2 />
                  </Button>
                </HStack>
              </HStack>

              {/* Expanded editor */}
              <Collapsible.Root open={isExpanded}>
                <Collapsible.Content>
                  <VStack gap={3} p={3} align="stretch">
                    {/* Question */}
                    <Field.Root>
                      <Field.Label fontSize="xs" fontWeight="600">Question</Field.Label>
                      <Textarea
                        size="sm"
                        value={item.question}
                        onChange={e => handleChange(index, { question: e.target.value })}
                        placeholder="Natural language question for the agent..."
                        rows={2}
                      />
                    </Field.Root>

                    {/* App State */}
                    <HStack gap={3} align="flex-start">
                      <Field.Root flex="0 0 140px">
                        <Field.Label fontSize="xs" fontWeight="600">App State</Field.Label>
                        <NativeSelect.Root size="sm">
                          <NativeSelect.Field
                            value={item.app_state.type}
                            onChange={e => handleAppStateTypeChange(index, e.target.value)}
                          >
                            <option value="explore">Explore</option>
                            <option value="file">File</option>
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                      </Field.Root>
                      {item.app_state.type === 'file' && (
                        <Field.Root flex={1}>
                          <Field.Label fontSize="xs" fontWeight="600">Question</Field.Label>
                          <NativeSelect.Root size="sm">
                            <NativeSelect.Field
                              value={(item.app_state as { type: 'file'; file_id: number }).file_id || ''}
                              onChange={e => handleChange(index, {
                                app_state: { type: 'file', file_id: parseInt(e.target.value) || 0 }
                              })}
                            >
                              <option value="">— select a question —</option>
                              {questionFiles.map(f => (
                                <option key={f.id} value={f.id}>
                                  {f.name || f.path}
                                </option>
                              ))}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                          </NativeSelect.Root>
                        </Field.Root>
                      )}
                    </HStack>

                    {/* Assertion */}
                    <Field.Root>
                      <Field.Label fontSize="xs" fontWeight="600">Assertion Type</Field.Label>
                      <NativeSelect.Root size="sm">
                        <NativeSelect.Field
                          value={item.assertion.type}
                          onChange={e => handleAssertionTypeChange(index, e.target.value)}
                        >
                          <option value="binary">Binary (yes/no)</option>
                          <option value="number_match">Number match</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    </Field.Root>

                    {item.assertion.type === 'binary' && (
                      <Field.Root>
                        <Field.Label fontSize="xs" fontWeight="600">Expected Answer</Field.Label>
                        <NativeSelect.Root size="sm">
                          <NativeSelect.Field
                            value={String((item.assertion as { type: 'binary'; answer: boolean }).answer)}
                            onChange={e => handleChange(index, {
                              assertion: { type: 'binary', answer: e.target.value === 'true' }
                            })}
                          >
                            <option value="true">True (yes)</option>
                            <option value="false">False (no)</option>
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                      </Field.Root>
                    )}

                    {item.assertion.type === 'number_match' && (() => {
                      const a = item.assertion as { type: 'number_match'; answer: number; question_id?: number };
                      const useQuestion = a.question_id !== undefined;
                      return (
                        <VStack gap={2} align="stretch">
                          <HStack gap={3} align="flex-start">
                            <Field.Root flex="0 0 140px">
                              <Field.Label fontSize="xs" fontWeight="600">Expected Source</Field.Label>
                              <NativeSelect.Root size="sm">
                                <NativeSelect.Field
                                  value={useQuestion ? 'question' : 'static'}
                                  onChange={e => {
                                    if (e.target.value === 'question') {
                                      handleChange(index, { assertion: { ...a, question_id: 0 } });
                                    } else {
                                      const { question_id: _, ...rest } = a;
                                      handleChange(index, { assertion: rest });
                                    }
                                  }}
                                >
                                  <option value="static">Static number</option>
                                  <option value="question">From question</option>
                                </NativeSelect.Field>
                                <NativeSelect.Indicator />
                              </NativeSelect.Root>
                            </Field.Root>
                            {useQuestion ? (
                              <Field.Root flex={1}>
                                <Field.Label fontSize="xs" fontWeight="600">Question (first cell = expected)</Field.Label>
                                <NativeSelect.Root size="sm">
                                  <NativeSelect.Field
                                    value={a.question_id ?? ''}
                                    onChange={e => handleChange(index, {
                                      assertion: { ...a, question_id: parseInt(e.target.value) || 0 }
                                    })}
                                  >
                                    <option value="">— select a question —</option>
                                    {questionFiles.map(f => (
                                      <option key={f.id} value={f.id}>
                                        {f.name || f.path}
                                      </option>
                                    ))}
                                  </NativeSelect.Field>
                                  <NativeSelect.Indicator />
                                </NativeSelect.Root>
                              </Field.Root>
                            ) : (
                              <Field.Root flex={1}>
                                <Field.Label fontSize="xs" fontWeight="600">Expected Number</Field.Label>
                                <Input
                                  size="sm"
                                  type="number"
                                  value={a.answer ?? ''}
                                  onChange={e => handleChange(index, {
                                    assertion: { ...a, answer: parseFloat(e.target.value) || 0 }
                                  })}
                                  placeholder="0"
                                />
                              </Field.Root>
                            )}
                          </HStack>
                          <Field.Root>
                            <Field.Label fontSize="xs" fontWeight="600">Connection (optional override)</Field.Label>
                            <DatabaseSelector
                              value={item.connection_id || ''}
                              onChange={val => handleChange(index, { connection_id: val || undefined })}
                            />
                          </Field.Root>
                        </VStack>
                      );
                    })()}

                    {/* Result */}
                    {result && (
                      <VStack gap={2} align="stretch">
                        <Box
                          p={2}
                          bg={result.passed ? 'green.500/10' : 'red.500/10'}
                          borderRadius="sm"
                          border="1px solid"
                          borderColor={result.passed ? 'green.500/30' : 'red.500/30'}
                        >
                          <HStack gap={2} mb={result.error || Object.keys(result.details).length > 0 ? 1 : 0}>
                            {result.passed
                              ? <LuCircleCheck size={14} color="var(--chakra-colors-green-500)" />
                              : <LuCircleX size={14} color="var(--chakra-colors-red-500)" />}
                            <Text fontSize="xs" fontWeight="600" color={result.passed ? 'green.600' : 'red.600'}>
                              {result.passed ? 'Passed' : 'Failed'}
                            </Text>
                          </HStack>
                          {(result.error || Object.keys(result.details).length > 0) && (
                            <Text fontSize="xs" fontFamily="mono" color="fg.muted" whiteSpace="pre-wrap">
                              {result.error || JSON.stringify(result.details, null, 2)}
                            </Text>
                          )}
                        </Box>
                        {result.log && result.log.length > 0 && (
                          <EvalTrace log={result.log} />
                        )}
                      </VStack>
                    )}
                  </VStack>
                </Collapsible.Content>
              </Collapsible.Root>
            </Box>
          );
        })}
      </VStack>

      {/* Add eval button */}
      <Button size="sm" variant="outline" onClick={handleAdd}>
        <LuPlus />
        Add Eval
      </Button>
    </VStack>
  );
}
