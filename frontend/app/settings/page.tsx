'use client';

import { useState, ReactNode, useMemo, Suspense, useCallback } from 'react';
import { Box, VStack, Text, Flex, Switch, Button, Heading, Badge, HStack, Icon, IconButton, Input, Textarea } from '@chakra-ui/react';
import { LuChevronRight, LuRefreshCw, LuSearch, LuUser, LuX } from 'react-icons/lu';
import { ColorModeSwitch } from '@/components/ui/color-mode';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setAskForConfirmation, setShowAdvanced, setDevMode, setShowSuggestedQuestions, setShowTrustScore, setQueueStrategy, setAllowChatQueue, setUnrestrictedMode, setShowExpandedMessages, setHomePageConfig, selectHomePage } from '@/store/uiSlice';
import { canEdit } from '@/lib/auth/role-helpers';
import RecordingControl from '@/components/dev/RecordingControl';
import DataManagementSection from '@/components/settings/DataManagementSection';
import { ChannelsSection } from '@/components/settings/ChannelsSection';
import { CreditsUsageCards } from '@/components/settings/CreditsCard';
import { SlackIntegration } from '@/components/settings/integrations/SlackIntegration';
import { McpIntegration } from '@/components/settings/integrations/McpIntegration';
import { RemoteAgentsSection } from '@/components/settings/RemoteAgentsSection';
import { LlmModelsSection } from '@/components/settings/llm/LlmModelsSection';
import UsersContent from '@/components/settings/UsersContent';
import ConfigContainerV2 from '@/components/containers/ConfigContainerV2';
import StylesContainerV2 from '@/components/containers/StylesContainerV2';
import { ErrorDeliverySection } from '@/components/settings/ErrorDeliverySection';
import { GIT_COMMIT_SHA } from '@/lib/constants';
import { toaster } from '@/components/ui/toaster';
import { switchMode } from '@/lib/mode/mode-utils';
import Breadcrumb from '@/components/file-browser/Breadcrumb';
import { fetchWithCache } from '@/lib/http/fetch-wrapper';
import { API } from '@/lib/http/declarations';
import { captureError } from '@/lib/messaging/capture-error';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useFileByPath } from '@/lib/hooks/file-state-hooks';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';
import { useConfigs, updateConfig } from '@/lib/hooks/useConfigs';
import { selectCreditsEnabled } from '@/store/configsSlice';
import { COLOR_PALETTE } from '@/lib/chart/chart-theme';
type TabId = 'general' | 'usage' | 'homepage' | 'dev' | 'data' | 'users' | 'appearance' | 'configs' | 'styles' | 'messaging' | 'integrations' | 'models';
type SettingsGroupId = 'workspace' | 'management' | 'advanced';

interface SettingEntry {
  tab: TabId;
  section?: string;
  title: string;
  description: string;
  control: ReactNode;
  visible?: boolean; // defaults to true
}

interface TabEntry {
  id: TabId;
  label: string;
  description: string;
  group: SettingsGroupId;
  visible?: boolean;
  /** Custom content instead of rendering settings rows */
  custom?: ReactNode;
  /** Searchable destinations rendered inside custom tab content. */
  searchItems?: Array<{
    title: string;
    description: string;
    keywords?: string;
  }>;
}

const SETTINGS_GROUPS: Array<{ id: SettingsGroupId; label: string }> = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'management', label: 'Management' },
  { id: 'advanced', label: 'Advanced' },
];

function matchesSearch(query: string, ...values: Array<string | undefined>) {
  const haystack = values.filter(Boolean).join(' ').toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function SettingRow({ title, description, control, section }: { title: string; description: string; control: ReactNode; section: string }) {
  return (
    <Flex
      justify="space-between"
      align="center"
      py={5}
      px={6}
      _hover={{ bg: 'bg.subtle' }}
      transition="all 0.15s ease"
      aria-label={`Settings > ${section} > ${title}`}
    >
      <Box flex="1" mr={4}>
        <Text fontSize="sm" fontWeight="medium" fontFamily="mono" mb={1}>
          {title}
        </Text>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">
          {description}
        </Text>
      </Box>
      {control}
    </Flex>
  );
}

function SwitchControl({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={(details) => onChange(details.checked)}
      colorPalette="teal"
    >
      <Switch.HiddenInput />
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch.Root>
  );
}

/** Loads a file by path and renders the given container component inline */
function FileTabContent({ path, Container, createFolder, createType }: {
  path: string;
  Container: React.ComponentType<{ fileId: number }>;
  createFolder: string;
  createType: string;
}) {
  const { file, loading, error } = useFileByPath(path);
  const { navigate } = useNavigationGuard();

  if (loading) {
    return (
      <Box p={8} textAlign="center">
        <Text color="fg.muted">Loading...</Text>
      </Box>
    );
  }

  if (!file || error || file.fileState.id < 0) {
    return (
      <Box p={8} textAlign="center">
        <Text color="fg.muted" mb={4}>No file found at {path}.</Text>
        <Button
          bg="accent.teal"
          color="white"
          size="sm"
          onClick={() => navigate(`/new/${createType}?folder=${encodeURIComponent(createFolder)}`)}
        >
          Create {createType.charAt(0).toUpperCase() + createType.slice(1)}
        </Button>
      </Box>
    );
  }

  return (
    <Box h="70vh">
      <Container fileId={file.fileState.id} />
    </Box>
  );
}

function HomePageSettings() {
  const dispatch = useAppDispatch();
  const homePage = useAppSelector(selectHomePage);
  const [promptDraft, setPromptDraft] = useState(homePage.feedSummaryPrompt);
  const [idsDraft, setIdsDraft] = useState(homePage.feedSummaryQuestionIds.join(', '));

  const toggle = (key: 'showFeedSummary' | 'showRecentQuestions' | 'showRecentDashboards' | 'showRecentStories' | 'showRecentConversations' | 'showSuggestedPrompts') =>
    (checked: boolean) => dispatch(setHomePageConfig({ [key]: checked }));

  const commitPrompt = () => {
    if (promptDraft !== homePage.feedSummaryPrompt) {
      dispatch(setHomePageConfig({ feedSummaryPrompt: promptDraft }));
    }
  };

  const commitIds = () => {
    const parsed = idsDraft.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    dispatch(setHomePageConfig({ feedSummaryQuestionIds: parsed }));
  };

  return (
    <VStack align="stretch" gap={4}>
      <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" overflow="hidden">
        <Box px={6} py={3} borderBottomWidth="1px" borderColor="border">
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted" fontFamily="mono" textTransform="uppercase" letterSpacing="wider">
            Sections
          </Text>
        </Box>
        <VStack align="stretch" gap={0} divideY="1px">
          <SettingRow section="Home Page" title="Feed Summary" description="AI-generated summary from recent questions" control={<SwitchControl checked={homePage.showFeedSummary} onChange={toggle('showFeedSummary')} />} />
          <SettingRow section="Home Page" title="Recent Questions" description="Carousel of recently viewed question charts" control={<SwitchControl checked={homePage.showRecentQuestions} onChange={toggle('showRecentQuestions')} />} />
          <SettingRow section="Home Page" title="Recent Dashboards" description="List of recently viewed dashboards" control={<SwitchControl checked={homePage.showRecentDashboards} onChange={toggle('showRecentDashboards')} />} />
          <SettingRow section="Home Page" title="Recent Stories" description="List of recently viewed stories" control={<SwitchControl checked={homePage.showRecentStories} onChange={toggle('showRecentStories')} />} />
          <SettingRow section="Home Page" title="Recent Conversations" description="List of recent conversations" control={<SwitchControl checked={homePage.showRecentConversations} onChange={toggle('showRecentConversations')} />} />
          <SettingRow section="Home Page" title="Suggested Prompts" description="Clickable prompts to quickly start a conversation" control={<SwitchControl checked={homePage.showSuggestedPrompts} onChange={toggle('showSuggestedPrompts')} />} />
        </VStack>
      </Box>

      <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" overflow="hidden">
        <Box px={6} py={3} borderBottomWidth="1px" borderColor="border">
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted" fontFamily="mono" textTransform="uppercase" letterSpacing="wider">
            Feed Summary
          </Text>
        </Box>
        <VStack align="stretch" gap={0} divideY="1px">
          <Flex direction="column" gap={2} py={5} px={6}>
            <Text fontSize="sm" fontWeight="medium" fontFamily="mono">Summary Prompt</Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">Custom prompt sent to the AI when generating the feed summary. Leave empty for default.</Text>
            <Textarea
              size="sm"
              fontFamily="mono"
              fontSize="xs"
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              onBlur={commitPrompt}
              placeholder="Generate a feed summary."
              rows={3}
              aria-label="Settings > Home Page > Summary Prompt"
            />
          </Flex>
          <Flex direction="column" gap={2} py={5} px={6}>
            <Text fontSize="sm" fontWeight="medium" fontFamily="mono">Question IDs</Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">Comma-separated question IDs to use for the summary. Leave empty to auto-select the 3 most recent.</Text>
            <Input
              size="sm"
              fontFamily="mono"
              fontSize="xs"
              value={idsDraft}
              onChange={(e) => setIdsDraft(e.target.value)}
              onBlur={commitIds}
              placeholder="e.g. 42, 87, 123"
              aria-label="Settings > Home Page > Question IDs"
            />
          </Flex>
        </VStack>
      </Box>
    </VStack>
  );
}

function AppearanceSettings() {
  const { config } = useConfigs();
  const [colors, setColors] = useState<string[]>(() =>
    config.chartColorPalette && config.chartColorPalette.length > 0
      ? config.chartColorPalette
      : [...COLOR_PALETTE]
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const isCustom = config.chartColorPalette && config.chartColorPalette.length > 0;
  const hasChanges = useMemo(() => {
    const current = config.chartColorPalette && config.chartColorPalette.length > 0
      ? config.chartColorPalette
      : COLOR_PALETTE;
    if (colors.length !== current.length) return true;
    return colors.some((c, i) => c !== current[i]);
  }, [colors, config.chartColorPalette]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateConfig({ chartColorPalette: colors });
      toaster.create({ title: 'Palette saved', type: 'success', duration: 3000 });
    } catch {
      toaster.create({ title: 'Failed to save palette', type: 'error', duration: 5000 });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setColors([...COLOR_PALETTE]);
    setIsSaving(true);
    try {
      await updateConfig({ chartColorPalette: [] });
      toaster.create({ title: 'Reset to default palette', type: 'success', duration: 3000 });
    } catch {
      toaster.create({ title: 'Failed to reset palette', type: 'error', duration: 5000 });
    } finally {
      setIsSaving(false);
    }
  };

  const startEditing = (index: number) => {
    setEditingIndex(index);
    setInputValue(colors[index]);
  };

  const commitEdit = () => {
    if (editingIndex === null) return;
    const hex = inputValue.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      const next = [...colors];
      next[editingIndex] = hex.toLowerCase();
      setColors(next);
    }
    setEditingIndex(null);
  };

  const addColor = () => {
    setColors([...colors, '#888888']);
    startEditing(colors.length);
  };

  const removeColor = (index: number) => {
    if (colors.length <= 1) return;
    setColors(colors.filter((_, i) => i !== index));
    setEditingIndex(null);
  };

  return (
    <VStack align="stretch" gap={4}>
      <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" overflow="hidden">
        <Box px={6} py={3} borderBottomWidth="1px" borderColor="border">
          <HStack justify="space-between">
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted" fontFamily="mono" textTransform="uppercase" letterSpacing="wider">
              Chart Color Palette
            </Text>
            {isCustom && (
              <Badge size="sm" colorPalette="teal" variant="subtle" fontFamily="mono">Custom</Badge>
            )}
          </HStack>
        </Box>
        <VStack align="stretch" gap={0} px={6} py={5}>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={4}>
            Colors used for chart series in order.
          </Text>
          <Flex gap={2} flexWrap="wrap" mb={4}>
            {colors.map((hex, i) => (
              <HStack key={i} gap={1.5} px={2} py={1} borderRadius="md" border="1px solid" borderColor="border.muted" bg="bg.subtle">
                <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" flexShrink={0}>
                  {i + 1}
                </Text>
                <Box w="16px" h="16px" borderRadius="sm" bg={hex} flexShrink={0} border="1px solid" borderColor="border.muted" />
                <Input
                  size="sm" fontFamily="mono" fontSize="xs"
                  value={editingIndex === i ? inputValue : hex}
                  onChange={(e) => setInputValue(e.target.value)}
                  onFocus={() => startEditing(i)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingIndex(null); }}
                  w="90px" minW="90px" maxW="90px"
                  border="none" bg="transparent" p={0} h="auto"
                  aria-label={`Color ${i + 1} hex value`}
                />
                {colors.length > 1 && (
                  <IconButton
                    size="2xs" variant="ghost" borderRadius="sm"
                    color="fg.subtle" _hover={{ color: 'fg.default' }}
                    onClick={() => removeColor(i)}
                    aria-label={`Remove color ${i + 1}`}
                    minW="14px" h="14px" w="14px" p={0}
                  >
                    <Icon as={LuX} boxSize="10px" />
                  </IconButton>
                )}
              </HStack>
            ))}
          </Flex>

          <HStack gap={2}>
            <Button size="sm" variant="outline" onClick={addColor} aria-label="Add color to palette">
              + Add Color
            </Button>
            <Button size="sm" bg="accent.teal" color="white" onClick={handleSave} loading={isSaving} disabled={!hasChanges || isSaving}>
              Save
            </Button>
            {isCustom && (
              <Button size="sm" variant="outline" onClick={handleReset} disabled={isSaving}>
                Reset to Default
              </Button>
            )}
          </HStack>
        </VStack>
      </Box>
    </VStack>
  );
}

function SettingsContent() {
  const dispatch = useAppDispatch();
  const [searchQuery, setSearchQuery] = useState('');
  const askForConfirmation = useAppSelector((state) => state.ui.askForConfirmation);
  const user = useAppSelector((state) => state.auth.user);
  const [isClearing, setIsClearing] = useState(false);
  const [isTestingError, setIsTestingError] = useState(false);
  const showAdvanced = useAppSelector((state) => state.ui.showAdvanced);
  const allowChatQueue = useAppSelector((state) => state.ui.allowChatQueue ?? false);
  const queueStrategy = useAppSelector((state) => state.ui.queueStrategy ?? 'end-of-turn');
  const devMode = useAppSelector((state) => state.ui.devMode);
  const showSuggestedQuestions = useAppSelector((state) => state.ui.showSuggestedQuestions);
  const showTrustScore = useAppSelector((state) => state.ui.showTrustScore);
  const showExpandedMessages = useAppSelector((state) => state.ui.showExpandedMessages ?? false);
  const unrestrictedMode = useAppSelector((state) => state.ui.unrestrictedMode);
  const creditsEnabled = useAppSelector(selectCreditsEnabled);
  const { config } = useConfigs();

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const activeTab: TabId = (searchParams?.get('tab') as TabId) || 'general';
  const setActiveTab = useCallback((tab: TabId) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    if (tab === 'general') {
      params.delete('tab');
    } else {
      params.set('tab', tab);
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [searchParams, router, pathname]);

  const mode = user?.mode || 'org';

  const isAdmin = user?.role === 'admin';
  const isEditorOrAdmin = user?.role ? canEdit(user.role) : false;
  const isAdvancedAdmin = isAdmin && showAdvanced;

  const handleClearCache = useCallback(async () => {
    setIsClearing(true);
    try {
      const data = await fetchWithCache('/api/cache/clear', {
        method: 'POST',
        cacheStrategy: API.admin.clearCache.cache,
      });

      toaster.create({
        title: 'Cache cleared',
        description: data.message || 'Please refresh the page to reload initial state.',
        type: 'success',
        duration: 5000,
      });

      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Failed to clear cache:', error);
      toaster.create({
        title: 'Error',
        description: 'Failed to clear cache. Please try again.',
        type: 'error',
        duration: 5000,
      });
    } finally {
      setIsClearing(false);
    }
  }, []);

  const handleTestError = useCallback(async () => {
    setIsTestingError(true);
    try {
      const res = await fetch('/api/test-error', { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Server returned ${res.status}: ${text}`);
        await captureError('settings:testError:frontend', err, { status: res.status });
        toaster.create({
          title: 'Test error triggered',
          description: `Backend 500 logged. Frontend error also captured (status ${res.status}).`,
          type: 'success',
          duration: 5000,
        });
      } else {
        toaster.create({
          title: 'Unexpected success',
          description: 'Expected a 500 but got a success response.',
          type: 'warning',
          duration: 5000,
        });
      }
    } catch (error) {
      await captureError('settings:testError:network', error);
      toaster.create({
        title: 'Network error captured',
        description: 'A network-level error occurred and was captured.',
        type: 'error',
        duration: 5000,
      });
    } finally {
      setIsTestingError(false);
    }
  }, []);

  const handleTelemetryToggle = useCallback(async (enabled: boolean) => {
    await updateConfig({ analytics: { enabled } });
    toaster.create({
      title: enabled ? 'Telemetry enabled' : 'Telemetry disabled',
      description: 'Reload the page for changes to take effect.',
      type: 'info',
      duration: 5000,
    });
  }, []);

  // ── Settings config ──────────────────────────────────────────────
  const settings: SettingEntry[] = useMemo(() => [
    // ── General: Feature Flags (all users) ──
    {
      tab: 'general',
      section: 'Feature Flags',
      title: 'Appearance: Dark Mode',
      description: 'Switch between light and dark theme',
      control: <ColorModeSwitch />,
    },
    {
      tab: 'general',
      section: 'Feature Flags',
      title: 'Confirm Actions',
      description: 'Confirm before applying AI-suggested changes to any page',
      control: (
        <SwitchControl
          checked={askForConfirmation}
          onChange={(checked) => dispatch(setAskForConfirmation(checked))}
        />
      ),
    },
    {
      tab: 'general',
      section: 'Feature Flags',
      title: 'Suggested Questions',
      description: 'Show clickable follow-up questions after agent responses',
      control: (
        <SwitchControl
          checked={showSuggestedQuestions}
          onChange={(checked) => dispatch(setShowSuggestedQuestions(checked))}
        />
      ),
    },
    {
      tab: 'general',
      section: 'Feature Flags',
      title: 'Trust Score',
      description: 'Show agent confidence level on responses',
      control: (
        <SwitchControl
          checked={showTrustScore}
          onChange={(checked) => dispatch(setShowTrustScore(checked))}
        />
      ),
    },
    // ── General: Experimental Flags (editors + admins) ──
    {
      tab: 'general',
      section: 'Experimental Flags',
      title: 'Background Agent Mode',
      description: 'Allow the agent to work unrestricted — create and edit files without needing to navigate to the target page first.',
      control: (
        <SwitchControl
          checked={unrestrictedMode}
          onChange={(checked) => dispatch(setUnrestrictedMode(checked))}
        />
      ),
      visible: isEditorOrAdmin,
    },
    {
      tab: 'general',
      section: 'Feature Flags',
      title: 'Allow Chat Queue',
      description: 'Send follow-up chat messages while the agent is still working.',
      control: (
        <SwitchControl
          checked={allowChatQueue}
          onChange={(checked) => dispatch(setAllowChatQueue(checked))}
        />
      ),
    },
    {
      tab: 'dev',
      section: 'Alpha Flags',
      title: 'Queue Strategy',
      description: 'end-of-turn: send queued messages after agent finishes. mid-turn: send with tool results.',
      control: (
        <Flex gap={2}>
          <Button size="sm" variant={queueStrategy === 'end-of-turn' ? 'solid' : 'outline'} onClick={() => dispatch(setQueueStrategy('end-of-turn'))}>
            End of Turn
          </Button>
          <Button size="sm" variant={queueStrategy === 'mid-turn' ? 'solid' : 'outline'} onClick={() => dispatch(setQueueStrategy('mid-turn'))}>
            Mid Turn
          </Button>
        </Flex>
      ),
    },
    {
      tab: 'dev',
      title: 'Show Expanded Messages',
      description: 'Always show the detailed timeline view for agent work in chat instead of the compact summary.',
      control: (
        <SwitchControl
          checked={showExpandedMessages}
          onChange={(checked) => dispatch(setShowExpandedMessages(checked))}
        />
      ),
    },
    // ── General: Developer Tools toggle (admin only, unlabeled card) ──
    {
      tab: 'general',
      title: 'Developer Tabs',
      description: 'Show developer tabs: Developer Tools, Configs, Styles, and Data Management',
      control: (
        <SwitchControl
          checked={showAdvanced}
          onChange={(checked) => dispatch(setShowAdvanced(checked))}
        />
      ),
      visible: isAdmin,
    },
    // ── Dev tab ──
    {
      tab: 'dev',
      title: 'Show Debug Options',
      description: 'Enables: impersonation selector, JSON view toggles, LLM debug info, DevTools panel in right ridebar, and all error toasts',
      control: (
        <SwitchControl
          checked={devMode}
          onChange={(checked) => dispatch(setDevMode(checked))}
        />
      ),
    },
    {
      tab: 'dev',
      title: 'Mode',
      description: `Current: ${user?.mode || 'org'}`,
      control: (
        <Flex gap={2}>
          <Button size="sm" variant={user?.mode === 'org' ? 'solid' : 'outline'} onClick={() => switchMode('org')}>
            Org
          </Button>
          <Button size="sm" variant={user?.mode === 'tutorial' ? 'solid' : 'outline'} onClick={() => switchMode('tutorial')}>
            Tutorial
          </Button>
        </Flex>
      ),
    },
    {
      tab: 'dev',
      title: 'Telemetry',
      description: 'Send anonymous usage data to help improve the product',
      control: (
        <SwitchControl
          checked={config.analytics?.enabled ?? true}
          onChange={handleTelemetryToggle}
        />
      ),
    },
    {
      tab: 'dev',
      title: 'Session Recording',
      description: 'Record your session for debugging and support',
      control: <RecordingControl />,
    },
    {
      tab: 'dev',
      title: 'Clear Cache',
      description: 'Reload configs, styles, contexts, and connections',
      control: (
        <Button size="sm" variant="outline" onClick={handleClearCache} loading={isClearing} disabled={isClearing}>
          <LuRefreshCw />
          Clear
        </Button>
      ),
    },
    {
      tab: 'dev',
      title: 'Test Error Capture',
      description: 'Trigger a backend 500 and a frontend error to verify the error reporting pipeline',
      control: (
        <Button size="sm" variant="outline" colorPalette="red" onClick={handleTestError} loading={isTestingError} disabled={isTestingError}>
          Trigger
        </Button>
      ),
    },
  ], [askForConfirmation, isClearing, isTestingError, user?.mode, dispatch, handleClearCache, handleTestError, handleTelemetryToggle, showAdvanced, isAdmin, isEditorOrAdmin, showSuggestedQuestions, showTrustScore, queueStrategy, allowChatQueue, unrestrictedMode, devMode, showExpandedMessages, config.analytics]);

  // ── Tabs config ──────────────────────────────────────────────────
  const tabs: TabEntry[] = useMemo(() => [
    {
      id: 'general',
      label: 'General',
      description: 'Everyday agent behavior and feature controls.',
      group: 'workspace',
    },
    {
      id: 'appearance',
      label: 'Appearance',
      description: 'Colors and visual defaults for your workspace.',
      group: 'advanced',
      visible: isAdvancedAdmin,
      custom: <AppearanceSettings />,
      searchItems: [
        { title: 'Chart Color Palette', description: 'Choose the colors used for chart series.', keywords: 'theme visualization series hex' },
      ],
    },
    {
      id: 'homepage',
      label: 'Home Page',
      description: 'Choose the sections and summaries shown on Home.',
      group: 'advanced',
      visible: isAdvancedAdmin,
      custom: <HomePageSettings />,
      searchItems: [
        { title: 'Feed Summary', description: 'Show and configure the AI-generated feed summary.', keywords: 'prompt question ids' },
        { title: 'Recent Questions', description: 'Show recently viewed question charts.' },
        { title: 'Recent Dashboards', description: 'Show recently viewed dashboards.' },
        { title: 'Recent Stories', description: 'Show recently viewed stories.' },
        { title: 'Recent Conversations', description: 'Show recent conversations.' },
        { title: 'Suggested Prompts', description: 'Show prompts that quickly start a conversation.' },
      ],
    },
    {
      id: 'users',
      label: 'Users',
      description: 'Manage workspace members, roles, and access.',
      group: 'management',
      visible: isAdmin,
      custom: <UsersContent />,
      searchItems: [
        { title: 'Members and Roles', description: 'Add, edit, or remove users and assign viewer, editor, or admin access.', keywords: 'name email password permissions' },
        { title: 'Two-factor Authentication', description: 'Configure phone-based 2FA for workspace members.', keywords: 'phone security sms' },
        { title: 'Home Folders', description: 'Choose the default home folder for a user.', keywords: 'path directory' },
      ],
    },
    {
      id: 'models',
      label: 'AI Models',
      description: 'Configure model providers, grades, and agent routing.',
      group: 'management',
      visible: isAdmin,
      custom: (
        <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" p={6}>
          <LlmModelsSection />
        </Box>
      ),
      searchItems: [
        { title: 'Model Providers', description: 'Configure provider credentials, API keys, regions, and base URLs.', keywords: 'openai anthropic bedrock llm test' },
        { title: 'Model Grades', description: 'Assign models to capability and cost grades.', keywords: 'smart fast cheap routing' },
        { title: 'Agent Models', description: 'Choose allowed grades and defaults for each agent.', keywords: 'analyst default model assignment' },
      ],
    },
    {
      id: 'usage',
      label: 'Usage',
      description: 'Review individual and organization credit usage.',
      group: 'workspace',
      visible: creditsEnabled,
      custom: <CreditsUsageCards />,
      searchItems: [
        { title: 'Credits', description: 'Review allowances, usage, resets, and breakdowns.', keywords: 'billing individual organization limits' },
      ],
    },
    {
      id: 'integrations',
      label: 'Integrations',
      description: `Connect external services to your ${config.branding.displayName} workspace.`,
      group: 'management',
      visible: isAdmin,
      custom: (
        <VStack align="stretch" gap={3}>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Connect external services to your {config.branding.displayName} workspace.
          </Text>
          <SlackIntegration />
          <McpIntegration />
          <RemoteAgentsSection />
        </VStack>
      ),
      searchItems: [
        { title: 'Slack', description: 'Connect a Slack app using OAuth or manual credentials.', keywords: 'bot token signing secret manifest workspace' },
        { title: 'MCP', description: 'Connect clients through the Model Context Protocol.', keywords: 'endpoint server token tools' },
        { title: 'Remote Agents', description: 'Allow external AI agents to operate a chat session.', keywords: 'codex claude copy link session' },
      ],
    },
    {
      id: 'messaging',
      label: 'Messaging',
      description: 'Configure outbound channels and operational alerts.',
      group: 'advanced',
      visible: isAdvancedAdmin,
      custom: (
        <VStack align="stretch" gap={4}>
          <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" overflow="hidden">
            <ChannelsSection />
          </Box>
          <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" overflow="hidden">
            <ErrorDeliverySection />
          </Box>
        </VStack>
      ),
      searchItems: [
        { title: 'Channels', description: 'Configure webhook and Slack messaging destinations.', keywords: 'properties url channel id' },
        { title: 'Error Notifications', description: 'Choose where server, tool, and stream errors are delivered.', keywords: 'alerts recipients delivery failures' },
      ],
    },
    {
      id: 'configs',
      label: 'Configs',
      description: 'Edit the workspace configuration file.',
      group: 'advanced',
      visible: isAdvancedAdmin,
      custom: (
        <FileTabContent
          path={`/${mode}/configs/config`}
          Container={ConfigContainerV2}
          createFolder={`/${mode}/configs`}
          createType="config"
        />
      ),
      searchItems: [
        { title: 'Workspace Config', description: 'Edit organization-level configuration values.', keywords: 'config file yaml' },
      ],
    },
    {
      id: 'styles',
      label: 'Styles',
      description: 'Edit workspace-wide style definitions.',
      group: 'advanced',
      visible: isAdvancedAdmin,
      custom: (
        <FileTabContent
          path={`/${mode}/configs/styles`}
          Container={StylesContainerV2}
          createFolder={`/${mode}/configs`}
          createType="styles"
        />
      ),
      searchItems: [
        { title: 'Workspace Styles', description: 'Edit organization-level style definitions.', keywords: 'css theme file' },
      ],
    },
    {
      id: 'data',
      label: 'Data Management',
      description: 'Export, validate, migrate, import, and repair workspace data.',
      group: 'advanced',
      visible: isAdvancedAdmin,
      custom: (
        <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" overflow="hidden">
          <DataManagementSection />
        </Box>
      ),
      searchItems: [
        { title: 'Export Workspace Data', description: 'Download workspace data as compressed JSON.', keywords: 'backup json gzip' },
        { title: 'Validate Data', description: 'Check data integrity and schema versions.', keywords: 'errors version status' },
        { title: 'Run Migrations', description: 'Apply pending database migrations.', keywords: 'schema upgrade' },
        { title: 'Backfill Viz V2 Envelopes', description: 'Derive V2 visualization envelopes for existing questions.', keywords: 'charts classic visualization' },
        { title: 'Import Workspace Data', description: 'Restore or import workspace data.', keywords: 'upload backup json' },
        { title: 'Backfill Conversations to v3', description: 'Port older conversation files into v3 tables.', keywords: 'chat history migrate' },
        { title: 'Reset Tutorial & Other Modes', description: 'Reset non-organization workspace modes.', keywords: 'delete clear' },
        { title: 'LLM Debug Logs', description: 'Clear stored model request and response logs.', keywords: 'raw chat logs delete' },
      ],
    },
    {
      id: 'dev',
      label: 'Developer Tools',
      description: 'Debugging, telemetry, cache, and test controls.',
      group: 'advanced',
      visible: isAdvancedAdmin,
    },
  ], [isAdmin, isAdvancedAdmin, mode, creditsEnabled, config.branding.displayName]);

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Settings', href: undefined }
  ];

  const visibleTabs = useMemo(() => tabs.filter((tab) => tab.visible !== false), [tabs]);
  const activeTabEntry = visibleTabs.find((tab) => tab.id === activeTab) ?? visibleTabs[0];
  const normalizedSearch = searchQuery.trim();

  const matchedSettings = useMemo(() => {
    if (!normalizedSearch) return [];
    return settings.filter((setting) => {
      if (setting.visible === false || !visibleTabs.some((tab) => tab.id === setting.tab)) return false;
      const tab = visibleTabs.find((entry) => entry.id === setting.tab);
      return matchesSearch(normalizedSearch, tab?.label, setting.section, setting.title, setting.description);
    });
  }, [normalizedSearch, settings, visibleTabs]);

  const matchedDestinations = useMemo(() => {
    if (!normalizedSearch) return [];

    return visibleTabs.flatMap((tab) => {
      const results: Array<{ tab: TabEntry; title: string; description: string }> = [];
      if (matchesSearch(normalizedSearch, tab.label, tab.description)) {
        results.push({ tab, title: tab.label, description: tab.description });
      }
      for (const item of tab.searchItems ?? []) {
        if (matchesSearch(normalizedSearch, tab.label, item.title, item.description, item.keywords)) {
          results.push({ tab, title: item.title, description: item.description });
        }
      }
      return results;
    });
  }, [normalizedSearch, visibleTabs]);

  if (!user) {
    return null;
  }

  const renderTabContent = (tab: TabEntry) => {
    if (tab.custom) return tab.custom;

    const tabSettings = settings.filter((s) => s.tab === tab.id && s.visible !== false);

    const sectionMap = new Map<string, SettingEntry[]>();
    for (const s of tabSettings) {
      const key = s.section ?? '';
      if (!sectionMap.has(key)) sectionMap.set(key, []);
      sectionMap.get(key)!.push(s);
    }

    return (
      <VStack align="stretch" gap={4}>
        {tab.id === 'general' && (
          <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" px={6} py={4}>
            <VStack align="stretch" gap={1}>
              <HStack gap={3}>
                <Icon as={LuUser} boxSize={4} color="fg.muted" flexShrink={0} />
                <Text fontSize="sm" fontWeight="medium" fontFamily="mono">{user?.name ?? '—'}</Text>
              </HStack>
              <HStack gap={3} pl={7}>
                <Text fontSize="xs" color="fg.muted" fontFamily="mono">{user?.email ?? '—'}</Text>
                <Badge
                  size="sm"
                  colorPalette={user?.role === 'admin' ? 'teal' : user?.role === 'editor' ? 'blue' : 'gray'}
                  variant="subtle"
                  fontFamily="mono"
                >
                  {user?.role ?? '—'}
                </Badge>
              </HStack>
            </VStack>
          </Box>
        )}
        {[...sectionMap.entries()].map(([sectionName, entries]) => (
          <Box key={sectionName || '__default__'} bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" overflow="hidden">
            {sectionName && (
              <Box px={6} py={3} borderBottomWidth="1px" borderColor="border">
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted" fontFamily="mono" textTransform="uppercase" letterSpacing="wider">
                  {sectionName}
                </Text>
              </Box>
            )}
            <VStack align="stretch" gap={0} divideY="1px">
              {entries.map((s) => (
                <SettingRow key={s.title} title={s.title} description={s.description} control={s.control} section={tab.label} />
              ))}
            </VStack>
          </Box>
        ))}
      </VStack>
    );
  };

  const renderSearchResults = () => {
    const groupedSettings = new Map<string, { tab: TabEntry; section: string; entries: SettingEntry[] }>();
    for (const setting of matchedSettings) {
      const tab = visibleTabs.find((entry) => entry.id === setting.tab);
      if (!tab) continue;
      const section = setting.section ?? '';
      const key = `${tab.id}:${section}`;
      const group = groupedSettings.get(key) ?? { tab, section, entries: [] };
      group.entries.push(setting);
      groupedSettings.set(key, group);
    }

    const resultCount = matchedSettings.length + matchedDestinations.length;

    return (
      <Box aria-label="Settings search results" aria-live="polite">
        <Flex justify="space-between" align="end" gap={4} mb={5}>
          <Box>
            <Heading fontSize={{ base: 'xl', md: '2xl' }} letterSpacing="-0.02em">
              Search results
            </Heading>
            <Text fontSize="sm" color="fg.muted" mt={1}>
              {resultCount} {resultCount === 1 ? 'match' : 'matches'} for “{normalizedSearch}”
            </Text>
          </Box>
        </Flex>

        {resultCount === 0 ? (
          <Box borderTopWidth="1px" borderColor="border" py={12} textAlign="center">
            <Heading fontSize="lg" mb={2}>No settings found</Heading>
            <Text color="fg.muted" fontSize="sm">Try a feature name, action, or description.</Text>
          </Box>
        ) : (
          <VStack align="stretch" gap={5}>
            {[...groupedSettings.values()].map(({ tab, section, entries }) => (
              <Box key={`${tab.id}:${section}`} bg="bg.surface" borderRadius="xl" borderWidth="1px" borderColor="border" overflow="hidden">
                <Box px={6} py={3} borderBottomWidth="1px" borderColor="border">
                  <HStack gap={2}>
                    <Text fontSize="xs" fontWeight="semibold" color="fg.default" fontFamily="mono">
                      {tab.label}
                    </Text>
                    {section && (
                      <>
                        <Text color="fg.subtle" fontSize="xs">/</Text>
                        <Text fontSize="xs" color="fg.muted" fontFamily="mono">{section}</Text>
                      </>
                    )}
                  </HStack>
                </Box>
                <VStack align="stretch" gap={0} divideY="1px">
                  {entries.map((setting) => (
                    <SettingRow
                      key={`${tab.id}:${setting.title}`}
                      title={setting.title}
                      description={setting.description}
                      control={setting.control}
                      section={tab.label}
                    />
                  ))}
                </VStack>
              </Box>
            ))}

            {matchedDestinations.length > 0 && (
              <Box bg="bg.surface" borderRadius="xl" borderWidth="1px" borderColor="border" overflow="hidden">
                <Box px={6} py={3} borderBottomWidth="1px" borderColor="border">
                  <Text fontSize="xs" fontWeight="semibold" color="fg.muted" fontFamily="mono" textTransform="uppercase" letterSpacing="wider">
                    Settings areas
                  </Text>
                </Box>
                <VStack align="stretch" gap={0} divideY="1px">
                  {matchedDestinations.map(({ tab, title, description }, index) => (
                    <Button
                      key={`${tab.id}:${title}:${index}`}
                      variant="ghost"
                      h="auto"
                      minH="72px"
                      borderRadius="0"
                      px={6}
                      py={4}
                      justifyContent="space-between"
                      textAlign="left"
                      fontWeight="normal"
                      onClick={() => {
                        setActiveTab(tab.id);
                        setSearchQuery('');
                      }}
                      aria-label={`Open ${tab.label}: ${title}`}
                    >
                      <Box minW={0}>
                        <HStack gap={2} mb={1}>
                          <Text fontSize="sm" fontWeight="medium" fontFamily="mono">{title}</Text>
                          <Badge size="xs" variant="subtle" colorPalette="gray" fontFamily="mono">{tab.label}</Badge>
                        </HStack>
                        <Text fontSize="xs" color="fg.muted" fontFamily="mono" whiteSpace="normal">{description}</Text>
                      </Box>
                      <Icon as={LuChevronRight} boxSize={4} color="fg.subtle" ml={4} flexShrink={0} />
                    </Button>
                  ))}
                </VStack>
              </Box>
            )}
          </VStack>
        )}
      </Box>
    );
  };

  return (
    <Box
      h={{ base: 'calc(100dvh - 80px)', md: '100dvh' }}
      minH={0}
      bg="bg.canvas"
      display="flex"
      overflow="hidden"
    >
      <VStack flex="1" minW="0" minH={0} position="relative" align="stretch" overflow="hidden">
        <Box
          w="100%"
          h="100%"
          minH={0}
          mx="auto"
          px={{ base: 4, md: 8, lg: 12 }}
          pt={{ base: 3, md: 4, lg: 5 }}
          pb={{ base: 3, md: 5, lg: 6 }}
          display="flex"
          flexDirection="column"
          overflow="hidden"
        >
          <Flex justify="space-between" align="center" mb={4} gap={4}>
            <Box flex="1" minW={0}>
              <Breadcrumb items={breadcrumbItems} />
            </Box>
          </Flex>

          <Heading
            fontSize={{ base: '3xl', md: '4xl' }}
            fontWeight="900"
            letterSpacing="-0.035em"
            mt={{ base: 7, md: 9 }}
            color="fg.default"
          >
            Settings
          </Heading>
          <Text mt={1} color="fg.muted" fontSize="sm">
            Manage your preferences and workspace configuration.
          </Text>

          <Box position="relative" mt={6} mb={{ base: 7, lg: 9 }}>
            <Icon
              as={LuSearch}
              position="absolute"
              left={4}
              top="50%"
              transform="translateY(-50%)"
              boxSize={4.5}
              color="fg.muted"
              pointerEvents="none"
              zIndex={1}
            />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search settings by name or description…"
              aria-label="Search settings"
              h="48px"
              pl={11}
              pr={searchQuery ? 12 : 4}
              bg="bg.surface"
              borderColor="border"
              borderRadius="lg"
              fontFamily="mono"
              fontSize="sm"
              shadow="xs"
              _focusVisible={{ borderColor: 'accent.teal', boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)' }}
            />
            {searchQuery && (
              <IconButton
                aria-label="Clear settings search"
                variant="ghost"
                size="sm"
                position="absolute"
                right={2}
                top="50%"
                transform="translateY(-50%)"
                onClick={() => setSearchQuery('')}
              >
                <LuX />
              </IconButton>
            )}
          </Box>

          <Flex
            direction={{ base: 'column', lg: 'row' }}
            gap={{ base: 5, lg: 10 }}
            align="stretch"
            flex="1"
            minH={0}
            overflow="hidden"
          >
            <Box
              as="nav"
              aria-label="Settings navigation"
              w={{ base: 'full', lg: '228px' }}
              flexShrink={0}
              pr={{ lg: 5 }}
              borderRightWidth={{ lg: '1px' }}
              borderColor="border"
            >
              <Box
                display={{ base: 'flex', lg: 'block' }}
                gap={{ base: 5, lg: 0 }}
                overflowX={{ base: 'auto', lg: 'visible' }}
                pb={{ base: 2, lg: 0 }}
                css={{ '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}
              >
                {SETTINGS_GROUPS.map((group) => {
                  const groupTabs = visibleTabs.filter((tab) => tab.group === group.id);
                  if (groupTabs.length === 0) return null;
                  return (
                    <Box key={group.id} mb={{ lg: 6 }} minW={{ base: '178px', lg: 0 }}>
                      <Text
                        px={3}
                        mb={1.5}
                        fontSize="2xs"
                        fontWeight="semibold"
                        color="fg.subtle"
                        fontFamily="mono"
                        textTransform="uppercase"
                        letterSpacing="0.12em"
                      >
                        {group.label}
                      </Text>
                      <VStack align="stretch" gap={0.5}>
                        {groupTabs.map((tab) => {
                          const selected = activeTabEntry?.id === tab.id;
                          return (
                            <Button
                              key={tab.id}
                              variant="ghost"
                              size="sm"
                              h="34px"
                              px={3}
                              justifyContent="flex-start"
                              borderRadius="md"
                              bg={selected ? 'accent.teal/10' : 'transparent'}
                              color={selected ? 'fg.default' : 'fg.muted'}
                              fontFamily="mono"
                              fontSize="sm"
                              fontWeight={selected ? 'semibold' : 'normal'}
                              transition="background 120ms ease, color 120ms ease"
                              _hover={{ bg: selected ? 'accent.teal/15' : 'bg.subtle', color: 'fg.default' }}
                              onClick={() => {
                                setActiveTab(tab.id);
                                setSearchQuery('');
                              }}
                              aria-label={`Settings tab: ${tab.label}`}
                              aria-current={selected ? 'page' : undefined}
                            >
                              {tab.label}
                            </Button>
                          );
                        })}
                      </VStack>
                    </Box>
                  );
                })}
              </Box>
            </Box>

            <Box
              key={normalizedSearch ? 'search-results' : activeTabEntry?.id}
              flex="1"
              minW={0}
              minH={0}
              w="full"
              overflowY="auto"
              overscrollBehavior="contain"
              pr={{ lg: 2 }}
              pb={6}
              css={{ scrollbarGutter: 'stable' }}
            >
              {normalizedSearch ? renderSearchResults() : (
                <>
                  <Box mb={5}>
                    <Heading fontSize={{ base: 'xl', md: '2xl' }} letterSpacing="-0.02em">
                      {activeTabEntry?.label}
                    </Heading>
                    <Text fontSize="sm" color="fg.muted" mt={1}>
                      {activeTabEntry?.description}
                    </Text>
                  </Box>
                  {activeTabEntry && (
                    <Box aria-label={`Settings section: ${activeTabEntry.label}`}>
                      {renderTabContent(activeTabEntry)}
                    </Box>
                  )}
                </>
              )}

              <Text fontSize="xs" color="fg.subtle" fontFamily="mono" mt={8} mb={2}>
                Build: {GIT_COMMIT_SHA}
              </Text>
            </Box>
          </Flex>

        </Box>
      </VStack>
    </Box>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
