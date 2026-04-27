'use client';

import { useEffect } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { Box, VStack, Flex, Heading, HStack, Text, Icon } from '@chakra-ui/react';
import Link from 'next/link';
import { useAppSelector } from '@/store/hooks';
import { isAdmin } from '@/lib/auth/role-helpers';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { preserveModeParam } from '@/lib/mode/mode-utils';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { FeedSummary, RecentQuestions, RecentDashboards, RecentConversations } from '@/components/RecentFilesSection';
import Breadcrumb from '@/components/Breadcrumb';
import FloatingChatWrapper from '@/components/FloatingChatWrapper';
import RightSidebar from '@/components/RightSidebar';
import MobileRightSidebar from '@/components/MobileRightSidebar';
import { useBreakpointValue } from '@chakra-ui/react';
import { LuScanSearch, LuLayoutDashboard, LuFolder, LuHistory } from 'react-icons/lu';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';

function QuickLink({ href, icon, label, color }: { href: string; icon: React.ElementType; label: string; color: string }) {
  return (
    <Link href={href}>
      <HStack
        gap={2.5}
        px={4}
        py={3}
        borderRadius="lg"
        bg="bg.surface"
        border="1px solid"
        borderColor="border.muted"
        cursor="pointer"
        transition="all 0.2s ease"
        _hover={{ borderColor: color, bg: `${color}/8`, transform: 'translateY(-1px)', boxShadow: 'sm' }}
      >
        <Icon as={icon} color={color} boxSize={4} />
        <Text fontSize="xs" fontWeight="600" fontFamily="mono" color="fg.default">
          {label}
        </Text>
      </HStack>
    </Link>
  );
}

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

  const isMobile = useBreakpointValue({ base: true, md: false }, { ssr: false });

  if (!user || configLoading) return null;

  const homePath = resolveHomeFolderSync(user.mode, user.home_folder || '');
  const mode = user.mode || 'org';
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

          {/* Title — matches FolderView style */}
          <Heading
            fontSize={{ base: '3xl', md: '4xl', lg: '5xl' }}
            fontWeight="900"
            letterSpacing="-0.03em"
            color="fg.default"
            mt={4}
            mb={2}
          >
            {config.branding.displayName}
          </Heading>

          {/* Quick links */}
          <HStack gap={3} mt={4} mb={8} flexWrap="wrap">
            <QuickLink href="/explore" icon={FILE_TYPE_METADATA.explore.icon} label="Explore" color="accent.teal" />
            <QuickLink href={`/p/${mode}`} icon={LuFolder} label="Files" color="accent.primary" />
            <QuickLink href="/conversations" icon={LuHistory} label="Conversations" color="accent.secondary" />
          </HStack>

          {/* Two-column layout */}
          <Flex gap={8} direction={{ base: 'column', lg: 'row' }}>
            {/* Left column — summary + recent questions */}
            <VStack flex="1" minW={0} align="stretch" gap={6}>
              <FeedSummary />
              <RecentQuestions />
            </VStack>

            {/* Right column — dashboards + conversations */}
            <VStack
              w={{ base: '100%', lg: '340px' }}
              flexShrink={0}
              align="stretch"
              gap={6}
            >
              <RecentDashboards />
              <RecentConversations />
            </VStack>
          </Flex>
        </Box>
        <FloatingChatWrapper />
      </VStack>
      {isMobile === false && (
        <RightSidebar
          filePath={homePath}
          showChat={true}
        />
      )}
      {isMobile === true && (
        <MobileRightSidebar
          filePath={homePath}
          showChat={true}
        />
      )}
    </Box>
  );
}
