'use client';

import { Box, Text, VStack, HStack, Input, Button, Flex, Badge, Portal, Switch, Combobox } from '@chakra-ui/react';
import type { CheckedChangeDetails } from '@zag-js/switch';
import { AlertContent, AlertRecipient, AlertSelector, AlertFunction, ComparisonOperator, JobRun } from '@/lib/types';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { LuPlay, LuClock, LuBell, LuMail, LuInfo, LuGripVertical, LuHistory, LuSettings, LuScanSearch } from 'react-icons/lu';
import { DeliveryPicker } from '@/components/shared/DeliveryPicker';
import { SelectRoot, SelectTrigger, SelectPositioner, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { useAppSelector } from '@/store/hooks';
import { selectFileEditMode, selectFileViewMode } from '@/store/uiSlice';
import { selectIsDirty } from '@/store/filesSlice';
import { createListCollection } from '@chakra-ui/react';
import { useFetch } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';
import AlertRunContainerV2 from '@/components/containers/AlertRunContainerV2';

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


function QuestionSearchSelect({ questions, selectedId, onSelect }: {
  questions: { id: number; name: string }[];
  selectedId: number | null;
  onSelect: (id: number) => void;
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

  const files = useAppSelector(state => state.files.files);
  const questions = useMemo(() =>
    Object.values(files).filter(f => f.type === 'question' && f.id > 0),
    [files]
  );

  // Runs dropdown collection
  const runsCollection = useMemo(() => createListCollection({
    items: runs.map(r => ({
      value: r.id.toString(),
      label: new Date(r.created_at).toLocaleString()
    }))
  }), [runs]);

  const selectedRun = runs.find(r => r.id === selectedRunId);
  const referencedQuestion = alert.questionId ? files[alert.questionId] : null;

  // Fetch columns for selected question
  const { data: columnsData, loading: columnsLoading } = useFetch<{ questionId: number }, { columns: { name: string; type: string }[] }>(
    API.inferColumns.byQuestionId,
    alert.questionId ? { questionId: alert.questionId } : undefined,
    { enabled: !!alert.questionId }
  );
  const inferredColumns = columnsData?.columns || [];

  const columnCollection = useMemo(() => createListCollection({
    items: inferredColumns.map(c => ({ value: c.name, label: c.name }))
  }), [inferredColumns]);

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
              {/* Question Selector Card */}
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
                <Box position="absolute" left={0} top={0} bottom={0} width="3px" bg="accent.primary" borderLeftRadius="md" />
                <HStack mb={2} gap={1.5}>
                  <LuScanSearch size={14} color="var(--chakra-colors-accent-primary)" />
                  <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">Source Question</Text>
                </HStack>

                {editMode ? (
                  <QuestionSearchSelect
                    questions={questions}
                    selectedId={alert.questionId ?? null}
                    onSelect={(id) => onChange({ questionId: id })}
                  />
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
                        <Portal>
                          <SelectPositioner>
                            <SelectContent>
                              {selectorCollection.items.map((item) => (
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

                  {/* Column */}
                  {alert.condition?.function !== 'count' && (
                    <HStack gap={2}>
                      <Text fontSize="xs" color="fg.muted" minW="65px" fontWeight="600">Column</Text>
                      <Box flex={1}>
                        {inferredColumns.length > 0 ? (
                          <SelectRoot
                            collection={columnCollection}
                            value={alert.condition?.column ? [alert.condition.column] : []}
                            onValueChange={(e) => onChange({
                              condition: { ...alert.condition, column: e.value[0] }
                            })}
                            disabled={!editMode}
                            size="sm"
                          >
                            <SelectTrigger bg="bg.surface">
                              <SelectValueText placeholder={columnsLoading ? 'Loading...' : 'Select column'} />
                            </SelectTrigger>
                            <Portal>
                              <SelectPositioner>
                                <SelectContent>
                                  {columnCollection.items.map((item) => (
                                    <SelectItem key={item.value} item={item}>
                                      {item.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </SelectPositioner>
                            </Portal>
                          </SelectRoot>
                        ) : (
                          <Input
                            value={alert.condition?.column || ''}
                            onChange={(e) => onChange({
                              condition: { ...alert.condition, column: e.target.value }
                            })}
                            placeholder={columnsLoading ? 'Loading columns...' : 'column_name'}
                            disabled={!editMode}
                            size="sm"
                            fontFamily="mono"
                            fontSize="xs"
                            bg="bg.surface"
                          />
                        )}
                      </Box>
                    </HStack>
                  )}

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
                            <Portal>
                              <SelectPositioner>
                                <SelectContent>
                                  {fnCollection.items.map((item) => (
                                    <SelectItem key={item.value} item={item}>
                                      {item.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </SelectPositioner>
                            </Portal>
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
                        <Portal>
                          <SelectPositioner>
                            <SelectContent>
                              {operatorCollection.items.map((item) => (
                                <SelectItem key={item.value} item={item}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </SelectPositioner>
                        </Portal>
                      </SelectRoot>
                    </Box>
                    <Input
                      type="number"
                      defaultValue={alert.condition?.threshold ?? 0}
                      onChange={(e) => {
                        const val = e.target.valueAsNumber;
                        if (!isNaN(val)) onChange({ condition: { ...alert.condition, threshold: val } });
                      }}
                      onBlur={(e) => {
                        const val = e.target.valueAsNumber;
                        if (isNaN(val)) {
                          e.target.value = '0';
                          onChange({ condition: { ...alert.condition, threshold: 0 } });
                        }
                      }}
                      disabled={!editMode}
                      size="sm"
                      fontFamily="mono"
                      fontSize="xs"
                      flex={1}
                      bg="bg.surface"
                    />
                  </HStack>
                </VStack>

                {/* Condition summary */}
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
                  disabled={(isRunning && !forceRun) || isDirty || !alert.questionId}
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
