'use client';

import { Box, Text, VStack, HStack, Input, Button, Flex, Badge } from '@chakra-ui/react';
import { AlertContent, AlertRunContent, AlertSelector, AlertFunction, ComparisonOperator } from '@/lib/types';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { LuPlay, LuClock, LuBell, LuMail, LuInfo, LuGripVertical, LuHistory, LuSettings, LuColumns3, LuScanSearch } from 'react-icons/lu';
import { SelectRoot, SelectTrigger, SelectPositioner, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { useAppSelector } from '@/store/hooks';
import { selectFileEditMode, selectFileViewMode } from '@/store/uiSlice';
import { selectIsDirty } from '@/store/filesSlice';
import { createListCollection } from '@chakra-ui/react';

interface AlertRun {
  id: number;
  name: string;
  content: AlertRunContent;
}

interface AlertViewProps {
  alert: AlertContent;
  fileId: number;
  isRunning: boolean;
  runs?: AlertRun[];
  selectedRunId?: number | null;

  onChange: (updates: Partial<AlertContent>) => void;
  onCheckNow: () => Promise<void>;
  onSelectRun?: (runId: number | null) => void;
}

// Cron presets (shared with ReportView)
const CRON_PRESETS = [
  { value: '0 9 * * *', label: 'Daily at 9am' },
  { value: '0 9 * * 1', label: 'Weekly on Monday' },
  { value: '0 9 * * 1-5', label: 'Weekdays at 9am' },
  { value: '0 9 1 * *', label: 'Monthly on 1st' },
  { value: '0 17 * * 5', label: 'Fridays at 5pm' },
];

const cronCollection = createListCollection({
  items: CRON_PRESETS.map(p => ({ value: p.value, label: p.label }))
});

const TIMEZONES = [
  { value: 'America/New_York', label: 'ET' },
  { value: 'America/Chicago', label: 'CT' },
  { value: 'America/Denver', label: 'MT' },
  { value: 'America/Los_Angeles', label: 'PT' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'GMT' },
  { value: 'Europe/Paris', label: 'CET' },
  { value: 'Asia/Tokyo', label: 'JST' },
  { value: 'Asia/Kolkata', label: 'IST' },
];

const timezoneCollection = createListCollection({
  items: TIMEZONES.map(tz => ({ value: tz.value, label: tz.label }))
});

const selectorCollection = createListCollection({
  items: [
    { value: 'first', label: 'First row' },
    { value: 'last', label: 'Last row' },
    { value: 'all', label: 'All rows' },
  ]
});

const FUNCTIONS_BY_SELECTOR: Record<AlertSelector, { value: string; label: string }[]> = {
  first: [
    { value: 'value', label: 'Value' },
    { value: 'diff', label: 'Change' },
    { value: 'pct_change', label: '% Change' },
    { value: 'months_ago', label: 'Months since' },
    { value: 'days_ago', label: 'Days since' },
    { value: 'years_ago', label: 'Years since' },
  ],
  last: [
    { value: 'value', label: 'Value' },
    { value: 'diff', label: 'Change' },
    { value: 'pct_change', label: '% Change' },
    { value: 'months_ago', label: 'Months since' },
    { value: 'days_ago', label: 'Days since' },
    { value: 'years_ago', label: 'Years since' },
  ],
  all: [
    { value: 'count', label: 'Count' },
    { value: 'sum', label: 'Sum' },
    { value: 'avg', label: 'Average' },
    { value: 'min', label: 'Min' },
    { value: 'max', label: 'Max' },
  ],
};

// Human-readable summary builder
function buildConditionSummary(condition: AlertContent['condition'] | undefined | null) {
  if (!condition) return null;
  const fn = condition.function;
  const col = condition.column;
  const sel = condition.selector;
  const op = condition.operator;
  const thresh = condition.threshold;
  const rowLabel = sel === 'all' ? 'all rows' : `${sel} row`;

  // Build the "what" part
  let what: string;
  if (fn === 'count') {
    what = 'row count';
  } else if (fn === 'value') {
    what = `${col} in ${rowLabel}`;
  } else if (fn === 'diff') {
    what = `change in ${col} at ${rowLabel}`;
  } else if (fn === 'pct_change') {
    what = `% change in ${col} at ${rowLabel}`;
  } else if (fn === 'months_ago') {
    what = `months since ${col} in ${rowLabel}`;
  } else if (fn === 'days_ago') {
    what = `days since ${col} in ${rowLabel}`;
  } else if (fn === 'years_ago') {
    what = `years since ${col} in ${rowLabel}`;
  } else {
    // sum, avg, min, max
    what = `${fn} of ${col} across ${rowLabel}`;
  }

  const suffix = fn === 'pct_change' ? '%' : '';
  return { what, op, thresh: `${thresh}${suffix}` };
}

const operatorCollection = createListCollection({
  items: [
    { value: '>', label: '>' },
    { value: '<', label: '<' },
    { value: '=', label: '=' },
    { value: '>=', label: '>=' },
    { value: '<=', label: '<=' },
    { value: '!=', label: '!=' },
  ]
});

export default function AlertView({
  alert,
  fileId,
  isRunning,
  runs = [],
  selectedRunId,
  onChange,
  onCheckNow,
  onSelectRun
}: AlertViewProps) {
  // editMode, viewMode, and isDirty sourced from Redux (managed by FileHeader)
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

  // Get available questions from Redux
  const files = useAppSelector(state => state.files.files);
  const questions = useMemo(() =>
    Object.values(files).filter(f => f.type === 'question' && f.id > 0),
    [files]
  );

  const questionCollection = useMemo(() => createListCollection({
    items: questions.map(q => ({ value: q.id.toString(), label: q.name }))
  }), [questions]);

  // Runs dropdown collection
  const runsCollection = useMemo(() => createListCollection({
    items: runs.map(r => ({
      value: r.id.toString(),
      label: new Date(r.content.startedAt).toLocaleString()
    }))
  }), [runs]);

  // Get selected run
  const selectedRun = runs.find(r => r.id === selectedRunId);

  // Get referenced question name
  const referencedQuestion = alert.questionId ? files[alert.questionId] : null;

  return (
    <Box display="flex" flexDirection="column" overflow="hidden" flex="1" minH="0" fontFamily="mono">
      {/* Cron not active info banner */}
      <HStack gap={2} px={4} py={2} bg="yellow.subtle" borderBottomWidth="1px" borderColor="yellow.muted" borderRadius={"md"}>
        <LuInfo size={14} color="var(--chakra-colors-yellow-fg)" />
        <Text fontSize="xs" color="yellow.fg">
          Scheduled runs are not active yet. Use <strong>Check Now</strong> to test your alert.
        </Text>
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
              {/* Question Selector Card */}
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
                  <LuScanSearch size={14} color="var(--chakra-colors-accent-primary)" />
                  <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">Source Question</Text>
                </HStack>

                {editMode ? (
                  <SelectRoot
                    collection={questionCollection}
                    value={alert.questionId ? [alert.questionId.toString()] : []}
                    onValueChange={(e) => onChange({
                      questionId: parseInt(e.value[0], 10)
                    })}
                    size="sm"
                  >
                    <SelectTrigger bg="bg.surface">
                      <SelectValueText placeholder="Select a question..." />
                    </SelectTrigger>
                    <SelectPositioner>
                      <SelectContent>
                        {questionCollection.items.map((item) => (
                          <SelectItem key={item.value} item={item}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </SelectPositioner>
                  </SelectRoot>
                ) : (
                  <Text fontSize="sm" fontWeight="600" color="fg.default">
                    {referencedQuestion?.name || (alert.questionId ? `Question #${alert.questionId}` : 'No question selected')}
                  </Text>
                )}
              </Box>

              {/* Condition Builder Card */}
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
                <HStack mb={3} gap={1.5}>
                  <LuSettings size={14} color="var(--chakra-colors-accent-warning)" />
                  <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">Condition</Text>
                </HStack>

                <VStack gap={2.5} align="stretch">
                  {/* Column */}
                  {alert.condition?.function !== 'count' && (
                    <HStack gap={2}>
                      <Text fontSize="xs" color="fg.muted" minW="65px" fontWeight="600">Column</Text>
                      <Input
                        value={alert.condition?.column || ''}
                        onChange={(e) => onChange({
                          condition: { ...alert.condition, column: e.target.value }
                        })}
                        placeholder="column_name"
                        disabled={!editMode}
                        size="sm"
                        fontFamily="mono"
                        fontSize="xs"
                        flex={1}
                        bg="bg.surface"
                      />
                    </HStack>
                  )}

                  {/* Selector */}
                  <HStack gap={2}>
                    <Text fontSize="xs" color="fg.muted" minW="65px" fontWeight="600">Rows</Text>
                    <Box flex={1}>
                      <SelectRoot
                        collection={selectorCollection}
                        value={[alert.condition?.selector || 'all']}
                        onValueChange={(e) => {
                          const newSelector = e.value[0] as AlertSelector;
                          const validFns = FUNCTIONS_BY_SELECTOR[newSelector];
                          const currentFn = alert.condition?.function;
                          const fnStillValid = validFns.some(f => f.value === currentFn);
                          onChange({
                            condition: {
                              ...alert.condition,
                              selector: newSelector,
                              function: fnStillValid ? currentFn! : validFns[0].value as AlertFunction,
                            }
                          });
                        }}
                        disabled={!editMode}
                        size="sm"
                      >
                        <SelectTrigger bg="bg.surface">
                          <SelectValueText />
                        </SelectTrigger>
                        <SelectPositioner>
                          <SelectContent>
                            {selectorCollection.items.map((item) => (
                              <SelectItem key={item.value} item={item}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </SelectPositioner>
                      </SelectRoot>
                    </Box>
                  </HStack>

                  {/* Function */}
                  <HStack gap={2}>
                    <Text fontSize="xs" color="fg.muted" minW="65px" fontWeight="600">Measure</Text>
                    <Box flex={1}>
                      {(() => {
                        const selector = alert.condition?.selector || 'all';
                        const fnItems = FUNCTIONS_BY_SELECTOR[selector];
                        const fnCollection = createListCollection({ items: fnItems });
                        return (
                          <SelectRoot
                            collection={fnCollection}
                            value={[alert.condition?.function || fnItems[0].value]}
                            onValueChange={(e) => onChange({
                              condition: { ...alert.condition, function: e.value[0] as AlertFunction }
                            })}
                            disabled={!editMode}
                            size="sm"
                          >
                            <SelectTrigger bg="bg.surface">
                              <SelectValueText />
                            </SelectTrigger>
                            <SelectPositioner>
                              <SelectContent>
                                {fnCollection.items.map((item) => (
                                  <SelectItem key={item.value} item={item}>
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </SelectPositioner>
                          </SelectRoot>
                        );
                      })()}
                    </Box>
                  </HStack>

                  {/* Operator + Threshold */}
                  <HStack gap={2}>
                    <Text fontSize="xs" color="fg.muted" minW="65px" fontWeight="600">Trigger</Text>
                    <Box flex={1}>
                      <SelectRoot
                        collection={operatorCollection}
                        value={[alert.condition?.operator || '>']}
                        onValueChange={(e) => onChange({
                          condition: { ...alert.condition, operator: e.value[0] as ComparisonOperator }
                        })}
                        disabled={!editMode}
                        size="sm"
                      >
                        <SelectTrigger bg="bg.surface">
                          <SelectValueText />
                        </SelectTrigger>
                        <SelectPositioner>
                          <SelectContent>
                            {operatorCollection.items.map((item) => (
                              <SelectItem key={item.value} item={item}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </SelectPositioner>
                      </SelectRoot>
                    </Box>
                    <Input
                      type="number"
                      value={alert.condition?.threshold ?? 0}
                      onChange={(e) => onChange({
                        condition: { ...alert.condition, threshold: parseFloat(e.target.value) || 0 }
                      })}
                      disabled={!editMode}
                      size="sm"
                      fontFamily="mono"
                      fontSize="xs"
                      flex={1}
                      bg="bg.surface"
                    />
                  </HStack>
                </VStack>

                {/* Condition summary — prose */}
                {(() => {
                  const summary = buildConditionSummary(alert.condition);
                  if (!summary) return null;
                  return (
                    <Box mt={3} p={2} bg="bg.surface" borderRadius="md" border="1px dashed" borderColor="border.muted">
                      <Text fontSize="xs" color="fg.muted">
                        Trigger when{' '}
                        <Text as="span" fontWeight="700" color="accent.warning">{summary.what}</Text>
                        {' '}<Text as="span" fontWeight="600">{summary.op}</Text>{' '}
                        <Text as="span" fontWeight="700" color="accent.warning">{summary.thresh}</Text>
                      </Text>
                    </Box>
                  );
                })()}
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
                  <Box flex={2}>
                    <SelectRoot
                      collection={cronCollection}
                      value={[alert.schedule?.cron || '0 9 * * 1']}
                      onValueChange={(e) => onChange({
                        schedule: { ...alert.schedule, cron: e.value[0] }
                      })}
                      disabled={!editMode}
                      size="sm"
                    >
                      <SelectTrigger bg="bg.surface">
                        <SelectValueText placeholder="Select schedule" />
                      </SelectTrigger>
                      <SelectPositioner>
                        <SelectContent>
                          {cronCollection.items.map((item) => (
                            <SelectItem key={item.value} item={item}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </SelectPositioner>
                    </SelectRoot>
                  </Box>

                  <Box flex={1}>
                    <Input
                      value={alert.schedule?.cron || ''}
                      onChange={(e) => onChange({
                        schedule: { ...alert.schedule, cron: e.target.value }
                      })}
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
                      onValueChange={(e) => onChange({
                        schedule: { ...alert.schedule, timezone: e.value[0] }
                      })}
                      disabled={!editMode}
                      size="sm"
                    >
                      <SelectTrigger bg="bg.surface">
                        <SelectValueText placeholder="TZ" />
                      </SelectTrigger>
                      <SelectPositioner>
                        <SelectContent>
                          {timezoneCollection.items.map((item) => (
                            <SelectItem key={item.value} item={item}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </SelectPositioner>
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

                <Input
                  value={(alert.emails || []).join(', ')}
                  onChange={(e) => onChange({
                    emails: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder="user@example.com, team@example.com"
                  disabled={!editMode}
                  size="sm"
                  bg="bg.surface"
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
                      <SelectPositioner>
                        <SelectContent>
                          {runsCollection.items.map((item) => (
                            <SelectItem key={item.value} item={item}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </SelectPositioner>
                    </SelectRoot>
                  </Box>
                )}
              </HStack>
              <Button
                onClick={onCheckNow}
                disabled={isRunning || isDirty || !alert.questionId}
                size="sm"
                colorPalette="teal"
              >
                <LuPlay size={14} />
                {isRunning ? 'Checking...' : 'Check Now'}
              </Button>
            </Flex>

            {/* Run Content */}
            <Box flex={1} overflow="auto" p={4}>
              {isRunning ? (
                <VStack gap={4} align="center" justify="center" h="100%">
                  <Text color="fg.muted">Running alert check...</Text>
                </VStack>
              ) : selectedRun ? (
                <VStack align="stretch" gap={3}>
                  <HStack justify="space-between">
                    <Badge
                      colorPalette={
                        selectedRun.content.status === 'triggered' ? 'red' :
                        selectedRun.content.status === 'not_triggered' ? 'green' :
                        selectedRun.content.status === 'failed' ? 'red' : 'yellow'
                      }
                    >
                      {selectedRun.content.status === 'triggered' ? 'TRIGGERED' :
                       selectedRun.content.status === 'not_triggered' ? 'OK' :
                       selectedRun.content.status.toUpperCase()}
                    </Badge>
                    <Text fontSize="xs" color="fg.muted">
                      {new Date(selectedRun.content.startedAt).toLocaleString()}
                    </Text>
                  </HStack>

                  {/* Result details */}
                  <Box p={3} bg="bg.muted" borderRadius="md">
                    <VStack align="stretch" gap={2}>
                      <HStack justify="space-between">
                        <Text fontSize="xs" color="fg.muted">Metric</Text>
                        <Text fontSize="xs" fontWeight="600">
                          {buildConditionSummary(selectedRun.content as unknown as AlertContent['condition'])?.what || selectedRun.content.function}
                        </Text>
                      </HStack>
                      {selectedRun.content.actualValue !== null && (
                        <HStack justify="space-between">
                          <Text fontSize="xs" color="fg.muted">Actual value</Text>
                          <Text fontSize="xs" fontWeight="600">{selectedRun.content.actualValue}</Text>
                        </HStack>
                      )}
                      <HStack justify="space-between">
                        <Text fontSize="xs" color="fg.muted">Condition</Text>
                        <Text fontSize="xs" fontWeight="600">
                          {selectedRun.content.operator} {selectedRun.content.threshold}
                        </Text>
                      </HStack>
                    </VStack>
                  </Box>

                  {selectedRun.content.error && (
                    <Box p={3} bg="red.subtle" borderRadius="md" color="red.fg">
                      <Text fontSize="sm">{selectedRun.content.error}</Text>
                    </Box>
                  )}

                  {/* Narrative summary */}
                  {selectedRun.content.status !== 'failed' && (
                    <Box
                      p={3}
                      borderRadius="md"
                      border="1px solid"
                      borderColor={selectedRun.content.status === 'triggered' ? 'red.muted' : 'green.muted'}
                      bg={selectedRun.content.status === 'triggered' ? 'red.subtle' : 'green.subtle'}
                    >
                      <Text fontSize="sm" lineHeight="1.6">
                        {(() => {
                          const r = selectedRun.content;
                          const summary = buildConditionSummary(r as unknown as AlertContent['condition']);
                          const val = r.actualValue?.toLocaleString() ?? 'N/A';
                          const suffix = r.function === 'pct_change' ? '%' : '';

                          if (r.status === 'triggered') {
                            return (
                              <>
                                The <Text as="span" fontWeight="700">{summary?.what}</Text> was{' '}
                                <Text as="span" fontWeight="700">{val}{suffix}</Text>, which is{' '}
                                <Text as="span" fontWeight="700">{r.operator} {summary?.thresh}</Text>.{' '}
                                The alert condition was met.
                              </>
                            );
                          }
                          return (
                            <>
                              The <Text as="span" fontWeight="700">{summary?.what}</Text> was{' '}
                              <Text as="span" fontWeight="700">{val}{suffix}</Text>, which does not satisfy{' '}
                              <Text as="span" fontWeight="700">{r.operator} {summary?.thresh}</Text>.{' '}
                              No action needed.
                            </>
                          );
                        })()}
                      </Text>
                    </Box>
                  )}
                </VStack>
              ) : runs.length === 0 ? (
                <VStack gap={4} align="center" justify="center" h="100%" color="fg.muted">
                  <LuBell size={48} opacity={0.3} />
                  <Text fontSize="sm">
                    {isDirty
                      ? 'Save your changes before checking'
                      : !alert.questionId
                        ? 'Select a question to monitor'
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
