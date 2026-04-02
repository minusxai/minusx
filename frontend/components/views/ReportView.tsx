'use client';

import { Box, Text, VStack, HStack, Input, Button, Textarea, Flex, Badge, IconButton, Portal } from '@chakra-ui/react';
import { ReportContent, ReportReference, ReportOutput, RunFileContent, JobRun } from '@/lib/types';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { LuPlay, LuClock, LuMail, LuPlus, LuTrash2, LuFileText, LuGripVertical, LuListChecks, LuHistory, LuExternalLink } from 'react-icons/lu';
import Link from 'next/link';
import { preserveParams } from '@/lib/navigation/url-utils';
import { DeliveryCard } from '@/components/shared/DeliveryPicker';
import { SchedulePicker } from '@/components/shared/SchedulePicker';
import { StatusBanner } from '@/components/shared/StatusBanner';
import { RunNowHeader, type RunOptions } from '@/components/shared/RunNowHeader';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import Markdown from '@/components/Markdown';
import { SelectRoot, SelectTrigger, SelectPositioner, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { useAppSelector } from '@/store/hooks';
import { shallowEqual } from 'react-redux';
import { selectFileEditMode, selectFileViewMode } from '@/store/uiSlice';
import { selectIsDirty, selectDashboardFiles, selectQuestionFiles } from '@/store/filesSlice';
import { createListCollection } from '@chakra-ui/react';

interface ReportViewProps {
  report: ReportContent;
  fileId: number;
  isRunning: boolean;
  runs?: JobRun[];
  selectedRunId?: number | null;
  /** Run file content (RunFileContent) for the selected run, loaded by the container */
  runFileContent?: RunFileContent | null;
  /** File ID of the selected run file, for navigation link */
  runFileId?: number;

  onChange: (updates: Partial<ReportContent>) => void;
  onRunNow: (opts: RunOptions) => Promise<void>;
  onSelectRun?: (runId: number | null) => void;
}


const referenceTypeCollection = createListCollection({
  items: [
    { value: 'question', label: 'Question' },
    { value: 'dashboard', label: 'Dashboard' },
  ]
});

export default function ReportView({
  report,
  fileId,
  isRunning,
  runs = [],
  selectedRunId,
  runFileContent,
  runFileId,
  onChange,
  onRunNow,
  onSelectRun
}: ReportViewProps) {
  const reportOutput = runFileContent?.output as ReportOutput | undefined;
  // editMode, viewMode, and isDirty sourced from Redux (managed by FileHeader)
  const editMode = useAppSelector(state => selectFileEditMode(state, fileId));
  const activeTab = useAppSelector(state => selectFileViewMode(state, fileId));
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));

  // Resizable panel state
  const [leftPanelWidth, setLeftPanelWidth] = useState(50); // percentage
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(50);
  const rafRef = useRef<number | null>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track container width for responsive layout
  useEffect(() => {
    if (!mainContentRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(mainContentRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Use compact layout when container is narrow (< 700px)
  const useCompactLayout = containerWidth > 0 && containerWidth < 700;

  // Handle panel resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = leftPanelWidth;
  }, [leftPanelWidth]);

  const handleResizeMove = useCallback((clientX: number) => {
    if (!isResizing || !mainContentRef.current) return;

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

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

  // Global mouse events for resizing
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

  // Get available dashboards and questions from Redux — memoized selectors avoid O(n) scan on every file change
  const dashboards = useAppSelector(selectDashboardFiles, shallowEqual);
  const questions = useAppSelector(selectQuestionFiles, shallowEqual);
  // By-ID dictionary for reference lookups (O(1) access)
  const files = useAppSelector(state => state.files.files);

  // Create collections for select dropdowns
  const questionCollection = useMemo(() => createListCollection({
    items: questions.map(q => ({ value: q.id.toString(), label: q.name }))
  }), [questions]);

  const dashboardCollection = useMemo(() => createListCollection({
    items: dashboards.map(d => ({ value: d.id.toString(), label: d.name }))
  }), [dashboards]);

  // Create collection for runs dropdown
  const runsCollection = useMemo(() => createListCollection({
    items: runs.map(r => ({
      value: r.id.toString(),
      label: new Date(r.created_at).toLocaleString()
    }))
  }), [runs]);

  // Reference management
  const addReference = useCallback(() => {
    const newReference: ReportReference = {
      reference: { type: 'question', id: questions[0]?.id || 0 },
      prompt: ''
    };
    onChange({ references: [...(report.references || []), newReference] });
  }, [onChange, report.references, questions]);

  const updateReference = useCallback((index: number, updates: Partial<ReportReference>) => {
    const newReferences = [...(report.references || [])];
    newReferences[index] = { ...newReferences[index], ...updates };
    onChange({ references: newReferences });
  }, [onChange, report.references]);

  const removeReference = useCallback((index: number) => {
    const newReferences = (report.references || []).filter((_, i) => i !== index);
    onChange({ references: newReferences });
  }, [onChange, report.references]);


  return (
    <Box display="flex" flexDirection="column" overflow="hidden" flex="1" minH="0" fontFamily="mono">
      {/* Status bar: Live/Draft toggle */}
      <StatusBanner
        status={report.status ?? 'draft'}
        label="report"
        runLabel="Run Now"
        editMode={editMode}
        onChange={(s) => onChange({ status: s })}
      />

      {/* JSON View */}
      {activeTab === 'json' && (
        <Box p={4} bg="bg.muted" borderRadius="md" fontFamily="mono" fontSize="sm" overflow="auto">
          <pre>{JSON.stringify(report, null, 2)}</pre>
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
          {/* Left Panel: Form */}
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
              {/* Schedule Card */}
              <SchedulePicker
                schedule={{ cron: report.schedule?.cron || '0 9 * * 1', timezone: report.schedule?.timezone || 'America/New_York' }}
                onChange={(s) => onChange({ schedule: s })}
                editMode={editMode}
              />

              {/* Analysis Card */}
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
                <Box position="absolute" left={0} top={0} bottom={0} width="3px" bg="accent.secondary" borderLeftRadius="md" />
                <HStack mb={3} justify="space-between">
                  <HStack gap={1.5}>
                    <LuListChecks size={14} color="var(--chakra-colors-accent-secondary)" />
                    <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">Analysis</Text>
                  </HStack>
                  {editMode && (
                    <Button size="xs" variant="ghost" onClick={addReference}>
                      <LuPlus size={14} />
                      Add
                    </Button>
                  )}
                </HStack>

                <VStack align="stretch" gap={2}>
                  {(report.references || []).map((q, index) => {
                    const referencedFile = files[q.reference.id];
                    const referenceName = referencedFile?.name || 'Select item...';
                    const typeMetadata = FILE_TYPE_METADATA[q.reference.type];
                    const TypeIcon = typeMetadata.icon;

                    return (
                      <Box
                        key={index}
                        position="relative"
                        borderRadius="md"
                        bg="bg.surface"
                        border="1px solid"
                        borderColor="border.muted"
                        _hover={{ bg: editMode ? 'bg.subtle' : 'bg.surface' }}
                        transition="background 0.15s ease"
                      >
                        <Box
                          position="absolute"
                          left={0}
                          top={0}
                          bottom={0}
                          width="3px"
                          bg={typeMetadata.color}
                          borderLeftRadius="md"
                        />

                        <Box pl={4} pr={3} py={3}>
                          <HStack justify="space-between" align="flex-start" mb={editMode ? 2 : (q.prompt ? 2 : 0)}>
                            <HStack gap={2} flex={1} align="center">
                              <Box color={typeMetadata.color} flexShrink={0}>
                                <TypeIcon size={14} />
                              </Box>

                              {editMode ? (
                                <HStack gap={2} flex={1}>
                                  <SelectRoot
                                    collection={referenceTypeCollection}
                                    value={[q.reference.type]}
                                    onValueChange={(e) => {
                                      const newType = e.value[0] as 'question' | 'dashboard';
                                      const defaultId = newType === 'dashboard'
                                        ? dashboards[0]?.id || 0
                                        : questions[0]?.id || 0;
                                      updateReference(index, {
                                        reference: { type: newType, id: defaultId }
                                      });
                                    }}
                                    size="sm"
                                  >
                                    <SelectTrigger
                                      bg="bg.surface"
                                      border="1px solid"
                                      borderColor="border.default"
                                      minW="100px"
                                    >
                                      <SelectValueText />
                                    </SelectTrigger>
                                    <Portal>
                                      <SelectPositioner>
                                        <SelectContent>
                                          {referenceTypeCollection.items.map((item) => (
                                            <SelectItem key={item.value} item={item}>
                                              {item.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </SelectPositioner>
                                    </Portal>
                                  </SelectRoot>

                                  <SelectRoot
                                    collection={q.reference.type === 'question' ? questionCollection : dashboardCollection}
                                    value={q.reference.id ? [q.reference.id.toString()] : []}
                                    onValueChange={(e) => updateReference(index, {
                                      reference: { ...q.reference, id: parseInt(e.value[0], 10) }
                                    })}
                                    size="sm"
                                  >
                                    <SelectTrigger
                                      bg="bg.surface"
                                      border="1px solid"
                                      borderColor="border.default"
                                      flex={1}
                                    >
                                      <SelectValueText placeholder="Select..." />
                                    </SelectTrigger>
                                    <Portal>
                                      <SelectPositioner>
                                        <SelectContent>
                                          {(q.reference.type === 'question' ? questionCollection : dashboardCollection).items.map((item) => (
                                            <SelectItem key={item.value} item={item}>
                                              {item.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </SelectPositioner>
                                    </Portal>
                                  </SelectRoot>
                                </HStack>
                              ) : (
                                <Text fontSize="sm" fontWeight="500" color="fg.default">
                                  {referenceName}
                                </Text>
                              )}
                            </HStack>

                            {editMode && (
                              <IconButton
                                size="xs"
                                variant="ghost"
                                color="fg.muted"
                                _hover={{ color: 'red.500', bg: 'red.subtle' }}
                                onClick={() => removeReference(index)}
                                aria-label="Remove"
                              >
                                <LuTrash2 size={14} />
                              </IconButton>
                            )}
                          </HStack>

                          {editMode ? (
                            <Textarea
                              value={q.prompt}
                              onChange={(e) => updateReference(index, { prompt: e.target.value })}
                              placeholder="What insights should be included?"
                              rows={2}
                              size="sm"
                              bg="bg.surface"
                              border="1px solid"
                              borderColor="border.default"
                              _placeholder={{ color: 'fg.subtle' }}
                            />
                          ) : q.prompt ? (
                            <Text
                              fontSize="xs"
                              color="fg.muted"
                              pl={5}
                              fontStyle="italic"
                              lineHeight="1.5"
                            >
                              "{q.prompt}"
                            </Text>
                          ) : null}
                        </Box>
                      </Box>
                    );
                  })}

                  {(report.references || []).length === 0 && (
                    <Box
                      py={8}
                      px={4}
                      bg="bg.surface"
                      borderRadius="md"
                      textAlign="center"
                      border="1px dashed"
                      borderColor="border.muted"
                    >
                      <Text color="fg.muted" fontSize="sm" mb={editMode ? 2 : 0}>
                        No analysis items yet
                      </Text>
                      {editMode && (
                        <Button size="sm" variant="ghost" colorPalette="teal" onClick={addReference}>
                          <LuPlus size={14} />
                          Add item
                        </Button>
                      )}
                    </Box>
                  )}
                </VStack>
              </Box>

              {/* Report Instructions Card */}
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
                <Box position="absolute" left={0} top={0} bottom={0} width="3px" bg="accent.warning" borderLeftRadius="md" />
                <HStack mb={1} gap={1.5}>
                  <LuFileText size={14} color="var(--chakra-colors-accent-warning)" />
                  <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">Report Instructions</Text>
                </HStack>
                <Text fontSize="xs" color="fg.subtle" mb={2}>
                  How to synthesize individual analyses into the final report.
                </Text>

                <Textarea
                  value={report.reportPrompt || ''}
                  onChange={(e) => onChange({ reportPrompt: e.target.value })}
                  placeholder="Summarize the key findings, highlight any anomalies or trends, and provide actionable recommendations..."
                  disabled={!editMode}
                  rows={3}
                  size="sm"
                  bg="bg.surface"
                />
              </Box>

              {/* Delivery Card */}
              <DeliveryCard
                recipients={report.recipients || []}
                onChange={(recipients) => onChange({ recipients })}
                disabled={!editMode}
              />
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
              {/* Vertical line */}
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
              {/* Center grip indicator */}
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

          {/* Right Panel: Report Runs */}
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
            <RunNowHeader
              title="Report Runs"
              runs={runs}
              selectedRunId={selectedRunId}
              onSelectRun={onSelectRun}
              isRunning={isRunning}
              disabled={isDirty || !report.references?.length}
              onRunNow={onRunNow}
              externalLinkId={runFileId}
            />

            {/* Run Content */}
            <Box flex={1} overflow="auto" p={4}>
              {isRunning ? (
                <VStack gap={4} align="center" justify="center" h="100%">
                  <Text color="fg.muted">Running report...</Text>
                </VStack>
              ) : runFileContent ? (
                <VStack align="stretch" gap={3}>
                  <HStack justify="space-between">
                    <HStack gap={2}>
                      <Badge
                        colorPalette={runFileContent.status === 'success' ? 'green' : runFileContent.status === 'failure' ? 'red' : 'yellow'}
                      >
                        {runFileContent.status}
                      </Badge>
                      <Text fontSize="xs" color="fg.muted">
                        {new Date(runFileContent.startedAt).toLocaleString()}
                      </Text>
                    </HStack>
                    {runFileId && (
                      <Link href={preserveParams(`/f/${runFileId}`)} style={{ opacity: 0.5 }}>
                        <LuExternalLink size={14} />
                      </Link>
                    )}
                  </HStack>
                  {reportOutput?.generatedReport && (
                    <Box
                      p={4}
                      bg="bg.muted"
                      borderRadius="md"
                      overflow="auto"
                      maxH="none"
                    >
                      <Markdown queries={reportOutput.queries}>
                        {reportOutput.generatedReport}
                      </Markdown>
                    </Box>
                  )}
                  {runFileContent.error && (
                    <Box p={3} bg="red.subtle" borderRadius="md" color="red.fg">
                      <Text fontSize="sm">{runFileContent.error}</Text>
                    </Box>
                  )}
                </VStack>
              ) : runs.length === 0 ? (
                <VStack gap={4} align="center" justify="center" h="100%" color="fg.muted">
                  <LuHistory size={48} opacity={0.3} />
                  <Text fontSize="sm">
                    {isDirty
                      ? 'Save your changes before running'
                      : !report.references?.length
                        ? 'Add analysis items to run the report'
                        : 'No runs yet. Click "Run Now" to test your report'
                    }
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
