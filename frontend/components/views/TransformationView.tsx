'use client';

import { Box, Text, VStack, HStack, Input, Button, Flex, Portal, Combobox } from '@chakra-ui/react';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { LuPlay, LuHistory, LuArrowRightLeft, LuPlus, LuTrash2, LuGripVertical, LuExternalLink } from 'react-icons/lu';
import Link from 'next/link';
import { preserveParams } from '@/lib/navigation/url-utils';
import { useAppSelector } from '@/store/hooks';
import { selectFileEditMode, selectFileViewMode } from '@/store/uiSlice';
import { selectIsDirty } from '@/store/filesSlice';
import { createListCollection } from '@chakra-ui/react';
import type { JobRun, QuestionContent, Transform, TransformationContent } from '@/lib/types';
import { SelectRoot, SelectTrigger, SelectPositioner, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { useContext } from '@/lib/hooks/useContext';
import { useFile } from '@/lib/hooks/file-state-hooks';
import TransformationRunContainerV2 from '@/components/containers/TransformationRunContainerV2';

interface TransformationViewProps {
  transformation: TransformationContent;
  transformationName: string;
  fileId: number;
  isRunning: boolean;
  runs?: JobRun[];
  selectedRunId?: number | null;
  onChange: (updates: Partial<TransformationContent>) => void;
  onRunNow: () => Promise<void>;
  onSelectRun?: (runId: number | null) => void;
}

/* ------------------------------------------------------------------ */
/*  Question picker (searchable combobox)                               */
/* ------------------------------------------------------------------ */

function QuestionSearchSelect({ questions, selectedId, onSelect, disabled }: {
  questions: { id: number; name: string }[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  disabled?: boolean;
}) {
  const [inputValue, setInputValue] = useState('');

  const filteredCollection = useMemo(() => {
    const lower = inputValue.toLowerCase();
    const filtered = lower
      ? questions.filter(q => q.name.toLowerCase().includes(lower))
      : questions;
    return createListCollection({
      items: filtered.map(q => ({ value: q.id.toString(), label: q.name }))
    });
  }, [questions, inputValue]);

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
      disabled={disabled}
    >
      <Combobox.Control>
        <Combobox.Input placeholder="Search questions..." bg="bg.surface" fontSize="xs" />
      </Combobox.Control>
      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>No questions found</Combobox.Empty>
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

/* ------------------------------------------------------------------ */
/*  Schema picker — dropdown from connection if available, else input   */
/* ------------------------------------------------------------------ */

function SchemaSelect({ value, schemas, onChange, disabled }: {
  value: string;
  schemas: string[];
  onChange: (schema: string) => void;
  disabled?: boolean;
}) {
  const [inputValue, setInputValue] = useState(value);

  // Keep local input in sync when value changes externally (e.g. after question change)
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const filteredCollection = useMemo(() => {
    const lower = inputValue.toLowerCase();
    const filtered = lower
      ? schemas.filter(s => s.toLowerCase().includes(lower))
      : schemas;
    return createListCollection({
      items: filtered.map(s => ({ value: s, label: s }))
    });
  }, [schemas, inputValue]);

  if (schemas.length === 0) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="target_schema"
        disabled={disabled}
        size="sm"
        fontFamily="mono"
        fontSize="xs"
        bg="bg.surface"
      />
    );
  }

  return (
    <Combobox.Root
      collection={filteredCollection}
      value={value ? [value] : []}
      onValueChange={(e) => {
        if (e.value[0]) {
          onChange(e.value[0]);
          setInputValue(e.value[0]);
        }
      }}
      onInputValueChange={(details) => {
        setInputValue(details.inputValue);
        // Allow free-text entry
        onChange(details.inputValue);
      }}
      inputBehavior="autohighlight"
      openOnClick
      positioning={{ gutter: 2 }}
      size="sm"
      disabled={disabled}
    >
      <Combobox.Control>
        <Combobox.Input
          placeholder="Select or type schema..."
          bg="bg.surface"
          fontSize="xs"
          fontFamily="mono"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            onChange(e.target.value);
          }}
        />
      </Combobox.Control>
      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>No schemas found</Combobox.Empty>
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

/* ------------------------------------------------------------------ */
/*  Single transform row                                                */
/* ------------------------------------------------------------------ */

function TransformRow({ transform, index, questions, dbSchemaMap, editMode, onChange, onDelete }: {
  transform: Transform;
  index: number;
  questions: { id: number; name: string }[];
  dbSchemaMap: Record<string, string[]>;
  editMode: boolean;
  onChange: (updates: Partial<Transform>) => void;
  onDelete: () => void;
}) {
  const selectedQuestion = questions.find(q => q.id === transform.question);

  // Load the selected question's full content to get database_name
  const { fileState: questionFile } = useFile(transform.question > 0 ? transform.question : undefined) ?? {};
  const dbName = (questionFile?.content as QuestionContent | null)?.database_name;
  const schemas = dbName ? (dbSchemaMap[dbName] ?? []) : [];

  return (
    <Box
      position="relative"
      bg="bg.muted"
      borderRadius="md"
      border="1px solid"
      borderColor="border.muted"
      p={3}
      pl={5}
      overflow="hidden"
    >
      <Box position="absolute" left={0} top={0} bottom={0} width="3px" bg="accent.success" borderLeftRadius="md" />

      <HStack mb={2} justify="space-between">
        <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
          Transform {index + 1}
        </Text>
        {editMode && (
          <Button
            size="xs"
            variant="ghost"
            colorPalette="red"
            onClick={onDelete}
            aria-label="Delete transform"
          >
            <LuTrash2 size={12} />
          </Button>
        )}
      </HStack>

      <VStack gap={2} align="stretch">
        {/* Question picker */}
        <HStack gap={2}>
          <Text fontSize="xs" color="fg.muted" minW="65px" fontWeight="600">Question</Text>
          <Box flex={1}>
            {editMode ? (
              <QuestionSearchSelect
                questions={questions}
                selectedId={transform.question || null}
                onSelect={(id) => onChange({ question: id })}
              />
            ) : (
              <Text fontSize="xs" color="fg.default" fontWeight="500">
                {selectedQuestion?.name || (transform.question ? `Question #${transform.question}` : 'No question selected')}
              </Text>
            )}
          </Box>
        </HStack>

        {/* Output schema — dropdown if connection schema available, else plain input */}
        <HStack gap={2}>
          <Text fontSize="xs" color="fg.muted" minW="65px" fontWeight="600">Schema</Text>
          <Box flex={1}>
            {editMode ? (
              <SchemaSelect
                value={transform.output?.schema_name ?? ''}
                schemas={schemas}
                onChange={(schema) => onChange({ output: { ...transform.output, schema_name: schema } })}
              />
            ) : (
              <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="500">
                {transform.output?.schema_name || <Text as="span" color="fg.muted">—</Text>}
              </Text>
            )}
          </Box>
        </HStack>

        {/* Output view name */}
        <HStack gap={2}>
          <Text fontSize="xs" color="fg.muted" minW="65px" fontWeight="600">View</Text>
          <Box flex={1}>
            <Input
              value={transform.output?.view ?? ''}
              onChange={(e) => onChange({ output: { ...transform.output, view: e.target.value } })}
              placeholder="view_name"
              disabled={!editMode}
              size="sm"
              fontFamily="mono"
              fontSize="xs"
              bg="bg.surface"
            />
          </Box>
        </HStack>

        {/* Preview SQL */}
        {transform.question > 0 && transform.output?.schema_name && transform.output?.view && (
          <Box p={2} bg="bg.surface" borderRadius="sm" border="1px solid" borderColor="border.muted">
            <Text fontSize="xs" fontFamily="mono" color="fg.muted" lineClamp={2}>
              CREATE OR REPLACE VIEW &quot;{transform.output.schema_name}&quot;.&quot;{transform.output.view}&quot; AS ...
            </Text>
          </Box>
        )}
      </VStack>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  TransformationView                                                  */
/* ------------------------------------------------------------------ */

export default function TransformationView({
  transformation,
  transformationName: _transformationName,
  fileId,
  isRunning,
  runs = [],
  selectedRunId,
  onChange,
  onRunNow,
  onSelectRun,
}: TransformationViewProps) {
  const editMode = useAppSelector(state => selectFileEditMode(state, fileId));
  const activeTab = useAppSelector(state => selectFileViewMode(state, fileId));
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));

  // Resizable panel state
  const [leftPanelWidth, setLeftPanelWidth] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(50);
  const rafRef = useRef<number | null>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!mainContentRef.current) return;
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    resizeObserver.observe(mainContentRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const useCompactLayout = containerWidth > 0 && containerWidth < 700;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = leftPanelWidth;
  }, [leftPanelWidth]);

  const handleResizeMove = useCallback((clientX: number) => {
    if (!isResizing || !mainContentRef.current) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!mainContentRef.current) return;
      const containerRect = mainContentRef.current.getBoundingClientRect();
      const deltaX = clientX - resizeStartX.current;
      const deltaPercent = (deltaX / containerRect.width) * 100;
      const newWidth = Math.max(30, Math.min(70, resizeStartWidth.current + deltaPercent));
      setLeftPanelWidth(newWidth);
    });
  }, [isResizing]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => handleResizeMove(e.clientX);
    const handleMouseUp = handleResizeEnd;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  const files = useAppSelector(state => state.files.files);
  const filePath = useAppSelector(state => state.files.files[fileId]?.path) ?? '';

  const questions = useMemo(() =>
    Object.values(files).filter(f => f.type === 'question' && f.id > 0),
    [files]
  );

  // Use context (same source as RightSidebar) to get schemas per database
  const { databases } = useContext(filePath);
  const dbSchemaMap = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const db of databases ?? []) {
      result[db.databaseName] = db.schemas.map((s: { schema: string }) => s.schema);
    }
    return result;
  }, [databases]);

  const transforms = transformation.transforms ?? [];

  const handleAddTransform = useCallback(() => {
    onChange({
      transforms: [
        ...transforms,
        { question: 0, output: { schema_name: '', view: '' } },
      ],
    });
  }, [transforms, onChange]);

  const handleUpdateTransform = useCallback((index: number, updates: Partial<Transform>) => {
    const updated = transforms.map((t, i) =>
      i === index ? { ...t, ...updates, output: { ...t.output, ...(updates.output ?? {}) } } : t
    );
    onChange({ transforms: updated });
  }, [transforms, onChange]);

  const handleDeleteTransform = useCallback((index: number) => {
    onChange({ transforms: transforms.filter((_, i) => i !== index) });
  }, [transforms, onChange]);

  const runsCollection = useMemo(() => createListCollection({
    items: runs.map(r => ({
      value: r.id.toString(),
      label: new Date(r.created_at).toLocaleString(),
    })),
  }), [runs]);

  const selectedRun = runs.find(r => r.id === selectedRunId);

  const canRun = !isDirty && !isRunning && transforms.length > 0;

  return (
    <Box display="flex" flexDirection="column" overflow="hidden" flex="1" minH="0" fontFamily="mono">
      {/* JSON View */}
      {activeTab === 'json' && (
        <Box p={4} bg="bg.muted" borderRadius="md" fontFamily="mono" fontSize="sm" overflow="auto">
          <pre>{JSON.stringify(transformation, null, 2)}</pre>
        </Box>
      )}

      {/* Visual View - Two Column Layout */}
      {activeTab === 'visual' && (
        <Box
          ref={mainContentRef}
          display="flex"
          flexDirection={!useCompactLayout ? 'row' : 'column'}
          flex={1}
          overflow="hidden"
          minHeight="0"
        >
          {/* Left Panel: Transform list */}
          <Box
            display="flex"
            flexDirection="column"
            flexShrink={0}
            width={!useCompactLayout ? `calc(${leftPanelWidth}% - 8px)` : '100%'}
            minWidth={!useCompactLayout ? '300px' : undefined}
            overflow="auto"
            bg="bg.surface"
            borderRadius={!useCompactLayout ? 'lg' : undefined}
            my={!useCompactLayout ? 2 : 0}
            ml={!useCompactLayout ? 2 : 0}
            border={!useCompactLayout ? '1px solid' : undefined}
            borderColor="border.muted"
          >
            <VStack gap={3} align="stretch" p={4}>
              {transforms.length === 0 ? (
                <Box p={4} textAlign="center" color="fg.muted">
                  <LuArrowRightLeft size={32} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
                  <Text fontSize="sm">No transforms yet.</Text>
                  {editMode && (
                    <Text fontSize="xs" mt={1}>Click &quot;Add Transform&quot; to get started.</Text>
                  )}
                </Box>
              ) : (
                transforms.map((transform, index) => (
                  <TransformRow
                    key={index}
                    transform={transform}
                    index={index}
                    questions={questions}
                    dbSchemaMap={dbSchemaMap}
                    editMode={!!editMode}
                    onChange={(updates) => handleUpdateTransform(index, updates)}
                    onDelete={() => handleDeleteTransform(index)}
                  />
                ))
              )}

              {editMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddTransform}
                  width="full"
                >
                  <LuPlus size={14} />
                  Add Transform
                </Button>
              )}
            </VStack>
          </Box>

          {/* Resize Handle */}
          {!useCompactLayout && (
            <Box
              role="group"
              width="16px"
              cursor="col-resize"
              display="flex"
              alignItems="center"
              justifyContent="center"
              position="relative"
              onMouseDown={handleResizeStart}
              flexShrink={0}
              zIndex={10}
              userSelect="none"
            >
              <Box
                position="absolute"
                top="0"
                bottom="0"
                width="2px"
                bg={isResizing ? 'accent.teal' : 'border.muted'}
                _groupHover={{ bg: 'accent.teal' }}
                transition="all 0.15s ease"
                borderRadius="full"
              />
              <Box
                position="absolute"
                top="50%"
                transform="translateY(-50%)"
                display="flex"
                alignItems="center"
                justifyContent="center"
                width="20px"
                height="40px"
                bg={isResizing ? 'accent.teal' : 'bg.emphasized'}
                _groupHover={{ bg: 'accent.teal' }}
                borderRadius="md"
                transition="all 0.15s ease"
                boxShadow="sm"
              >
                <Box
                  as={LuGripVertical}
                  fontSize="sm"
                  color={isResizing ? 'white' : 'fg.muted'}
                  _groupHover={{ color: 'white' }}
                  transition="color 0.15s ease"
                />
              </Box>
            </Box>
          )}

          {/* Right Panel: Run history */}
          <Box
            flex={1}
            display="flex"
            flexDirection="column"
            minHeight="75vh"
            overflow="hidden"
            bg="bg.surface"
            borderRadius={!useCompactLayout ? 'lg' : undefined}
            my={!useCompactLayout ? 2 : 0}
            mr={!useCompactLayout ? 2 : 0}
            border={!useCompactLayout ? '1px solid' : undefined}
            borderColor="border.muted"
          >
            {/* Run Header */}
            <Flex
              justify="space-between"
              align="center"
              px={4}
              py={3}
              borderBottomWidth="1px"
              borderColor="border.muted"
              gap={2}
            >
              <HStack flex={1} gap={2}>
                <LuHistory size={16} />
                <Text fontWeight="600" fontSize="sm">Run History</Text>
                {runs.length > 0 && (
                  <Box flex={1} maxW="200px">
                    <SelectRoot
                      collection={runsCollection}
                      value={selectedRunId ? [selectedRunId.toString()] : []}
                      onValueChange={(e) => onSelectRun?.(e.value[0] ? parseInt(e.value[0], 10) : null)}
                      size="sm"
                    >
                      <SelectTrigger>
                        <SelectValueText placeholder="Select run..." />
                      </SelectTrigger>
                      <Portal>
                        <SelectPositioner>
                          <SelectContent>
                            {runsCollection.items.map((item) => (
                              <SelectItem key={item.value} item={item}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </SelectPositioner>
                      </Portal>
                    </SelectRoot>
                  </Box>
                )}
              </HStack>
              <HStack gap={2}>
                {selectedRun?.output_file_id && (
                  <Link href={preserveParams(`/f/${selectedRun.output_file_id}`)}>
                    <Button size="sm" variant="ghost" colorPalette="gray">
                      <LuExternalLink size={14} />
                    </Button>
                  </Link>
                )}
                <Button
                  onClick={onRunNow}
                  disabled={!canRun}
                  size="sm"
                  colorPalette="teal"
                >
                  <LuPlay size={14} />
                  {isRunning ? 'Running...' : 'Run Now'}
                </Button>
              </HStack>
            </Flex>

            {/* Run Content */}
            <Box flex={1} overflow="auto" p={4}>
              {isRunning ? (
                <VStack gap={4} align="center" justify="center" h="100%">
                  <Text color="fg.muted">Running transformations...</Text>
                </VStack>
              ) : selectedRun ? (
                selectedRun.output_file_id ? (
                  <TransformationRunContainerV2 fileId={selectedRun.output_file_id} inline />
                ) : (
                  <VStack gap={2} align="center" justify="center" h="100%" color="fg.muted">
                    <Text fontSize="sm">Run in progress...</Text>
                  </VStack>
                )
              ) : runs.length === 0 ? (
                <VStack gap={4} align="center" justify="center" h="100%" color="fg.muted">
                  <LuArrowRightLeft size={48} opacity={0.3} />
                  <Text fontSize="sm">
                    {isDirty
                      ? 'Save your changes before running'
                      : transforms.length === 0
                        ? 'Add transforms to get started'
                        : 'No runs yet. Click "Run Now" to execute your transforms.'}
                  </Text>
                </VStack>
              ) : (
                <VStack gap={4} align="center" justify="center" h="100%" color="fg.muted">
                  <Text fontSize="sm">Select a run to view details</Text>
                </VStack>
              )}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
