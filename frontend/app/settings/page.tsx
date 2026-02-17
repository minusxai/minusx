'use client';

import { useState, ReactNode, useMemo } from 'react';
import { Box, VStack, Text, Flex, Switch, Button, Heading, Container, Tabs } from '@chakra-ui/react';
import { LuRefreshCw } from 'react-icons/lu';
import { ColorModeButton } from '@/components/ui/color-mode';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setAskForConfirmation, setShowDebug, setShowJson, setSelectedToolset } from '@/store/uiSlice';
import { IS_DEV } from '@/lib/constants';
import RecordingControl from '@/components/RecordingControl';
import DataManagementSection from '@/components/DataManagementSection';
import { toaster } from '@/components/ui/toaster';
import { switchMode } from '@/lib/mode/mode-utils';
import Breadcrumb from '@/components/Breadcrumb';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';

type TabId = 'general' | 'dev' | 'data';

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

export default function SettingsPage() {
  const dispatch = useAppDispatch();
  const askForConfirmation = useAppSelector((state) => state.ui.askForConfirmation);
  const showDebug = useAppSelector((state) => state.ui.showDebug);
  const showJson = useAppSelector((state) => state.ui.showJson);
  const selectedToolset = useAppSelector((state) => state.ui.selectedToolset);
  const user = useAppSelector((state) => state.auth.user);
  const [isClearing, setIsClearing] = useState(false);

  const isAdmin = user?.role === 'admin';
  const showDebugOption = isAdmin && IS_DEV;

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
      title: 'Agent Toolset',
      description: `Current: ${selectedToolset}`,
      control: (
        <Flex gap={2}>
          <Button size="sm" variant={selectedToolset === 'classic' ? 'solid' : 'outline'}
            onClick={() => dispatch(setSelectedToolset('classic'))}>Classic</Button>
          <Button size="sm" variant={selectedToolset === 'native' ? 'solid' : 'outline'}
            onClick={() => dispatch(setSelectedToolset('native'))}>Native</Button>
        </Flex>
      ),
      visible: showDebugOption,
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
  ], [askForConfirmation, showDebug, showJson, selectedToolset, showDebugOption, isClearing, user?.mode, dispatch, handleClearCache]);

  // ── Tabs config ──────────────────────────────────────────────────
  const tabs: TabEntry[] = useMemo(() => [
    { id: 'general', label: 'General' },
    { id: 'dev', label: 'Dev', visible: isAdmin },
    {
      id: 'data',
      label: 'Data Management',
      visible: isAdmin,
      custom: (
        <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" overflow="hidden">
          <DataManagementSection />
        </Box>
      ),
    },
  ], [isAdmin]);

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Settings', href: undefined }
  ];

  if (!user) {
    return null;
  }

  const visibleTabs = tabs.filter((t) => t.visible !== false);

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
      <Container maxW="container.md" py={{ base: 4, md: 8 }} px={{ base: 4, md: 8 }}>
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

        <Tabs.Root defaultValue="general" variant="line" colorPalette="teal">
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
      </Container>
    </Box>
  );
}
