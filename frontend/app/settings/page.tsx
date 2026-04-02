'use client';

import { useState, ReactNode, useMemo, Suspense } from 'react';
import { Box, VStack, Text, Flex, Switch, Button, Heading, Container, Tabs } from '@chakra-ui/react';
import { LuRefreshCw } from 'react-icons/lu';
import { ColorModeButton } from '@/components/ui/color-mode';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setAskForConfirmation, setShowDebug, setShowJson, setShowAllErrorToasts, setShowAdvanced } from '@/store/uiSlice';
import RecordingControl from '@/components/RecordingControl';
import DataManagementSection from '@/components/DataManagementSection';
import { ChannelsSection } from '@/components/settings/ChannelsSection';
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
import { useSearchParams } from 'next/navigation';
import { useFileByPath } from '@/lib/hooks/file-state-hooks';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';

type TabId = 'general' | 'dev' | 'data' | 'users' | 'configs' | 'styles' | 'messaging';

interface SettingEntry {
  tab: TabId;
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

function SettingRow({ title, description, control }: { title: string; description: string; control: ReactNode }) {
  return (
    <Flex
      justify="space-between"
      align="center"
      py={5}
      px={6}
      _hover={{ bg: 'bg.subtle' }}
      transition="all 0.15s ease"
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

function SettingsContent() {
  const dispatch = useAppDispatch();
  const askForConfirmation = useAppSelector((state) => state.ui.askForConfirmation);
  const showDebug = useAppSelector((state) => state.ui.showDebug);
  const showJson = useAppSelector((state) => state.ui.showJson);
  const showAllErrorToasts = useAppSelector((state) => state.ui.showAllErrorToasts);
  const user = useAppSelector((state) => state.auth.user);
  const [isClearing, setIsClearing] = useState(false);
  const [isTestingError, setIsTestingError] = useState(false);
  const showAdvanced = useAppSelector((state) => state.ui.showAdvanced);

  const searchParams = useSearchParams();
  const initialTab = (searchParams?.get('tab') as TabId) || 'general';
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  const mode = user?.mode || 'org';

  const isAdmin = user?.role === 'admin';
  const isAdvancedAdmin = isAdmin && showAdvanced;
  const showDebugOption = isAdvancedAdmin;

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
    {
      tab: 'general',
      title: 'Appearance: Dark Mode',
      description: 'Switch between light and dark theme',
      control: <ColorModeButton />,
    },
    {
      tab: 'general',
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
      title: 'Advanced',
      description: 'Show advanced tabs: Configs, Styles, Dev, and Data Management',
      control: (
        <SwitchControl
          checked={showAdvanced}
          onChange={(checked) => dispatch(setShowAdvanced(checked))}
        />
      ),
      visible: isAdmin,
    },
    {
      tab: 'dev',
      title: 'Show Debug Info',
      description: 'Display debug information in the interface',
      control: (
        <SwitchControl
          checked={showDebug}
          onChange={(checked) => dispatch(setShowDebug(checked))}
        />
      ),
      visible: showDebugOption,
    },
    {
      tab: 'dev',
      title: 'Show JSON Toggle',
      description: 'Display JSON toggle button in the interface',
      control: (
        <SwitchControl
          checked={showJson}
          onChange={(checked) => dispatch(setShowJson(checked))}
        />
      ),
      visible: showDebugOption,
    },
    {
      tab: 'dev',
      title: 'Show all error toasts',
      description: 'Display all error notifications including recoverable hydration errors (admin only)',
      control: (
        <SwitchControl
          checked={showAllErrorToasts}
          onChange={(checked) => dispatch(setShowAllErrorToasts(checked))}
        />
      ),
      visible: showDebugOption,
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
      visible: showDebugOption,
    },
  ], [askForConfirmation, showDebug, showJson, showAllErrorToasts, showDebugOption, isClearing, isTestingError, user?.mode, dispatch, handleClearCache, handleTestError, showAdvanced, isAdmin]);

  // ── Tabs config ──────────────────────────────────────────────────
  const tabs: TabEntry[] = useMemo(() => [
    { id: 'general', label: 'General' },
    { id: 'users', label: 'Users', visible: isAdmin, custom: <UsersContent /> },
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
    { id: 'dev', label: 'Dev', visible: isAdvancedAdmin },
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
    return (
      <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" overflow="hidden">
        <VStack align="stretch" gap={0} divideY="1px">
          {tabSettings.map((s) => (
            <SettingRow key={s.title} title={s.title} description={s.description} control={s.control} />
          ))}
        </VStack>
      </Box>
    );
  };

  return (
    <Box minH="100vh" bg="bg.canvas">
      <Container maxW={needsWideLayout ? 'container.xl' : 'container.md'} py={{ base: 4, md: 8 }} px={{ base: 4, md: 8 }} transition="max-width 0.2s">
        <Breadcrumb items={breadcrumbItems} />

        <Heading
          fontSize={{ base: '3xl', md: '4xl', lg: '5xl' }}
          fontWeight="900"
          letterSpacing="-0.03em"
          mt={10}
          mb={8}
          color="fg.default"
        >
          Settings
        </Heading>

        <Tabs.Root
          value={activeTab}
          onValueChange={(details) => setActiveTab(details.value as TabId)}
          variant="line"
          colorPalette="teal"
        >
          <Tabs.List mb={6}>
            {visibleTabs.map((tab) => (
              <Tabs.Trigger key={tab.id} value={tab.id} fontFamily="mono" fontSize="sm">
                {tab.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {visibleTabs.map((tab) => (
            <Tabs.Content key={tab.id} value={tab.id}>
              {renderTabContent(tab)}
            </Tabs.Content>
          ))}
        </Tabs.Root>

        <Text mt={12} fontSize="xs" color="fg.subtle" fontFamily="mono" textAlign="center">
          build: {GIT_COMMIT_SHA}
        </Text>
      </Container>
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
