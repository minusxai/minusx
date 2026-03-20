'use client';

import {
  Box, VStack, HStack, Button, Text, Badge, Input, Textarea,
  Collapsible, Field, NativeSelect, Table, IconButton, Combobox, Portal, createListCollection
} from '@chakra-ui/react';
import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { LuPlus, LuTrash2, LuChevronDown, LuChevronRight, LuPlay, LuCircleCheck, LuCircleX, LuMinus } from 'react-icons/lu';
import { EvalItem, EvalAssertion, EvalAppState, DatabaseWithSchema } from '@/lib/types';
import type { CompletedToolCallFromPython } from '@/lib/chat-orchestration';
import DatabaseSelector from '@/components/DatabaseSelector';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { useAppSelector } from '@/store/hooks';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import SimpleChatMessage from '@/components/explore/SimpleChatMessage';
import Editor from '@monaco-editor/react';

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

function formatExpected(assertion: EvalAssertion): string {
  if (assertion.cannot_answer) return 'N/A';
  if (assertion.type === 'binary') {
    return assertion.answer ? 'True' : 'False';
  }
  if (assertion.type === 'number_match') {
    if (assertion.question_id !== undefined) {
      return assertion.column ? `Q#${assertion.question_id}.${assertion.column}` : `Q#${assertion.question_id}`;
    }
    return String(assertion.answer);
  }
  return '—';
}

/** Textarea that buffers keystrokes locally and flushes to parent on blur. */
function BufferedTextarea({ value, onCommit, ...props }: { value: string; onCommit: (v: string) => void } & Omit<React.ComponentProps<typeof Textarea>, 'value' | 'onChange' | 'onBlur'>) {
  const [local, setLocal] = useState(value);
  const localRef = useRef(local);

  useEffect(() => { localRef.current = local; }, [local]);

  // Sync from parent when the external value changes (e.g. undo, reset)
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <Textarea
      {...props}
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (localRef.current !== value) onCommit(localRef.current); }}
    />
  );
}

/** Searchable file selector (reused for questions and dashboards) */
function FileSearchSelect({ files, selectedId, onSelect, placeholder }: {
  files: { id: number; name: string }[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  placeholder?: string;
}) {
  const [inputValue, setInputValue] = useState('');

  const filteredCollection = useMemo(() => {
    const lower = inputValue.toLowerCase();
    const filtered = lower
      ? files.filter(f => f.name.toLowerCase().includes(lower))
      : files;
    return createListCollection({
      items: filtered.map(f => ({ value: f.id.toString(), label: f.name }))
    });
  }, [files, inputValue]);

  return (
    <Combobox.Root
      collection={filteredCollection}
      value={selectedId ? [selectedId.toString()] : []}
      onValueChange={(e) => {
        if (e.value[0]) onSelect(parseInt(e.value[0], 10));
      }}
      onInputValueChange={(details) => setInputValue(details.inputValue)}
      inputBehavior="autohighlight"
      openOnClick
      positioning={{ gutter: 2 }}
      size="sm"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={placeholder || 'Search...'} bg="bg.surface" fontSize="xs" onClick={e => e.stopPropagation()} />
      </Combobox.Control>
      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>No results found</Combobox.Empty>
            {filteredCollection.items.map((item) => (
              <Combobox.Item key={item.value} item={item}>
                <Combobox.ItemText>{item.label}</Combobox.ItemText>
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}

function EvalTrace({ log }: { log: CompletedToolCallFromPython[] }) {
  const [open, setOpen] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const colorMode = useAppSelector((state) => state.ui.colorMode);

  const stepsJson = useMemo(() => {
    const steps = log.map((tc) => ({
      tool: tc.function.name,
      args: tc.function.arguments,
      result: tc.content,
    }));
    return JSON.stringify(steps, null, 2);
  }, [log]);

  return (
    <Collapsible.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
      <HStack gap={3} onClick={e => e.stopPropagation()}>
        <Collapsible.Trigger asChild>
          <HStack gap={1} cursor="pointer" color="fg.muted" _hover={{ color: 'fg.default' }} w="fit-content">
            {open ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
            <Text fontSize="xs">Agent trace ({log.length} steps)</Text>
          </HStack>
        </Collapsible.Trigger>
        {open && (
          <Button
            size="2xs"
            variant={showThinking ? 'subtle' : 'outline'}
            colorPalette="gray"
            onClick={() => setShowThinking(v => !v)}
            fontSize="2xs"
          >
            {showThinking ? 'Hide Thinking' : 'Show Thinking'}
          </Button>
        )}
      </HStack>
      <Collapsible.Content>
        <HStack
          gap={0}
          align="stretch"
          mt={2}
          border="1px solid"
          borderColor="border.muted"
          borderRadius="sm"
          overflow="hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Left: rendered tool calls */}
          <Box flex={1} maxH="400px" overflowY="auto" p={2} borderRight="1px solid" borderColor="border.muted" minW="300px">
            <VStack gap={1} align="stretch">
              {log.map((tc, idx) => (
                <SimpleChatMessage
                  key={`${tc.role}-${idx}-${(tc as any).tool_call_id || ''}`}
                  message={tc as any}
                  databaseName=""
                  isCompact
                  showThinking={showThinking}
                  toggleShowThinking={() => setShowThinking(v => !v)}
                />
              ))}
            </VStack>
          </Box>
          {/* Right: JSON in Monaco */}
          <Box flex={1} minH="200px" maxH="400px">
            <Editor
              height="400px"
              language="json"
              value={stepsJson}
              theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                wordWrap: 'on',
                lineNumbers: 'off',
                fontSize: 12,
                fontFamily: 'JetBrains Mono, monospace',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                folding: true,
                tabSize: 2,
              }}
            />
          </Box>
        </HStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function AppStateBadge({ appState }: { appState: EvalAppState }) {
  const filesState = useAppSelector(state => state.files.files);

  const isExplore = appState.type === 'explore';
  const fileId = isExplore ? undefined : (appState as { type: 'file'; file_id: number }).file_id;
  const file = fileId !== undefined ? filesState[fileId] : undefined;
  const fileType = (isExplore ? 'explore' : file?.type || 'question') as any;
  const metadata = getFileTypeMetadata(fileType);
  const TypeIcon = metadata?.icon;
  const displayName = isExplore ? 'Explore' : (file?.name || `#${fileId}`);

  return (
    <HStack
      gap={1}
      fontFamily="mono"
      fontSize="2xs"
      fontWeight="600"
      color="white"
      px={1.5}
      py={0.5}
      bg={metadata?.color || 'accent.primary'}
      borderRadius="sm"
      w="fit-content"
    >
      {TypeIcon && <TypeIcon size={10} />}
      <Text truncate maxW="120px">{displayName}</Text>
    </HStack>
  );
}

export default function EvalsEditor({ evals, onChange, contextInfo, fileId: _fileId }: EvalsEditorProps) {
  const [runningAll, setRunningAll] = useState(false);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, EvalResult>>({});
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  // Inferred columns per eval index (keyed by question_id to avoid redundant fetches)
  const [inferredColumns, setInferredColumns] = useState<Record<number, { questionId: number; columns: string[] }>>({});

  const filesState = useAppSelector(state => state.files.files);
  const { files: questionFiles } = useFilesByCriteria({ criteria: { type: 'question' }, partial: true });
  const { files: dashboardFiles } = useFilesByCriteria({ criteria: { type: 'dashboard' }, partial: true });

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

  async function fetchColumnsForQuestion(evalIndex: number, questionId: number) {
    if (inferredColumns[evalIndex]?.questionId === questionId) return; // already fetched
    try {
      const res = await fetch('/api/infer-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId }),
      });
      const data = await res.json();
      const cols: string[] = (data.columns ?? []).map((c: { name: string }) => c.name);
      setInferredColumns(prev => ({ ...prev, [evalIndex]: { questionId, columns: cols } }));
    } catch {
      // best-effort; column picker just won't populate
    }
  }

  function handleAssertionTypeChange(index: number, type: string) {
    const assertion: EvalAssertion =
      type === 'binary'
        ? { type: 'binary', answer: true }
        : { type: 'number_match', answer: 0 };
    handleChange(index, { assertion });
  }

  // Track the UI-level app state type per eval (explore/question/dashboard)
  // Initialized from the actual file type in Redux
  const [appStateUiTypes, setAppStateUiTypes] = useState<Record<number, 'explore' | 'question' | 'dashboard'>>({});

  function getAppStateUiType(index: number, appState: EvalAppState): 'explore' | 'question' | 'dashboard' {
    if (appStateUiTypes[index]) return appStateUiTypes[index];
    if (appState.type === 'explore') return 'explore';
    const fileId = (appState as { type: 'file'; file_id: number }).file_id;
    const file = filesState[fileId];
    if (file?.type === 'dashboard') return 'dashboard';
    return 'question';
  }

  function handleAppStateTypeChange(index: number, uiType: string) {
    setAppStateUiTypes(prev => ({ ...prev, [index]: uiType as 'explore' | 'question' | 'dashboard' }));
    const app_state: EvalAppState =
      uiType === 'explore'
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
      {/* Header bar */}
      <HStack justify="space-between">
        <HStack gap={2}>
          <Text fontSize="sm" color="fg.muted">
            Test questions with expected answers to validate context quality
          </Text>
          {totalRan > 0 && (
            <Badge colorPalette={totalPassed === totalRan ? 'green' : 'red'} variant="subtle">
              {totalPassed}/{totalRan} passed
            </Badge>
          )}
        </HStack>
        {evals.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            colorPalette="teal"
            onClick={handleRunAll}
            loading={runningAll}
            disabled={runningAll || evals.length === 0}
          >
            <LuPlay />
            Run All
          </Button>
        )}
      </HStack>

      {/* Eval table */}
      {evals.length > 0 && (
        <Box overflowX="auto" border="1px solid" borderColor="border.default" borderRadius="md">
          <Table.Root size="sm" tableLayout="fixed">
            <Table.Header>
              <Table.Row bg="bg.muted">
                <Table.ColumnHeader w="36px" textAlign="center" fontFamily="mono" fontSize="2xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="wider">#</Table.ColumnHeader>
                <Table.ColumnHeader w="300px" fontSize="2xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="wider">Question</Table.ColumnHeader>
                <Table.ColumnHeader w="110px" fontSize="2xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="wider">Type</Table.ColumnHeader>
                <Table.ColumnHeader w="90px" fontSize="2xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="wider">Expected</Table.ColumnHeader>
                <Table.ColumnHeader w="110px" fontSize="2xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="wider">App State</Table.ColumnHeader>
                <Table.ColumnHeader w="50px" textAlign="center" fontSize="2xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="wider">Status</Table.ColumnHeader>
                <Table.ColumnHeader w="70px" textAlign="center" fontSize="2xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="wider">Actions</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {evals.map((item, index) => {
                const isExpanded = expandedItems.has(index);
                const result = results[index];
                const isRunning = runningIndex === index;

                return (
                  <Fragment key={index}>
                    <Table.Row
                      cursor="pointer"
                      onClick={() => toggleExpand(index)}
                      _hover={{ bg: 'bg.muted' }}
                      {...(result ? { borderLeftWidth: '3px', borderLeftColor: result.details?.cannot_answer ? 'gray.400' : result.passed ? 'green.500' : 'red.500' } : {})}
                    >
                      <Table.Cell textAlign="center" fontFamily="mono" fontSize="xs" color="fg.muted" py={2}>
                        {index + 1}
                      </Table.Cell>
                      <Table.Cell py={2} maxW="300px">
                        <HStack gap={1.5}>
                          {isExpanded ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
                          <Text fontSize="sm" truncate>
                            {item.question || <Text as="span" color="fg.muted" fontStyle="italic">Untitled eval</Text>}
                          </Text>
                        </HStack>
                      </Table.Cell>
                      <Table.Cell py={2}>
                        <Badge
                          size="xs"
                          variant="subtle"
                          colorPalette={item.assertion.type === 'binary' ? 'purple' : 'blue'}
                          fontFamily="mono"
                        >
                          {item.assertion.type === 'binary' ? 'binary' : 'number'}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell py={2}>
                        <Text fontSize="xs" fontFamily="mono" fontWeight="600">{formatExpected(item.assertion)}</Text>
                      </Table.Cell>
                      <Table.Cell py={2}>
                        <AppStateBadge appState={item.app_state} />
                      </Table.Cell>
                      <Table.Cell textAlign="center" py={2}>
                        {result ? (
                          result.details?.cannot_answer
                            ? <LuMinus size={16} color="var(--chakra-colors-gray-400)" />
                            : result.passed
                              ? <LuCircleCheck size={16} color="var(--chakra-colors-green-500)" />
                              : <LuCircleX size={16} color="var(--chakra-colors-red-500)" />
                        ) : (
                          <Text fontSize="xs" color="fg.subtle">—</Text>
                        )}
                      </Table.Cell>
                      <Table.Cell textAlign="center" py={2} onClick={e => e.stopPropagation()}>
                        <HStack gap={0.5} justify="center">
                          <IconButton
                            aria-label="Run eval"
                            size="2xs"
                            variant="ghost"
                            colorPalette="teal"
                            onClick={() => handleRunOne(index)}
                            loading={isRunning}
                            disabled={isRunning || runningAll}
                          >
                            <LuPlay />
                          </IconButton>
                          <IconButton
                            aria-label="Delete eval"
                            size="2xs"
                            variant="ghost"
                            colorPalette="red"
                            onClick={() => handleDelete(index)}
                            disabled={runningAll || isRunning}
                          >
                            <LuTrash2 />
                          </IconButton>
                        </HStack>
                      </Table.Cell>
                    </Table.Row>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <Table.Row>
                        <Table.Cell colSpan={7} p={0}>
                          <Box px={3} py={2} bg="bg.subtle" borderTop="1px solid" borderColor="border.muted">
                            <VStack gap={2} align="stretch">
                              {/* Row 1: Question textarea */}
                              <Field.Root>
                                <Field.Label fontSize="2xs" fontWeight="600">Question</Field.Label>
                                <BufferedTextarea
                                  size="xs"
                                  value={item.question}
                                  onCommit={v => handleChange(index, { question: v })}
                                  placeholder="Natural language question for the agent..."
                                  rows={1}
                                  onClick={e => e.stopPropagation()}
                                />
                              </Field.Root>

                              {/* Row 2: App State + file selector + Connection */}
                              <HStack gap={3} align="flex-end">
                                <Field.Root flex="0 0 120px">
                                  <Field.Label fontSize="2xs" fontWeight="600">App State</Field.Label>
                                  <NativeSelect.Root size="xs">
                                    <NativeSelect.Field
                                      value={getAppStateUiType(index, item.app_state)}
                                      onChange={e => handleAppStateTypeChange(index, e.target.value)}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <option value="explore">Explore</option>
                                      <option value="question">Question</option>
                                      <option value="dashboard">Dashboard</option>
                                    </NativeSelect.Field>
                                    <NativeSelect.Indicator />
                                  </NativeSelect.Root>
                                </Field.Root>
                                {item.app_state.type === 'file' && getAppStateUiType(index, item.app_state) === 'question' && (
                                  <Field.Root flex={1}>
                                    <Field.Label fontSize="2xs" fontWeight="600">Question</Field.Label>
                                    <FileSearchSelect
                                      files={questionFiles}
                                      selectedId={(item.app_state as { type: 'file'; file_id: number }).file_id || null}
                                      onSelect={(id) => handleChange(index, { app_state: { type: 'file', file_id: id } })}
                                      placeholder="Search questions..."
                                    />
                                  </Field.Root>
                                )}
                                {item.app_state.type === 'file' && getAppStateUiType(index, item.app_state) === 'dashboard' && (
                                  <Field.Root flex={1}>
                                    <Field.Label fontSize="2xs" fontWeight="600">Dashboard</Field.Label>
                                    <FileSearchSelect
                                      files={dashboardFiles}
                                      selectedId={(item.app_state as { type: 'file'; file_id: number }).file_id || null}
                                      onSelect={(id) => handleChange(index, { app_state: { type: 'file', file_id: id } })}
                                      placeholder="Search dashboards..."
                                    />
                                  </Field.Root>
                                )}
                                <Field.Root flex="0 0 160px">
                                  <Field.Label fontSize="2xs" fontWeight="600">Connection (optional)</Field.Label>
                                  <DatabaseSelector
                                    value={item.connection_id || ''}
                                    onChange={val => handleChange(index, { connection_id: val || undefined })}
                                  />
                                </Field.Root>
                              </HStack>

                              {/* Row 3: Assertion type + expected value */}
                              <HStack gap={3} align="flex-end">
                                <Field.Root flex="0 0 140px">
                                  <Field.Label fontSize="2xs" fontWeight="600">Assertion</Field.Label>
                                  <NativeSelect.Root size="xs">
                                    <NativeSelect.Field
                                      value={item.assertion.type}
                                      onChange={e => handleAssertionTypeChange(index, e.target.value)}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <option value="binary">Binary (yes/no)</option>
                                      <option value="number_match">Number match</option>
                                    </NativeSelect.Field>
                                    <NativeSelect.Indicator />
                                  </NativeSelect.Root>
                                </Field.Root>
                                {item.assertion.type === 'binary' && (
                                  <Field.Root flex="0 0 140px">
                                    <Field.Label fontSize="2xs" fontWeight="600">Expected</Field.Label>
                                    <NativeSelect.Root size="xs">
                                      <NativeSelect.Field
                                        value={item.assertion.cannot_answer ? 'cannot_answer' : String(item.assertion.answer)}
                                        onChange={e => {
                                          if (e.target.value === 'cannot_answer') {
                                            handleChange(index, { assertion: { type: 'binary', answer: true, cannot_answer: true } });
                                          } else {
                                            handleChange(index, { assertion: { type: 'binary', answer: e.target.value === 'true' } });
                                          }
                                        }}
                                        onClick={e => e.stopPropagation()}
                                      >
                                        <option value="true">True (yes)</option>
                                        <option value="false">False (no)</option>
                                        <option value="cannot_answer">Cannot answer</option>
                                      </NativeSelect.Field>
                                      <NativeSelect.Indicator />
                                    </NativeSelect.Root>
                                  </Field.Root>
                                )}
                                {item.assertion.type === 'number_match' && (() => {
                                  const a = item.assertion as { type: 'number_match'; answer: number; question_id?: number; column?: string; cannot_answer?: true };
                                  const useQuestion = !a.cannot_answer && a.question_id !== undefined;
                                  const sourceValue = a.cannot_answer ? 'cannot_answer' : useQuestion ? 'question' : 'static';
                                  return (
                                    <>
                                      <Field.Root flex="0 0 140px">
                                        <Field.Label fontSize="2xs" fontWeight="600">Source</Field.Label>
                                        <NativeSelect.Root size="xs">
                                          <NativeSelect.Field
                                            value={sourceValue}
                                            onChange={e => {
                                              if (e.target.value === 'cannot_answer') {
                                                handleChange(index, { assertion: { type: 'number_match', answer: 0, cannot_answer: true } });
                                              } else if (e.target.value === 'question') {
                                                handleChange(index, { assertion: { type: 'number_match', answer: 0, question_id: 0 } });
                                              } else {
                                                handleChange(index, { assertion: { type: 'number_match', answer: 0 } }); // clears question_id and column
                                              }
                                            }}
                                            onClick={e => e.stopPropagation()}
                                          >
                                            <option value="static">Static number</option>
                                            <option value="question">From question</option>
                                            <option value="cannot_answer">Cannot answer</option>
                                          </NativeSelect.Field>
                                          <NativeSelect.Indicator />
                                        </NativeSelect.Root>
                                      </Field.Root>
                                      {!a.cannot_answer && (useQuestion ? (
                                        <>
                                          <Field.Root flex={1}>
                                            <Field.Label fontSize="2xs" fontWeight="600">Question</Field.Label>
                                            <NativeSelect.Root size="xs">
                                              <NativeSelect.Field
                                                value={a.question_id ?? ''}
                                                onChange={e => {
                                                  const qid = parseInt(e.target.value) || 0;
                                                  handleChange(index, { assertion: { ...a, question_id: qid, column: undefined } });
                                                  if (qid) fetchColumnsForQuestion(index, qid);
                                                }}
                                                onFocus={() => { if (a.question_id) fetchColumnsForQuestion(index, a.question_id); }}
                                                onClick={e => e.stopPropagation()}
                                              >
                                                <option value="">— select —</option>
                                                {questionFiles.map(f => (
                                                  <option key={f.id} value={f.id}>{f.name || f.path}</option>
                                                ))}
                                              </NativeSelect.Field>
                                              <NativeSelect.Indicator />
                                            </NativeSelect.Root>
                                          </Field.Root>
                                          <Field.Root flex="0 0 140px">
                                            <Field.Label fontSize="2xs" fontWeight="600">Column</Field.Label>
                                            <NativeSelect.Root size="xs">
                                              <NativeSelect.Field
                                                value={a.column ?? ''}
                                                onChange={e => handleChange(index, {
                                                  assertion: { ...a, column: e.target.value || undefined }
                                                })}
                                                onClick={e => e.stopPropagation()}
                                                _disabled={{ opacity: 0.5 }}
                                                aria-disabled={!inferredColumns[index]?.columns.length}
                                              >
                                                <option value="">— first column —</option>
                                                {(inferredColumns[index]?.columns ?? []).map(col => (
                                                  <option key={col} value={col}>{col}</option>
                                                ))}
                                              </NativeSelect.Field>
                                              <NativeSelect.Indicator />
                                            </NativeSelect.Root>
                                          </Field.Root>
                                        </>
                                      ) : (
                                        <Field.Root flex="0 0 100px">
                                          <Field.Label fontSize="2xs" fontWeight="600">Expected</Field.Label>
                                          <Input
                                            size="xs"
                                            type="number"
                                            value={a.answer ?? ''}
                                            onChange={e => handleChange(index, {
                                              assertion: { ...a, answer: parseFloat(e.target.value) || 0 }
                                            })}
                                            onClick={e => e.stopPropagation()}
                                            placeholder="0"
                                          />
                                        </Field.Root>
                                      ))}
                                    </>
                                  );
                                })()}
                              </HStack>

                              {/* Result */}
                              {result && (
                                <VStack gap={1} align="stretch">
                                  {result.details?.cannot_answer ? (
                                    <Box
                                      px={2}
                                      py={1.5}
                                      bg="gray.500/10"
                                      borderRadius="sm"
                                      border="1px solid"
                                      borderColor="gray.500/30"
                                    >
                                      <HStack gap={2}>
                                        <LuMinus size={12} color="var(--chakra-colors-gray-400)" />
                                        <Text fontSize="xs" fontWeight="600" color="fg.muted">
                                          Cannot Answer
                                        </Text>
                                        <Text fontSize="2xs" fontFamily="mono" color="fg.muted" truncate>
                                          {result.details.reason as string}
                                        </Text>
                                      </HStack>
                                    </Box>
                                  ) : (
                                    <Box
                                      px={2}
                                      py={1.5}
                                      bg={result.passed ? 'green.500/10' : 'red.500/10'}
                                      borderRadius="sm"
                                      border="1px solid"
                                      borderColor={result.passed ? 'green.500/30' : 'red.500/30'}
                                    >
                                      <HStack gap={2}>
                                        {result.passed
                                          ? <LuCircleCheck size={12} color="var(--chakra-colors-green-500)" />
                                          : <LuCircleX size={12} color="var(--chakra-colors-red-500)" />}
                                        <Text fontSize="xs" fontWeight="600" color={result.passed ? 'green.600' : 'red.600'}>
                                          {result.passed ? 'Passed' : 'Failed'}
                                        </Text>
                                        {(result.error || Object.keys(result.details).length > 0) && (
                                          <Text fontSize="2xs" fontFamily="mono" color="fg.muted" truncate>
                                            {result.error || JSON.stringify(result.details)}
                                          </Text>
                                        )}
                                      </HStack>
                                    </Box>
                                  )}
                                  {result.log && result.log.length > 0 && (
                                    <EvalTrace log={result.log} />
                                  )}
                                </VStack>
                              )}
                            </VStack>
                          </Box>
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Fragment>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Box>
      )}

      {/* Add eval button */}
      <Button size="sm" variant="outline" colorPalette="teal" onClick={handleAdd}>
        <LuPlus />
        Add Eval
      </Button>
    </VStack>
  );
}
