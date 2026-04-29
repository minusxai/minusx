'use client';

import { useState, ReactNode, useMemo, Suspense, useCallback } from 'react';
import { Box, VStack, Text, Flex, Switch, Button, Heading, Tabs, Badge, HStack, Icon, IconButton, Input, Textarea } from '@chakra-ui/react';
import { LuRefreshCw, LuUser, LuX } from 'react-icons/lu';
import { ColorModeButton } from '@/components/ui/color-mode';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setAskForConfirmation, setShowAdvanced, setDevMode, setShowSuggestedQuestions, setShowTrustScore, setQueueStrategy, setAllowChatQueue, setUnrestrictedMode, setShowExpandedMessages, setHomePageConfig, selectHomePage } from '@/store/uiSlice';
import { canEdit } from '@/lib/auth/role-helpers';
import { IS_DEV } from '@/lib/constants';
import RecordingControl from '@/components/RecordingControl';
import DataManagementSection from '@/components/DataManagementSection';
import { ChannelsSection } from '@/components/settings/ChannelsSection';
import { SlackIntegration } from '@/components/settings/integrations/SlackIntegration';
import { McpIntegration } from '@/components/settings/integrations/McpIntegration';
import UsersContent from '@/components/UsersContent';
import ConfigContainerV2 from '@/components/containers/ConfigContainerV2';
import StylesContainerV2 from '@/components/containers/StylesContainerV2';
import { ErrorDeliverySection } from '@/components/settings/ErrorDeliverySection';
import { GIT_COMMIT_SHA } from '@/lib/constants';
import { toaster } from '@/components/ui/toaster';
import { switchMode } from '@/lib/mode/mode-utils';
import Breadcrumb from '@/components/Breadcrumb';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';
import { captureError } from '@/lib/messaging/capture-error';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useFileByPath } from '@/lib/hooks/file-state-hooks';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';
import { useConfigs, updateConfig } from '@/lib/hooks/useConfigs';
import { COLOR_PALETTE } from '@/lib/chart/echarts-theme';

type TabId = 'general' | 'homepage' | 'dev' | 'data' | 'users' | 'appearance' | 'configs' | 'styles' | 'messaging' | 'integrations';

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
  visible?: boolean;
  /** Custom content instead of rendering settings rows */
  custom?: ReactNode;
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
  const { file, loading } = useFileByPath(path);
  const { navigate } = useNavigationGuard();

  if (loading) {
    return (
      <Box p={8} textAlign="center">
        <Text color="fg.muted">Loading...</Text>
      </Box>
    );
  }

  if (!file) {
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

  const toggle = (key: 'showFeedSummary' | 'showRecentQuestions' | 'showRecentDashboards' | 'showRecentConversations' | 'showSuggestedPrompts') =>
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

  const handleClearCache = async () => {
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
  };

  const handleTestError = async () => {
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
  };

  // ── Settings config ──────────────────────────────────────────────
  const settings: SettingEntry[] = useMemo(() => [
    // ── General: Feature Flags (all users) ──
    {
      tab: 'general',
      section: 'Feature Flags',
      title: 'Appearance: Dark Mode',
      description: 'Switch between light and dark theme',
      control: <ColorModeButton />,
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
      tab: 'general',
      section: 'Experimental Flags',
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
  ], [askForConfirmation, isClearing, isTestingError, user?.mode, dispatch, handleClearCache, handleTestError, showAdvanced, isAdmin, isEditorOrAdmin, showSuggestedQuestions, showTrustScore, queueStrategy, allowChatQueue, unrestrictedMode, devMode, showExpandedMessages]);

  // ── Tabs config ──────────────────────────────────────────────────
  const tabs: TabEntry[] = useMemo(() => [
    { id: 'general', label: 'General' },
    { id: 'users', label: 'Users', visible: isAdmin, custom: <UsersContent /> },
    { id: 'appearance', label: 'Appearance', visible: isAdmin, custom: <AppearanceSettings /> },
    {
      id: 'messaging',
      label: 'Messaging',
      visible: isAdmin,
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
    },
    {
      id: 'integrations',
      label: 'Integrations',
      visible: isAdmin,
      custom: (
        <VStack align="stretch" gap={3}>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Connect external services to your MinusX workspace.
          </Text>
          <SlackIntegration />
          <McpIntegration />
        </VStack>
      ),
    },
    {
      id: 'configs',
      label: 'Configs',
      visible: isAdvancedAdmin,
      custom: (
        <FileTabContent
          path={`/${mode}/configs/config`}
          Container={ConfigContainerV2}
          createFolder={`/${mode}/configs`}
          createType="config"
        />
      ),
    },
    {
      id: 'styles',
      label: 'Styles',
      visible: isAdvancedAdmin,
      custom: (
        <FileTabContent
          path={`/${mode}/configs/styles`}
          Container={StylesContainerV2}
          createFolder={`/${mode}/configs`}
          createType="styles"
        />
      ),
    },
    { id: 'dev', label: 'Developer Tools', visible: isAdvancedAdmin },
    {
      id: 'data',
      label: 'Data Management',
      visible: isAdvancedAdmin,
      custom: (
        <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" overflow="hidden">
          <DataManagementSection />
        </Box>
      ),
    },
    { id: 'homepage', label: 'Home Page', visible: isAdvancedAdmin, custom: <HomePageSettings /> },
  ], [isAdmin, isAdvancedAdmin, mode]);

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Settings', href: undefined }
  ];

  if (!user) {
    return null;
  }

  const visibleTabs = tabs.filter((t) => t.visible !== false);
  const needsWideLayout = activeTab === 'users';

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

  return (
    <Box minH="90vh" bg="bg.canvas" display="flex">
      <VStack flex="1" minW="0" position="relative" align="stretch">
        <Box w="100%" flex="1" mx="auto" px={{ base: 4, md: 8, lg: 12 }} pt={{ base: 3, md: 4, lg: 5 }} pb={{ base: 6, md: 8, lg: 10 }}>
          <Flex justify="space-between" align="center" mb={4} gap={4}>
            <Box flex="1" minW={0}>
              <Breadcrumb items={breadcrumbItems} />
            </Box>
          </Flex>

        <Heading
          fontSize={{ base: '3xl', md: '4xl', lg: '5xl' }}
          fontWeight="900"
          letterSpacing="-0.03em"
          mt={10}
          mb={2}
          color="fg.default"
        >
          Settings
        </Heading>

        <Tabs.Root
          value={activeTab}
          onValueChange={(details) => setActiveTab(details.value as TabId)}
          variant="line"
          colorPalette="teal"
          unmountOnExit
        >
          <Tabs.List mb={6}>
            {visibleTabs.map((tab) => (
              <Tabs.Trigger key={tab.id} value={tab.id} fontFamily="mono" fontSize="sm" aria-label={`Settings tab: ${tab.label}`}>
                {tab.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {visibleTabs.map((tab) => (
            <Tabs.Content key={tab.id} value={tab.id} aria-label={`Settings section: ${tab.label}`}>
              {renderTabContent(tab)}
            </Tabs.Content>
          ))}
        </Tabs.Root>

        <Text fontSize="xs" color="fg.subtle" fontFamily="mono" mt={8} mb={2}>
          Build: {GIT_COMMIT_SHA}
        </Text>

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
