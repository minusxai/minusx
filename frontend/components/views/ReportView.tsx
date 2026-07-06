'use client';

import { Box, Text, VStack, HStack, Badge } from '@chakra-ui/react';
import { ReportContent, ReportOutput, RunFileContent, JobRun, DatabaseWithSchema } from '@/lib/types';
import LexicalTextEditor, { LexicalTextViewer } from '@/components/lexical/LexicalTextEditor';
import { useState, useCallback, useRef, useEffect } from 'react';
import { LuFileText, LuGripVertical, LuHistory, LuExternalLink } from 'react-icons/lu';
import Link from 'next/link';
import { preserveParams } from '@/lib/navigation/url-utils';
import { DeliveryCard } from '@/components/shared/DeliveryPicker';
import { SchedulePicker } from '@/components/shared/SchedulePicker';
import { StatusBanner } from '@/components/shared/StatusBanner';
import { RunNowHeader, type RunOptions } from '@/components/shared/RunNowHeader';
import Markdown from '@/components/Markdown';

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
  /** Context databases for the report's path — powers @-mention of tables/columns. */
  whitelistedSchemas?: DatabaseWithSchema[];
  editMode: boolean;
  isDirty: boolean;

  onChange: (updates: Partial<ReportContent>) => void;
  onRunNow: (opts: RunOptions) => Promise<void>;
  onSelectRun?: (runId: number | null) => void;
}


export default function ReportView({
  report,
  fileId,
  isRunning,
  runs = [],
  selectedRunId,
  runFileContent,
  runFileId,
  whitelistedSchemas,
  editMode,
  isDirty,
  onChange,
  onRunNow,
  onSelectRun
}: ReportViewProps) {
  const reportOutput = runFileContent?.output as ReportOutput | undefined;

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

  const hasPrompt = !!report.reportPrompt?.trim();

  return (
    // data-file-id → standard FileView capture (useScreenshot / Dev Tools "Download Image").
    <Box data-file-id={fileId} display="flex" flexDirection="column" overflow="hidden" flex="1" minH="0" fontFamily="mono">
      {/* Status bar: Live/Draft toggle */}
      <StatusBanner
        status={report.status ?? 'draft'}
        label="report"
        runLabel="Run Now"
        editMode={editMode}
        onChange={(s) => onChange({ status: s })}
        suppressUntil={report.suppressUntil}
        onSuppressChange={(val) => onChange({ suppressUntil: val })}
      />

      {/* Visual View - Two Column Layout (the Code view is rendered upstream by FileView) */}
      {(
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

              {/* Report Instructions Card — single freeform prompt. The agent
                  finds the relevant questions/data itself from this text. */}
              <Box
                bg="bg.muted"
                borderRadius="md"
                border="1px solid"
                borderColor="border.muted"
                p={3}
              >
                <HStack mb={1} gap={1.5}>
                  <LuFileText size={14} color="var(--chakra-colors-accent-warning)" />
                  <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">Instructions</Text>
                </HStack>
                <Text fontSize="xs" color="fg.subtle" mb={2}>
                </Text>

                <Box
                  aria-label="Report instructions"
                  height="240px"
                  bg="bg.surface"
                  borderRadius="md"
                  border="1px solid"
                  borderColor="border.default"
                  overflow="hidden"
                >
                  {editMode ? (
                    <LexicalTextEditor
                      key={`report-prompt-${fileId}`}
                      initialMarkdown={report.reportPrompt || ''}
                      onChange={(markdown) => onChange({ reportPrompt: markdown })}
                      mentions={{ whitelistedSchemas }}
                    />
                  ) : (
                    <LexicalTextViewer markdown={report.reportPrompt || ''} padding="12px 16px" />
                  )}
                </Box>
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
              disabled={isDirty || !hasPrompt}
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
                <VStack aria-label="No report runs" gap={4} align="center" justify="center" h="100%" color="fg.muted">
                  <LuHistory size={48} opacity={0.3} />
                  <Text fontSize="sm">
                    {isDirty
                      ? 'Save your changes before running'
                      : !hasPrompt
                        ? 'Add report instructions to run the report'
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
