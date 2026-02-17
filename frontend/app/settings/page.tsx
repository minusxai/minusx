'use client';

import { useState } from 'react';
import { Box, VStack, Text, Flex, Switch, Button, Heading, Container, Tabs } from '@chakra-ui/react';
import { LuRefreshCw } from 'react-icons/lu';
import { ColorModeButton } from '@/components/ui/color-mode';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setAskForConfirmation, setShowDebug, setShowJson } from '@/store/uiSlice';
import { IS_DEV } from '@/lib/constants';
import RecordingControl from '@/components/RecordingControl';
import DataManagementSection from '@/components/DataManagementSection';
import { toaster } from '@/components/ui/toaster';
import { switchMode } from '@/lib/mode/mode-utils';
import Breadcrumb from '@/components/Breadcrumb';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';

function SettingRow({ children }: { children: React.ReactNode }) {
  return (
    <Flex
      justify="space-between"
      align="center"
      py={5}
      px={6}
      _hover={{ bg: 'bg.subtle' }}
      transition="all 0.15s ease"
    >
      {children}
    </Flex>
  );
}

function SettingLabel({ title, description }: { title: string; description: string }) {
  return (
    <Box flex="1" mr={4}>
      <Text fontSize="sm" fontWeight="medium" fontFamily="mono" mb={1}>
        {title}
      </Text>
      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
        {description}
      </Text>
    </Box>
  );
}

export default function SettingsPage() {
  const dispatch = useAppDispatch();
  const askForConfirmation = useAppSelector((state) => state.ui.askForConfirmation);
  const showDebug = useAppSelector((state) => state.ui.showDebug);
  const showJson = useAppSelector((state) => state.ui.showJson);
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

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Settings', href: undefined }
  ];

  if (!user) {
    return null;
  }

  const settingsCard = (children: React.ReactNode) => (
    <Box
      bg="bg.surface"
      borderRadius="xl"
      shadow="sm"
      borderWidth="1px"
      borderColor="border"
      overflow="hidden"
    >
      <VStack align="stretch" gap={0} divideY="1px">
        {children}
      </VStack>
    </Box>
  );

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
            <Tabs.Trigger value="general" fontFamily="mono" fontSize="sm">
              General
            </Tabs.Trigger>
            {isAdmin && (
              <Tabs.Trigger value="dev" fontFamily="mono" fontSize="sm">
                Dev
              </Tabs.Trigger>
            )}
            {isAdmin && (
              <Tabs.Trigger value="data" fontFamily="mono" fontSize="sm">
                Data Management
              </Tabs.Trigger>
            )}
          </Tabs.List>

          {/* General Tab */}
          <Tabs.Content value="general">
            {settingsCard(
              <>
                {/* Appearance */}
                <SettingRow>
                  <SettingLabel
                    title="Appearance: Dark Mode"
                    description="Switch between light and dark theme"
                  />
                  <ColorModeButton />
                </SettingRow>

                {/* Confirm Actions */}
                <SettingRow>
                  <SettingLabel
                    title="Confirm Actions"
                    description="Confirm before applying AI-suggested changes to any page"
                  />
                  <Switch.Root
                    checked={askForConfirmation}
                    onCheckedChange={(details) => dispatch(setAskForConfirmation(details.checked))}
                    colorPalette="teal"
                  >
                    <Switch.HiddenInput />
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Root>
                </SettingRow>

                {/* Mode Switcher */}
                <SettingRow>
                  <SettingLabel
                    title="Mode"
                    description={`Current: ${user?.mode || 'org'}`}
                  />
                  <Flex gap={2}>
                    <Button
                      size="sm"
                      variant={user?.mode === 'org' ? 'solid' : 'outline'}
                      onClick={() => switchMode('org')}
                    >
                      Org
                    </Button>
                    <Button
                      size="sm"
                      variant={user?.mode === 'tutorial' ? 'solid' : 'outline'}
                      onClick={() => switchMode('tutorial')}
                    >
                      Tutorial
                    </Button>
                  </Flex>
                </SettingRow>
              </>
            )}
          </Tabs.Content>

          {/* Admin Tab */}
          {isAdmin && (
            <Tabs.Content value="dev">
              {settingsCard(
                <>
                  {/* Show Debug Info */}
                  {showDebugOption && (
                    <SettingRow>
                      <SettingLabel
                        title="Show Debug Info"
                        description="Display debug information in the interface"
                      />
                      <Switch.Root
                        checked={showDebug}
                        onCheckedChange={(details) => dispatch(setShowDebug(details.checked))}
                        colorPalette="teal"
                      >
                        <Switch.HiddenInput />
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Root>
                    </SettingRow>
                  )}

                  {/* Show JSON Toggle */}
                  {showDebugOption && (
                    <SettingRow>
                      <SettingLabel
                        title="Show JSON Toggle"
                        description="Display JSON toggle button in the interface"
                      />
                      <Switch.Root
                        checked={showJson}
                        onCheckedChange={(details) => dispatch(setShowJson(details.checked))}
                        colorPalette="teal"
                      >
                        <Switch.HiddenInput />
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Root>
                    </SettingRow>
                  )}

                  {/* Session Recording */}
                  <SettingRow>
                    <SettingLabel
                      title="Session Recording"
                      description="Record your session for debugging and support"
                    />
                    <RecordingControl />
                  </SettingRow>

                  {/* Clear Cache */}
                  <SettingRow>
                    <SettingLabel
                      title="Clear Cache"
                      description="Reload configs, styles, contexts, and connections"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleClearCache}
                      loading={isClearing}
                      disabled={isClearing}
                    >
                      <LuRefreshCw />
                      Clear
                    </Button>
                  </SettingRow>
                </>
              )}
            </Tabs.Content>
          )}

          {/* Data Management Tab */}
          {isAdmin && (
            <Tabs.Content value="data">
              <Box
                bg="bg.surface"
                borderRadius="xl"
                shadow="sm"
                borderWidth="1px"
                borderColor="border"
                overflow="hidden"
              >
                <DataManagementSection />
              </Box>
            </Tabs.Content>
          )}
        </Tabs.Root>
      </Container>
    </Box>
  );
}
