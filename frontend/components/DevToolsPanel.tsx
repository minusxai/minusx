'use client';

import { useState } from 'react';
import { Box, VStack, HStack, Text, IconButton } from '@chakra-ui/react';
import { LuCamera } from 'react-icons/lu';
import { AppState } from '@/lib/appState';
import AppStateViewer from './AppStateViewer';
import { useScreenshot } from '@/lib/hooks/useScreenshot';

interface DevToolsPanelProps {
  appState: AppState | null | undefined;
}

export default function DevToolsPanel({ appState }: DevToolsPanelProps) {
  const { captureFileView } = useScreenshot();
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  const handleScreenshot = async () => {
    if (!appState?.fileId) return;

    setIsCapturingScreenshot(true);
    try {
      const blob = await captureFileView(appState.fileId, { fullHeight: true });
      // Revoke previous URL to avoid memory leaks
      if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
      setScreenshotUrl(URL.createObjectURL(blob));
    } catch (error) {
      console.error('[DevToolsPanel] Screenshot failed:', error);
    } finally {
      setIsCapturingScreenshot(false);
    }
  };

  return (
    <Box p={4}>
      <VStack align="stretch" gap={3}>
        <Text fontSize="sm" fontFamily="mono" color="accent.teal" fontWeight="600">
          Development Mode Active
        </Text>

        {/* Screenshot Capture */}
        {appState?.fileId && (appState.pageType === 'question' || appState.pageType === 'dashboard') && (
          <Box
            borderWidth="1px"
            borderColor="border.default"
            borderRadius="md"
            p={3}
            bg="bg.surface"
          >
            <VStack align="stretch" gap={2}>
              <HStack justify="space-between">
                <Text fontSize="xs" fontWeight="600" color="fg.muted">
                  Screenshot
                </Text>
                <IconButton
                  onClick={handleScreenshot}
                  aria-label="Capture screenshot"
                  size="xs"
                  variant="subtle"
                  loading={isCapturingScreenshot}
                >
                  <LuCamera />
                </IconButton>
              </HStack>
              {screenshotUrl ? (
                <Box
                  borderWidth="1px"
                  borderColor="border.default"
                  borderRadius="sm"
                  overflow="hidden"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshotUrl}
                    alt="Screenshot preview"
                    style={{ width: '100%', height: 'auto' }}
                  />
                </Box>
              ) : (
                <Text fontSize="2xs" color="fg.subtle">
                  Capture a screenshot of the current {appState.pageType}
                </Text>
              )}
            </VStack>
          </Box>
        )}

        <AppStateViewer appState={appState} maxHeight="400px" />
      </VStack>
    </Box>
  );
}
