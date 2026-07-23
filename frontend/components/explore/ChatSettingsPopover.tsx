'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  HStack,
  Icon,
  Popover,
  Portal,
  Text,
} from '@chakra-ui/react';
import type { IconType } from 'react-icons';
import {
  LuBookOpen,
  LuBot,
  LuBrainCircuit,
  LuChevronDown,
  LuDatabase,
  LuGauge,
  LuSettings2,
  LuSparkles,
  LuZap,
} from 'react-icons/lu';
import { useConnections } from '@/lib/hooks/useConnections';
import { useContexts } from '@/lib/hooks/useContexts';
import { useAppSelector } from '@/store/hooks';
import { isAdmin } from '@/lib/auth/role-helpers';
import { useStableCallback } from '@/lib/hooks/use-stable-callback';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type { ContextContent } from '@/lib/types';
import type { ChatGradeCatalog, LlmGrade } from '@/lib/llm/llm-config-types';
import {
  SearchableSelect,
  type SearchableOption,
} from '@/components/selectors/SearchableSelect';
import {
  buildContextSelectorOptions,
  findHomeContext,
  getSelectableContextFiles,
  parseContextSelectorValue,
  resolveContextSelectorValue,
} from './context-selector-options';

const DEFAULT_GRADE = '__default_grade__';

/** Display metadata for the grade picker (grade ids stay lowercase in
 *  config/wire). GRADES ONLY — never provider/model identity: which model a
 *  grade resolves to is a behind-the-scenes workspace concern. */
const GRADE_META: Record<LlmGrade, { label: string; icon: IconType; description: string }> = {
  lite: {
    label: 'Lite',
    icon: LuZap,
    description: 'Fastest and lightest — quick lookups and small edits.',
  },
  core: {
    label: 'Core',
    icon: LuGauge,
    description: 'Optimized for most tasks — fast, dependable analysis.',
  },
  advanced: {
    label: 'Advanced',
    icon: LuSparkles,
    description: 'A more powerful model for the hardest questions — slower and uses ~2x more tokens.',
  },
};
const GRADE_LABELS: Record<LlmGrade, string> = { lite: 'Lite', core: 'Core', advanced: 'Advanced' };

export interface ChatSettingsPopoverProps {
  databaseName: string;
  onDatabaseChange: (name: string) => void;
  selectedGrade: LlmGrade | null;
  onGradeChange: (grade: LlmGrade | null) => void;
  modelDisabled?: boolean;
  selectedContextPath?: string | null;
  selectedVersion?: number;
  onContextChange: (contextPath: string | null, version?: number) => void;
  onOpenChange?: (open: boolean) => void;
  compactSummary?: boolean;
}

type ComboboxOption = SearchableOption;

const ANALYST_AGENT = 'analyst';
const AGENT_OPTIONS: ComboboxOption[] = [
  {
    value: ANALYST_AGENT,
    label: 'Analyst agent',
    subtitle: 'Default assistant',
    badge: 'Default',
  },
  {
    value: 'custom',
    label: 'Specialized agents',
    subtitle: '',
    badge: 'Coming soon',
    disabled: true,
  },
];

function SettingsCombobox({
  options,
  value,
  onChange,
  label,
  placeholder,
  disabled = false,
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <SearchableSelect
      options={options}
      value={value}
      onChange={onChange}
      label={label}
      placeholder={placeholder}
      size="sm"
      disabled={disabled}
      fontFamily="mono"
      positionerZIndex={2300}
    />
  );
}

export default function ChatSettingsPopover({
  databaseName,
  onDatabaseChange,
  selectedGrade,
  onGradeChange,
  modelDisabled = false,
  selectedContextPath,
  selectedVersion,
  onContextChange,
  onOpenChange,
  compactSummary = false,
}: ChatSettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<ChatGradeCatalog | null>(null);
  const stableOnContextChange = useStableCallback(onContextChange);
  const user = useAppSelector((state) => state.auth.user);
  const canChooseContext = !!user && isAdmin(user.role);
  const mode = user?.mode ?? 'org';
  const homeFolder = user ? resolveHomeFolderSync(mode, user.home_folder || '') : '';
  const { connections, loading: connectionsLoading } = useConnections({ skip: true });
  const { contexts, homeContext, loading: contextsLoading } = useContexts();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/llm/chat-models', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && body?.data?.defaultGrade && Array.isArray(body.data.grades)) {
          setCatalog(body.data as ChatGradeCatalog);
        }
      })
      .catch(() => { /* The workspace default grade remains available without catalog metadata. */ });
    return () => { cancelled = true; };
  }, []);

  const databaseOptions = useMemo(() => {
    const names = Object.values(connections).map((connection) => connection.metadata.name);
    if (databaseName && !names.includes(databaseName)) names.push(databaseName);
    return names.sort((a, b) => a.localeCompare(b));
  }, [connections, databaseName]);

  const selectableContexts = useMemo(() => {
    const sources = contexts.map((context) => (
      homeContext?.id === context.id ? homeContext : context
    ));
    return getSelectableContextFiles(sources, homeFolder, mode);
  }, [contexts, homeContext, homeFolder, mode]);
  const homeSelectableContext = useMemo(
    () => findHomeContext(selectableContexts, homeFolder),
    [selectableContexts, homeFolder],
  );
  const rawContextOptions = useMemo(
    () => buildContextSelectorOptions(selectableContexts),
    [selectableContexts],
  );
  const contextOptions = useMemo((): ComboboxOption[] => rawContextOptions.map((option) => ({
    value: option.value,
    label: option.label,
    subtitle: option.subtitle,
    badge: option.showCheckmark ? 'Published' : undefined,
  })), [rawContextOptions]);
  const selectedContextValue = useMemo(
    () => resolveContextSelectorValue(rawContextOptions, selectedContextPath ?? null, selectedVersion),
    [rawContextOptions, selectedContextPath, selectedVersion],
  );

  useEffect(() => {
    if (selectedContextPath || !homeSelectableContext) return;
    const content = homeSelectableContext.content as ContextContent | undefined;
    const publishedVersion = content?.published?.all;
    if (publishedVersion) stableOnContextChange(homeSelectableContext.path, publishedVersion);
  }, [homeSelectableContext, selectedContextPath, stableOnContextChange]);

  const modelOptions = useMemo(() => {
    const defaultMeta = catalog ? GRADE_META[catalog.defaultGrade] : undefined;
    const options: ComboboxOption[] = [{
      value: DEFAULT_GRADE,
      label: defaultMeta?.label ?? 'Default',
      icon: defaultMeta?.icon,
      description: defaultMeta?.description ?? 'Follows Settings → Models',
      badge: 'recommended',
      group: 'Workspace default',
    }];

    for (const option of catalog?.grades ?? []) {
      if (option.grade === catalog?.defaultGrade) continue;
      const meta = GRADE_META[option.grade];
      options.push({
        value: option.grade,
        label: meta.label,
        icon: meta.icon,
        description: option.configured ? meta.description : 'Not configured for this workspace.',
        disabled: !option.configured,
      });
    }

    if (selectedGrade && selectedGrade !== catalog?.defaultGrade && !options.some((o) => o.value === selectedGrade)) {
      options.push({ value: selectedGrade, label: GRADE_LABELS[selectedGrade], group: 'Selected override' });
    }

    return options;
  }, [catalog, selectedGrade]);

  // The default grade selects the sentinel (an explicit pick of the default is
  // the same as no override — the workspace default stays authoritative).
  const selectedModelValue = selectedGrade && selectedGrade !== catalog?.defaultGrade ? selectedGrade : DEFAULT_GRADE;
  const modelSummary = selectedGrade
    ? GRADE_LABELS[selectedGrade]
    : (catalog ? GRADE_LABELS[catalog.defaultGrade] : 'Default');
  const databaseComboboxOptions = useMemo(
    () => databaseOptions.map((name) => ({ value: name, label: name })),
    [databaseOptions],
  );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(details) => {
        setOpen(details.open);
        onOpenChange?.(details.open);
      }}
      positioning={{ placement: 'top-start', gutter: 8 }}
      lazyMount
      unmountOnExit
    >
      <Popover.Trigger asChild>
        <Button
          aria-label="Chat settings"
          variant="ghost"
          size="xs"
          h="28px"
          minW={0}
          maxW={compactSummary ? '100%' : '440px'}
          flexShrink={1}
          overflow="hidden"
          px={compactSummary ? 1.5 : 2}
          gap={compactSummary ? 1 : 1.5}
          bg={compactSummary ? 'bg.muted' : undefined}
          color="fg.muted"
          fontWeight="500"
          fontFamily="mono"
          justifyContent="flex-start"
          _hover={{ bg: 'bg.muted', color: 'fg.default' }}
          _open={{ bg: 'bg.muted', color: 'fg.default' }}
          data-compact-summary={compactSummary}
        >
          <Icon as={LuSettings2} boxSize={3.5} flexShrink={0} />
          <Text
            truncate
            fontSize="xs"
            minW={0}
            maxW={compactSummary ? '90px' : '120px'}
            flexShrink={1}
            title={databaseName || 'No database'}
          >
            {databaseName || 'No database'}
          </Text>
          <Text aria-hidden="true" fontSize="xs" color="fg.subtle" flexShrink={0}>·</Text>
          {!compactSummary && <Icon as={LuBot} boxSize={3.5} color="fg.subtle" flexShrink={0} />}
          <Text
            truncate
            fontSize="xs"
            minW={0}
            maxW="100px"
            flexShrink={1}
            title="Analyst agent"
          >
            Analyst agent
          </Text>
          <Text aria-hidden="true" fontSize="xs" color="fg.subtle" flexShrink={0}>·</Text>
          {!compactSummary && <Icon as={LuBrainCircuit} boxSize={3.5} color="fg.subtle" flexShrink={0} />}
          <Text
            truncate
            fontSize="xs"
            minW={0}
            maxW={compactSummary ? '100px' : '140px'}
            flexShrink={1}
            title={modelSummary}
          >
            {modelSummary}
          </Text>
          <Icon
            as={LuChevronDown}
            boxSize={3}
            flexShrink={0}
            transition="transform 0.15s ease"
            transform={open ? 'rotate(180deg)' : undefined}
          />
        </Button>
      </Popover.Trigger>

      <Portal>
        <Popover.Positioner zIndex={2200}>
          <Popover.Content
            width="min(620px, calc(100vw - 24px))"
            bg="bg.elevated"
            border="1px solid"
            borderColor="border.default"
            borderRadius="lg"
            boxShadow="lg"
            overflow="hidden"
            fontFamily="mono"
          >
            <Popover.Body p={0}>
              <HStack
                justify="space-between"
                gap={4}
                px={{ base: 3, sm: 4 }}
                py={3}
                borderBottom="1px solid"
                borderColor="border.default"
                bg="bg.surface"
              >
                <HStack gap={2.5} minW={0}>
                  <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    w="28px"
                    h="28px"
                    borderRadius="md"
                    bg="accent.teal/10"
                    color="accent.teal"
                    flexShrink={0}
                  >
                    <Icon as={LuSettings2} boxSize={3.5} />
                  </Box>
                  <Box minW={0}>
                    <Text fontSize="sm" fontWeight="700" lineHeight="1.2">Chat settings</Text>
                  </Box>
                </HStack>
                <HStack gap={1.5} color="fg.muted" flexShrink={0}>
                  <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" />
                  <Text fontSize="2xs">Configure this chat</Text>
                </HStack>
              </HStack>

              <Box
                display="grid"
                gridTemplateColumns={{
                  base: 'minmax(0, 1fr)',
                  sm: 'repeat(2, minmax(0, 1fr))',
                }}
                gridTemplateAreas={{
                  base: canChooseContext
                    ? '"knowledge" "database" "agent" "llm"'
                    : '"database" "llm" "agent"',
                  sm: canChooseContext
                    ? '"knowledge database" "agent llm"'
                    : '"database llm" "agent agent"',
                }}
                gap={{ base: 3.5, sm: 4 }}
                px={{ base: 3, sm: 4 }}
                py={3.5}
                data-testid="chat-settings-grid"
              >
                {canChooseContext && (
                  <Box minW={0} gridArea="knowledge" data-testid="chat-setting-knowledge">
                    <HStack gap={2} mb={2} align="center" minW={0}>
                      <Icon as={LuBookOpen} boxSize={3.5} color="accent.teal" flexShrink={0} />
                      <Text
                        fontSize="2xs"
                        fontWeight="700"
                        color="fg.default"
                        textTransform="uppercase"
                        letterSpacing="wide"
                        lineHeight="1"
                        flexShrink={0}
                      >
                        Knowledge base
                      </Text>
                      <Text aria-hidden="true" fontSize="2xs" color="fg.subtle" lineHeight="1" flexShrink={0}>·</Text>
                      <Text truncate minW={0} fontSize="2xs" color="fg.muted" lineHeight="1">
                        Company context
                      </Text>
                    </HStack>
                    <SettingsCombobox
                      options={contextOptions}
                      value={selectedContextValue}
                      onChange={(value) => {
                        const { path, version } = parseContextSelectorValue(value);
                        stableOnContextChange(path, version);
                      }}
                      label="Knowledge base"
                      placeholder={contextsLoading ? 'Loading…' : 'No knowledge base'}
                      disabled={contextsLoading || contextOptions.length === 0}
                    />
                  </Box>
                )}

                <Box minW={0} gridArea="database" data-testid="chat-setting-database">
                  <HStack gap={2} mb={2} align="center" minW={0}>
                    <Icon as={LuDatabase} boxSize={3.5} color="accent.teal" flexShrink={0} />
                    <Text
                      fontSize="2xs"
                      fontWeight="700"
                      color="fg.default"
                      textTransform="uppercase"
                      letterSpacing="wide"
                      lineHeight="1"
                      flexShrink={0}
                    >
                      Database
                    </Text>
                    <Text aria-hidden="true" fontSize="2xs" color="fg.subtle" lineHeight="1" flexShrink={0}>·</Text>
                    <Text truncate minW={0} fontSize="2xs" color="fg.muted" lineHeight="1">
                      Query source
                    </Text>
                  </HStack>
                  <SettingsCombobox
                    options={databaseComboboxOptions}
                    value={databaseName}
                    onChange={onDatabaseChange}
                    label="Database"
                    placeholder={connectionsLoading ? 'Loading…' : 'No database available'}
                    disabled={connectionsLoading || databaseOptions.length === 0}
                  />
                </Box>

                <Box minW={0} gridArea="llm" data-testid="chat-setting-llm">
                  <HStack gap={2} mb={2} align="center" minW={0}>
                    <Icon as={LuBrainCircuit} boxSize={3.5} color="accent.teal" flexShrink={0} />
                    <Text
                      fontSize="2xs"
                      fontWeight="700"
                      color="fg.default"
                      textTransform="uppercase"
                      letterSpacing="wide"
                      lineHeight="1"
                      flexShrink={0}
                    >
                      LLM
                    </Text>
                    <Text aria-hidden="true" fontSize="2xs" color="fg.subtle" lineHeight="1" flexShrink={0}>·</Text>
                    <Text truncate minW={0} fontSize="2xs" color="fg.muted" lineHeight="1">
                      Agent's primary LLM grade
                    </Text>
                  </HStack>
                  <SettingsCombobox
                    options={modelOptions}
                    value={selectedModelValue}
                    onChange={(value) => onGradeChange(value === DEFAULT_GRADE ? null : value as LlmGrade)}
                    label="LLM"
                    placeholder="Default grade"
                    disabled={modelDisabled}
                  />
                </Box>

                <Box minW={0} gridArea="agent" data-testid="chat-setting-agent">
                  <HStack gap={2} mb={2} align="center" minW={0}>
                    <Icon as={LuBot} boxSize={3.5} color="accent.teal" flexShrink={0} />
                    <Text
                      fontSize="2xs"
                      fontWeight="700"
                      color="fg.default"
                      textTransform="uppercase"
                      letterSpacing="wide"
                      lineHeight="1"
                      flexShrink={0}
                    >
                      Agent
                    </Text>
                    <Text aria-hidden="true" fontSize="2xs" color="fg.subtle" lineHeight="1" flexShrink={0}>·</Text>
                    <Text truncate minW={0} fontSize="2xs" color="fg.muted" lineHeight="1">
                      Purpose-built specialists
                    </Text>
                  </HStack>
                  <SettingsCombobox
                    options={AGENT_OPTIONS}
                    value={ANALYST_AGENT}
                    onChange={() => undefined}
                    label="Agent"
                    placeholder="Analyst agent"
                  />
                </Box>
              </Box>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
