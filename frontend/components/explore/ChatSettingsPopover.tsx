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
import {
  LuBookOpen,
  LuBot,
  LuBrainCircuit,
  LuChevronDown,
  LuDatabase,
  LuSettings2,
} from 'react-icons/lu';
import { useConnections } from '@/lib/hooks/useConnections';
import { useContexts } from '@/lib/hooks/useContexts';
import { useAppSelector } from '@/store/hooks';
import { isAdmin } from '@/lib/auth/role-helpers';
import { useStableCallback } from '@/lib/hooks/use-stable-callback';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type { ContextContent } from '@/lib/types';
import type { ChatModelCatalog, ChatModelSelection } from '@/lib/llm/llm-config-types';
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

const DEFAULT_MODEL = '__configured_default__';

export interface ChatSettingsPopoverProps {
  databaseName: string;
  onDatabaseChange: (name: string) => void;
  selectedModel: ChatModelSelection | null;
  onModelChange: (model: ChatModelSelection | null) => void;
  modelDisabled?: boolean;
  selectedContextPath?: string | null;
  selectedVersion?: number;
  onContextChange: (contextPath: string | null, version?: number) => void;
  onOpenChange?: (open: boolean) => void;
  compactSummary?: boolean;
}

type ComboboxOption = SearchableOption;

const GENERAL_AGENT = 'general';
const AGENT_OPTIONS: ComboboxOption[] = [
  {
    value: GENERAL_AGENT,
    label: 'General agent',
    subtitle: 'Default assistant',
    badge: 'Default',
  },
  {
    value: 'custom',
    label: 'Custom agents',
    subtitle: 'Create a specialist for your team',
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

function modelValue(selection: ChatModelSelection): string {
  return JSON.stringify([selection.providerName, selection.model ?? null]);
}

export default function ChatSettingsPopover({
  databaseName,
  onDatabaseChange,
  selectedModel,
  onModelChange,
  modelDisabled = false,
  selectedContextPath,
  selectedVersion,
  onContextChange,
  onOpenChange,
  compactSummary = false,
}: ChatSettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<ChatModelCatalog | null>(null);
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
        if (!cancelled && body?.data?.defaultModel && Array.isArray(body.data.models)) {
          setCatalog(body.data as ChatModelCatalog);
        }
      })
      .catch(() => { /* The configured default remains available without model metadata. */ });
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

  const { modelOptions, modelSelections } = useMemo(() => {
    const selections = new Map<string, ChatModelSelection | null>([[DEFAULT_MODEL, null]]);
    const options: ComboboxOption[] = [{
      value: DEFAULT_MODEL,
      label: catalog?.defaultModel.modelLabel ?? 'Default model',
      subtitle: catalog
        ? [catalog.defaultModel.providerLabel, catalog.defaultModel.model]
            .filter(Boolean)
            .join(' · ')
        : 'Follows Settings → Models',
      badge: 'recommended',
      group: 'Workspace default',
    }];

    for (const model of catalog?.models ?? []) {
      if (
        model.providerName === catalog?.defaultModel.providerName
        && (model.model ?? null) === (catalog.defaultModel.model ?? null)
      ) {
        continue;
      }
      const value = modelValue(model);
      selections.set(value, {
        providerName: model.providerName,
        ...(model.model ? { model: model.model } : {}),
      });
      options.push({
        value,
        label: model.modelLabel,
        subtitle: model.model && model.model !== model.modelLabel ? model.model : undefined,
        group: model.providerLabel,
      });
    }

    if (selectedModel) {
      const value = modelValue(selectedModel);
      if (!selections.has(value)) {
        selections.set(value, selectedModel);
        options.push({
          value,
          label: selectedModel.model ?? selectedModel.providerName,
          group: 'Selected override',
        });
      }
    }

    return { modelOptions: options, modelSelections: selections };
  }, [catalog, selectedModel]);

  const selectedModelValue = selectedModel ? modelValue(selectedModel) : DEFAULT_MODEL;
  const modelSummary = modelOptions.find((option) => option.value === selectedModelValue)?.label
    ?? selectedModel?.model
    ?? selectedModel?.providerName
    ?? 'Default';
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
          {!compactSummary && (
            <>
              <Text
                truncate
                fontSize="xs"
                minW={0}
                maxW="120px"
                flexShrink={1}
                title={databaseName || 'No database'}
              >
                {databaseName || 'No database'}
              </Text>
              <Text aria-hidden="true" fontSize="xs" color="fg.subtle" flexShrink={0}>·</Text>
              <Icon as={LuBot} boxSize={3.5} color="fg.subtle" flexShrink={0} />
            </>
          )}
          <Text
            truncate
            fontSize="xs"
            minW={0}
            maxW="100px"
            flexShrink={1}
            title="General agent"
          >
            General agent
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
                    <HStack gap={2} mb={2}>
                      <Box minW={0}>
                        <HStack gap={1.5}>
                          <Icon as={LuBookOpen} boxSize={3.5} color="accent.teal" />
                          <Text
                            fontSize="2xs"
                            fontWeight="700"
                            color="fg.default"
                            textTransform="uppercase"
                            letterSpacing="wide"
                          >
                            Knowledge base
                          </Text>
                        </HStack>
                        <Text fontSize="2xs" color="fg.muted" mt={0.5}>
                          Ground answers with context
                        </Text>
                      </Box>
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
                  <HStack gap={2} mb={2}>
                    <Box minW={0}>
                      <HStack gap={1.5}>
                        <Icon as={LuDatabase} boxSize={3.5} color="accent.teal" />
                        <Text
                          fontSize="2xs"
                          fontWeight="700"
                          color="fg.default"
                          textTransform="uppercase"
                          letterSpacing="wide"
                        >
                          Database
                        </Text>
                      </HStack>
                      <Text fontSize="2xs" color="fg.muted" mt={0.5}>
                        Query this source
                      </Text>
                    </Box>
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
                  <HStack gap={2} mb={2}>
                    <Box minW={0}>
                      <HStack gap={1.5}>
                        <Icon as={LuBrainCircuit} boxSize={3.5} color="accent.teal" />
                        <Text
                          fontSize="2xs"
                          fontWeight="700"
                          color="fg.default"
                          textTransform="uppercase"
                          letterSpacing="wide"
                        >
                          LLM
                        </Text>
                      </HStack>
                      <Text fontSize="2xs" color="fg.muted" mt={0.5}>
                        LLM powering the agent
                      </Text>
                    </Box>
                  </HStack>
                  <SettingsCombobox
                    options={modelOptions}
                    value={selectedModelValue}
                    onChange={(value) => onModelChange(modelSelections.get(value) ?? null)}
                    label="LLM"
                    placeholder="Default model"
                    disabled={modelDisabled}
                  />
                </Box>

                <Box minW={0} gridArea="agent" data-testid="chat-setting-agent">
                  <HStack gap={2} mb={2}>
                    <Box minW={0}>
                      <HStack gap={1.5}>
                        <Icon as={LuBot} boxSize={3.5} color="accent.teal" />
                        <Text
                          fontSize="2xs"
                          fontWeight="700"
                          color="fg.default"
                          textTransform="uppercase"
                          letterSpacing="wide"
                        >
                          Agent
                        </Text>
                      </HStack>
                      <Text fontSize="2xs" color="fg.muted" mt={0.5}>
                        Purpose-built specialists
                      </Text>
                    </Box>
                  </HStack>
                  <SettingsCombobox
                    options={AGENT_OPTIONS}
                    value={GENERAL_AGENT}
                    onChange={() => undefined}
                    label="Agent"
                    placeholder="General agent"
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
