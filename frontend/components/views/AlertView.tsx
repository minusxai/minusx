'use client';

import { Box, Text, VStack, HStack, Input, Button, Flex, Portal, Switch, NativeSelect } from '@chakra-ui/react';
import type { CheckedChangeDetails } from '@zag-js/switch';
import { AlertContent, JobRun, Test } from '@/lib/types';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { LuPlay, LuClock, LuBell, LuMail, LuInfo, LuGripVertical, LuHistory, LuFlaskConical } from 'react-icons/lu';
import { DeliveryPicker } from '@/components/shared/DeliveryPicker';
import { SelectRoot, SelectTrigger, SelectPositioner, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { useAppSelector } from '@/store/hooks';
import { selectFileEditMode, selectFileViewMode } from '@/store/uiSlice';
import { selectIsDirty } from '@/store/filesSlice';
import { createListCollection } from '@chakra-ui/react';
import AlertRunContainerV2 from '@/components/containers/AlertRunContainerV2';
import TestList from '@/components/test/TestList';

interface AlertViewProps {
  alert: AlertContent;
  alertName: string;
  fileId: number;
  isRunning: boolean;
  runs?: JobRun[];
  selectedRunId?: number | null;

  onChange: (updates: Partial<AlertContent>) => void;
  onCheckNow: (options?: { force?: boolean; send?: boolean }) => Promise<void>;
  onSelectRun?: (runId: number | null) => void;
}

// Cron presets (shared with ReportView)
const CRON_PRESETS = [
  { value: '0 9 * * *', label: 'Daily at 9am' },
  { value: '0 9 * * 1', label: 'Weekly on Monday' },
  { value: '0 9 * * 1-5', label: 'Weekdays at 9am' },
  { value: '0 9 1 * *', label: 'Monthly on 1st' },
  { value: '0 17 * * 5', label: 'Fridays at 5pm' },
  { value: '__custom__', label: 'Custom Schedule' },
];

const CRON_PRESET_VALUES = new Set(CRON_PRESETS.filter(p => p.value !== '__custom__').map(p => p.value));

const cronCollection = createListCollection({
  items: CRON_PRESETS.map(p => ({ value: p.value, label: p.label }))
});

const TIMEZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'Asia/Jakarta', label: 'Asia/Jakarta' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata' },
];

const timezoneCollection = createListCollection({
  items: TIMEZONES.map(tz => ({ value: tz.value, label: tz.label }))
});


export default function AlertView({
  alert,
  alertName,
  fileId,
  isRunning,
  runs = [],
  selectedRunId,
  onChange,
  onCheckNow,
  onSelectRun
}: AlertViewProps) {
  const editMode = useAppSelector(state => selectFileEditMode(state, fileId));
  const activeTab = useAppSelector(state => selectFileViewMode(state, fileId));
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));
  const isLive = (alert.status ?? 'draft') === 'live';

  const [forceRun, setForceRun] = useState(false);
  const [sendNotifications, setSendNotifications] = useState(true);

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
      <HStack gap={3} px={4} py={2} bg={isLive ? 'green.subtle' : 'yellow.subtle'} borderBottomWidth="1px" borderColor={isLive ? 'green.muted' : 'yellow.muted'} borderRadius="md">
        <LuInfo size={14} color={isLive ? 'var(--chakra-colors-green-fg)' : 'var(--chakra-colors-yellow-fg)'} />
        <Text fontSize="xs" color={isLive ? 'green.fg' : 'yellow.fg'} flex={1}>
          {isLive
            ? 'This alert is live. Scheduled runs will execute when the cron endpoint is triggered.'
            : 'Draft mode — scheduled runs are disabled. Use Check Now to test.'}
        </Text>
        <HStack gap={2}>
          <Text fontSize="xs" fontWeight="600" color={isLive ? 'green.fg' : 'yellow.fg'}>
            {isLive ? 'Live' : 'Draft'}
          </Text>
          <Switch.Root
            size="sm"
            checked={isLive}
            disabled={!editMode}
            onCheckedChange={(e: CheckedChangeDetails) => onChange({ status: e.checked ? 'live' : 'draft' })}
            colorPalette="green"
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </HStack>
      </HStack>

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
                    <NativeSelect.Root size="xs" w="120px" disabled={!editMode}>
                      <NativeSelect.Field
                        value={alert.notifyOn ?? 'any_fail'}
                        onChange={e => onChange({ notifyOn: e.target.value as 'any_fail' | 'all_fail' })}
                        fontSize="xs"
                        bg="bg.surface"
                      >
                        <option value="any_fail">any test fails</option>
                        <option value="all_fail">all tests fail</option>
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </HStack>
                </HStack>
                <TestList
                  tests={alert.tests || []}
                  onChange={(tests: Test[]) => onChange({ tests })}
                  editMode={editMode}
                />
              </Box>

              {/* Schedule Card */}
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
                <Box position="absolute" left={0} top={0} bottom={0} width="3px" bg="accent.teal" borderLeftRadius="md" />
                <HStack mb={2} gap={1.5}>
                  <LuClock size={14} color="var(--chakra-colors-accent-teal)" />
                  <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">Schedule</Text>
                </HStack>

                <HStack gap={2}>
                  <Box flex={1}>
                    <SelectRoot
                      collection={cronCollection}
                      value={[CRON_PRESET_VALUES.has(alert.schedule?.cron || '') ? (alert.schedule?.cron || '0 9 * * 1') : '__custom__']}
                      onValueChange={(e) => {
                        if (e.value[0] !== '__custom__') {
                          onChange({ schedule: { ...alert.schedule, cron: e.value[0] } });
                        }
                      }}
                      disabled={!editMode}
                      size="sm"
                    >
                      <SelectTrigger bg="bg.surface">
                        <SelectValueText placeholder="Select schedule" />
                      </SelectTrigger>
                      <Portal>
                        <SelectPositioner>
                          <SelectContent>
                            {cronCollection.items.map((item) => (
                              <SelectItem key={item.value} item={item}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </SelectPositioner>
                      </Portal>
                    </SelectRoot>
                  </Box>

                  <Box flex={1}>
                    <Input
                      value={alert.schedule?.cron || ''}
                      onChange={(e) => onChange({ schedule: { ...alert.schedule, cron: e.target.value } })}
                      placeholder="cron"
                      disabled={!editMode}
                      size="sm"
                      fontFamily="mono"
                      fontSize="xs"
                      bg="bg.surface"
                    />
                  </Box>

                  <Box flex={1}>
                    <SelectRoot
                      collection={timezoneCollection}
                      value={[alert.schedule?.timezone || 'America/New_York']}
                      onValueChange={(e) => onChange({ schedule: { ...alert.schedule, timezone: e.value[0] } })}
                      disabled={!editMode}
                      size="sm"
                    >
                      <SelectTrigger bg="bg.surface">
                        <SelectValueText placeholder="TZ" />
                      </SelectTrigger>
                      <Portal>
                        <SelectPositioner>
                          <SelectContent>
                            {timezoneCollection.items.map((item) => (
                              <SelectItem key={item.value} item={item}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </SelectPositioner>
                      </Portal>
                    </SelectRoot>
                  </Box>
                </HStack>
              </Box>

              {/* Delivery Card */}
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
                <Box position="absolute" left={0} top={0} bottom={0} width="3px" bg="accent.primary" borderLeftRadius="md" />
                <HStack mb={2} gap={1.5}>
                  <LuMail size={14} color="var(--chakra-colors-accent-primary)" />
                  <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">Delivery</Text>
                </HStack>

                <DeliveryPicker
                  recipients={alert.recipients || []}
                  onChange={(recipients) => onChange({ recipients })}
                  disabled={!editMode}
                />
              </Box>
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
                <Text fontWeight="600" fontSize="sm">Alert History</Text>
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
              <HStack gap={3}>
                <HStack gap={1.5}>
                  <Switch.Root
                    size="sm"
                    checked={forceRun}
                    onCheckedChange={(e: CheckedChangeDetails) => setForceRun(e.checked)}
                    colorPalette="orange"
                  >
                    <Switch.HiddenInput />
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Root>
                  <Text fontSize="xs" color="fg.muted">Force</Text>
                </HStack>
                <HStack gap={1.5}>
                  <Switch.Root
                    size="sm"
                    checked={sendNotifications}
                    onCheckedChange={(e: CheckedChangeDetails) => setSendNotifications(e.checked)}
                    colorPalette="teal"
                  >
                    <Switch.HiddenInput />
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Root>
                  <Text fontSize="xs" color="fg.muted">Send</Text>
                </HStack>
                <Button
                  onClick={() => onCheckNow({ force: forceRun, send: sendNotifications })}
                  disabled={(isRunning && !forceRun) || isDirty || !alert.tests?.length}
                  size="sm"
                  colorPalette="teal"
                >
                  <LuPlay size={14} />
                  {isRunning ? 'Checking...' : 'Check Now'}
                </Button>
              </HStack>
            </Flex>

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
