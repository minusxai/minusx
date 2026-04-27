'use client';

import { useEffect } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { Box, VStack, Flex, Text } from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { isAdmin } from '@/lib/auth/role-helpers';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { preserveModeParam } from '@/lib/mode/mode-utils';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { FeedContent } from '@/components/RecentFilesSection';
import Breadcrumb from '@/components/Breadcrumb';
import FloatingChatWrapper from '@/components/FloatingChatWrapper';

/**
 * Home Page (/)
 *
 * Shows the feed/analytics content. Redirects to onboarding if setup is incomplete.
 */
export default function Home() {
  const router = useRouter();
  const user = useAppSelector(state => state.auth.user);
  const { config, loading: configLoading } = useConfigs();

  // Onboarding redirect
  useEffect(() => {
    if (!user || configLoading) return;

    if (config.setupWizard?.status !== 'complete') {
      router.replace(preserveModeParam('/hello-world'));
      return;
    }
  }, [user, router, config, configLoading]);

  if (!user || configLoading) return null;

  const breadcrumbItems = [{ label: 'Home' }];

  return (
    <Box minH="90vh" bg="bg.canvas" display="flex">
      <VStack flex="1" minW="0" position="relative" align="stretch">
        <Box w="100%" flex="1" mx="auto" px={{ base: 4, md: 8, lg: 12 }} pt={{ base: 3, md: 4, lg: 5 }} pb={{ base: 6, md: 8, lg: 10 }}>
          <Flex justify="space-between" align="center" mb={4} gap={4}>
            <Box flex="1" minW={0}>
              <Breadcrumb items={breadcrumbItems} />
            </Box>
          </Flex>

          <VStack align="stretch" gap={6}>
            <Text fontSize="2xl" fontWeight="700" fontFamily="mono" color="fg.default">
              {config.branding.displayName}
            </Text>
            <FeedContent />
          </VStack>
        </Box>
        <FloatingChatWrapper />
      </VStack>
    </Box>
  );
}
