'use client';

import { Box, Text, VStack, HStack, Input, Button, Flex, Portal, Switch } from '@chakra-ui/react';
import type { CheckedChangeDetails } from '@zag-js/switch';
import { AlertContent, JobRun, Test } from '@/lib/types';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { LuPlay, LuClock, LuBell, LuMail, LuGripVertical, LuHistory, LuFlaskConical } from 'react-icons/lu';
import { DeliveryCard } from '@/components/shared/DeliveryPicker';
import { SchedulePicker } from '@/components/shared/SchedulePicker';
import { StatusBanner } from '@/components/shared/StatusBanner';
import { RunNowHeader, type RunOptions } from '@/components/shared/RunNowHeader';
import { SelectRoot, SelectTrigger, SelectPositioner, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { useAppSelector } from '@/store/hooks';
import { selectFileEditMode, selectFileViewMode } from '@/store/uiSlice';
import { selectIsDirty } from '@/store/filesSlice';
import { createListCollection } from '@chakra-ui/react';
import AlertRunContainerV2 from '@/components/containers/AlertRunContainerV2';
import TestList from '@/components/test/TestList';
import SimpleSelect from '@/components/test/SimpleSelect';

interface AlertViewProps {
  alert: AlertContent;
  alertName: string;
  fileId: number;
  isRunning: boolean;
  runs?: JobRun[];
  selectedRunId?: number | null;

  onChange: (updates: Partial<AlertContent>) => void;
  onRunNow: (opts: RunOptions) => Promise<void>;
  onSelectRun?: (runId: number | null) => void;
}



export default function AlertView({
  alert,
  alertName,
  fileId,
  isRunning,
  runs = [],
  selectedRunId,
  onChange,
  onRunNow,
  onSelectRun
}: AlertViewProps) {
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

  // Runs dropdown collection
  const runsCollection = useMemo(() => createListCollection({
    items: runs.map(r => ({
      value: r.id.toString(),
      label: new Date(r.created_at).toLocaleString()
    }))
  }), [runs]);

  const selectedRun = runs.find(r => r.id === selectedRunId) ?? runs[0] ?? null;

  return (
    <Box display="flex" flexDirection="column" overflow="hidden" flex="1" minH="0" fontFamily="mono">
      {/* Status bar: Live/Draft toggle + cron info */}
      <StatusBanner
        status={alert.status ?? 'draft'}
        label="alert"
        runLabel="Check Now"
        editMode={editMode}
        onChange={(s) => onChange({ status: s })}
        suppressUntil={alert.suppressUntil}
        onSuppressChange={(val) => onChange({ suppressUntil: val })}
      />

      {/* JSON View */}
      {activeTab === 'json' && (
        <Box p={4} bg="bg.muted" borderRadius="md" fontFamily="mono" fontSize="sm" overflow="auto">
          <pre>{JSON.stringify(alert, null, 2)}</pre>
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
              {/* Tests Card */}
              <Box
                position="relative"
                bg="bg.muted"
                borderRadius="md"
                border="1px solid"
                borderColor="border.muted"
                pt={3}
                pb={2}
                pr={3}
                pl={5}
                overflow="hidden"
              >
                <Box position="absolute" left={0} top={0} bottom={0} width="3px" bg="accent.warning" borderLeftRadius="md" />
                <HStack mb={2} gap={1.5} justify="space-between">
                  <HStack gap={1.5}>
                    <LuFlaskConical size={14} color="var(--chakra-colors-accent-warning)" />
                    <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">Tests</Text>
                  </HStack>
                  <HStack gap={2}>
                    <Text fontSize="xs" color="fg.muted">Notify when</Text>
                    <Box w="180px">
                      <SimpleSelect
                        value={alert.notifyOn ?? 'any_fail'}
                        onChange={v => onChange({ notifyOn: v as 'any_fail' | 'all_fail' })}
                        options={[
                          { value: 'any_fail', label: 'any test fails' },
                          { value: 'all_fail', label: 'all tests fail' },
                        ]}
                        disabled={!editMode}
                        size="sm"
                      />
                    </Box>
                  </HStack>
                </HStack>
                <TestList
                  tests={alert.tests || []}
                  onChange={(tests: Test[]) => onChange({ tests })}
                  editMode={editMode}
                />
              </Box>

              {/* Schedule Card */}
              <SchedulePicker
                schedule={{ cron: alert.schedule?.cron || '0 9 * * 1', timezone: alert.schedule?.timezone || 'America/New_York' }}
                onChange={(s) => onChange({ schedule: s })}
                editMode={editMode}
              />

              {/* Delivery Card */}
              <DeliveryCard
                recipients={alert.recipients || []}
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

          {/* Right Panel: Alert Runs */}
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
              title="Alert History"
              runs={runs}
              selectedRunId={selectedRunId}
              onSelectRun={onSelectRun}
              isRunning={isRunning}
              disabled={isDirty || !alert.tests?.length}
              onRunNow={onRunNow}
              buttonLabel="Check Now"
              runningLabel="Checking..."
            />

            {/* Run Content */}
            <Box flex={1} overflow="auto" p={4}>
              {isRunning ? (
                <VStack gap={4} align="center" justify="center" h="100%">
                  <Text color="fg.muted">Running alert check...</Text>
                </VStack>
              ) : selectedRun ? (
                selectedRun.output_file_id ? (
                  <AlertRunContainerV2 fileId={selectedRun.output_file_id} inline />
                ) : (
                  <VStack gap={2} align="center" justify="center" h="100%" color="fg.muted">
                    <Text fontSize="sm">Run in progress...</Text>
                  </VStack>
                )
              ) : runs.length === 0 ? (
                <VStack gap={4} align="center" justify="center" h="100%" color="fg.muted">
                  <LuBell size={48} opacity={0.3} />
                  <Text fontSize="sm">
                    {isDirty
                      ? 'Save your changes before checking'
                      : !alert.tests?.length
                        ? 'Add tests to monitor'
                        : 'No checks yet. Click "Check Now" to test your alert'
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
