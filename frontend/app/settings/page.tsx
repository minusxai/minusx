'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Box, VStack, Text, Flex, Switch, Button, Heading, Container, Icon } from '@chakra-ui/react';
import { LuChevronRight, LuRefreshCw } from 'react-icons/lu';
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

type SettingsView = 'main' | 'data-management';

export default function SettingsPage() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const askForConfirmation = useAppSelector((state) => state.ui.askForConfirmation);
  const showDebug = useAppSelector((state) => state.ui.showDebug);
  const showJson = useAppSelector((state) => state.ui.showJson);
  const user = useAppSelector((state) => state.auth.user);
  const [currentView, setCurrentView] = useState<SettingsView>('main');
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

      // Optionally reload the page after a short delay
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

  // Don't render until user is loaded
  if (!user) {
    return null;
  }

  return (
    <Box minH="100vh" bg="bg.canvas">
      <Container maxW="container.md" py={{ base: 4, md: 8 }} px={{ base: 4, md: 8 }}>
        <Breadcrumb items={breadcrumbItems} />

        {currentView === 'main' ? (
          <Box>
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

            <Box
              bg="bg.surface"
              borderRadius="xl"
              shadow="sm"
              borderWidth="1px"
              borderColor="border"
              overflow="hidden"
            >
              <VStack align="stretch" gap={0} divideY="1px">
                {/* Dark Mode Setting */}
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
                      Appearance
                    </Text>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                      Switch between light and dark theme
                    </Text>
                  </Box>
                  <ColorModeButton />
                </Flex>

                {/* Mode Switcher */}
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
                      Mode
                    </Text>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                      Current: {user?.mode || 'org'}
                    </Text>
                  </Box>
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
                </Flex>

                {/* Ask for Confirmation Setting */}
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
                      Confirm Actions
                    </Text>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                      Confirm before applying AI-suggested changes to any page
                    </Text>
                  </Box>
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
                </Flex>

                {/* Show Debug Setting - Admin + Dev Mode Only */}
                {showDebugOption && (
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
                        Show Debug Info
                      </Text>
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                        Display debug information in the interface
                      </Text>
                    </Box>
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
                  </Flex>
                )}

                {/* Show JSON Setting - Admin + Dev Mode Only */}
                {showDebugOption && (
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
                        Show JSON Toggle
                      </Text>
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                        Display JSON toggle button in the interface
                      </Text>
                    </Box>
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
                  </Flex>
                )}

                {/* Session Recording - Admin Only */}
                {isAdmin && (
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
                        Session Recording
                      </Text>
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                        Record your session for debugging and support
                      </Text>
                    </Box>
                    <RecordingControl />
                  </Flex>
                )}

                {/* Clear Cache - Admin Only */}
                {isAdmin && (
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
                        Clear Cache
                      </Text>
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                        Reload configs, styles, contexts, and connections
                      </Text>
                    </Box>
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
                  </Flex>
                )}

                {/* Data Management - Admin Only */}
                {isAdmin && (
                  <Flex
                    justify="space-between"
                    align="center"
                    py={5}
                    px={6}
                    _hover={{ bg: 'bg.subtle' }}
                    transition="all 0.15s ease"
                    cursor="pointer"
                    onClick={() => setCurrentView('data-management')}
                  >
                    <Box flex="1" mr={4}>
                      <Text fontSize="sm" fontWeight="medium" fontFamily="mono" mb={1}>
                        Data Management
                      </Text>
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                        Export, validate, and import database
                      </Text>
                    </Box>
                    <Icon fontSize="xl" color="fg.muted">
                      <LuChevronRight />
                    </Icon>
                  </Flex>
                )}
              </VStack>
            </Box>
          </Box>
        ) : (
          <Box mt={10}>
            <Box
              bg="bg.surface"
              borderRadius="xl"
              shadow="sm"
              borderWidth="1px"
              borderColor="border"
              overflow="hidden"
            >
              {/* DataManagementSection has its own header with back button */}
              <DataManagementSection onBack={() => setCurrentView('main')} />
            </Box>
          </Box>
        )}
      </Container>
    </Box>
  );
}
