'use client';

import { useEffect } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { Box, VStack, Flex, Heading, HStack, Text, Icon } from '@chakra-ui/react';
import Link from 'next/link';
import { useAppSelector } from '@/store/hooks';
import { selectHomePage } from '@/store/uiSlice';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { preserveModeParam } from '@/lib/mode/mode-utils';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { FeedSummary, RecentQuestions, RecentDashboards, RecentConversations, SuggestedQuestions } from '@/components/RecentFilesSection';
import Breadcrumb from '@/components/Breadcrumb';
import FloatingChatWrapper from '@/components/FloatingChatWrapper';
import RightSidebar from '@/components/RightSidebar';
import MobileRightSidebar from '@/components/MobileRightSidebar';
import { useBreakpointValue } from '@chakra-ui/react';
import { LuScanSearch, LuFolder, LuHistory, LuBookOpen, LuArrowRight, LuPlay } from 'react-icons/lu';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';

function QuickLink({ href, icon, label, color }: { href: string; icon: React.ElementType; label: string; color: string }) {
  return (
    <Link href={href}>
      <HStack
        gap={2}
        px={4}
        py={1}
        borderRadius="full"
        bg={`${color}/10`}
        cursor="pointer"
        transition="all 0.15s ease"
        _hover={{ bg: `${color}/20`, transform: 'translateY(-1px)' }}
      >
        <Icon as={icon} color={color} boxSize={3.5} />
        <Text fontSize="xs" fontWeight="600" fontFamily="mono" color={color}>
          {label}
        </Text>
      </HStack>
    </Link>
  );
}

/** Panel wrapper for homepage sections — collapses when children render nothing */
function SectionPanel({ children }: { children: React.ReactNode }) {
  return (
    <Box
      bg="bg.subtle"
      borderRadius="lg"
      border="1px solid"
      borderColor="border.muted"
      p={5}
      css={{ '&:not(:has(*))': { display: 'none' } }}
    >
      {children}
    </Box>
  );
}

function ActionCard({ href, icon, color, title, description }: {
  href: string; icon: React.ElementType; color: string; title: string; description: string;
}) {
  return (
    <Link href={href}>
      <HStack
        gap={4}
        px={4}
        py={3}
        borderRadius="lg"
        bg={`${color}/4`}
        cursor="pointer"
        transition="all 0.2s ease"
        _hover={{ bg: `${color}/10` }}
        align="center"
      >
        <Box
          w="36px"
          h="36px"
          borderRadius="lg"
          bg={`${color}/15`}
          display="flex"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Icon as={icon} color={color} boxSize={4} />
        </Box>
        <VStack align="start" gap={0} flex="1" minW={0}>
          <Text fontSize="xs" fontWeight="700" fontFamily="mono" color="fg.default">
            {title}
          </Text>
          <Text fontSize="2xs" color="fg.muted" fontFamily="mono">
            {description}
          </Text>
        </VStack>
        <Icon as={LuArrowRight} color={color} boxSize={3.5} flexShrink={0} opacity={0.6} />
      </HStack>
    </Link>
  );
}

function ColumnEmptyState({ icon, message, linkLabel, linkHref, color }: {
  icon: React.ElementType; message: string; linkLabel: string; linkHref: string; color: string;
}) {
  return (
    <Box bg="bg.subtle" borderRadius="lg" border="1px solid" borderColor="border.muted" p={6}>
      <VStack gap={3} align="center" py={4}>
        <Icon as={icon} color={color} boxSize={6} opacity={0.5} />
        <Text fontSize="xs" color="fg.subtle" fontFamily="mono" textAlign="center">{message}</Text>
        <Link href={linkHref}>
          <HStack
            gap={1.5} px={3} py={1} borderRadius="full"
            bg={`${color}/10`} cursor="pointer" transition="all 0.15s ease"
            _hover={{ bg: `${color}/20` }}
          >
            <Icon as={LuArrowRight} color={color} boxSize={3} />
            <Text fontSize="2xs" fontWeight="600" fontFamily="mono" color={color}>{linkLabel}</Text>
          </HStack>
        </Link>
      </VStack>
    </Box>
  );
}

function WelcomeBanner() {
  return (
    <VStack align="stretch" gap={3}>
      <HStack gap={2}>
        <Text fontSize="2xs" fontFamily="mono" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="wider" flexShrink={0}>
          Get started
        </Text>
        <Box flex="1" h="1px" bg="border.default" />
      </HStack>
      <VStack align="stretch" gap={2}>
        <ActionCard
          href="/explore"
          icon={FILE_TYPE_METADATA.explore.icon}
          color="accent.teal"
          title="Ask a question"
          description="Query your data with natural language or SQL"
        />
        <ActionCard
          href="/hello-world"
          icon={LuBookOpen}
          color="accent.primary"
          title="Take the tutorial"
          description="A quick walkthrough of the key features"
        />
        <ActionCard
          href={`/?mode=tutorial`}
          icon={LuPlay}
          color="accent.secondary"
          title="Try demo mode"
          description="Explore sample data and pre-built dashboards"
        />
      </VStack>
    </VStack>
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

  const isMobile = useBreakpointValue({ base: true, md: false });
  const homePage = useAppSelector(selectHomePage);

  if (!user || configLoading) return null;

  const homePath = resolveHomeFolderSync(user.mode, user.home_folder || '');
  const mode = user.mode || 'org';
  const breadcrumbItems = [{ label: 'Home' }];
  const leftColEmpty = !homePage.showFeedSummary && !homePage.showRecentQuestions;
  const rightColEmpty = !homePage.showRecentDashboards && !homePage.showRecentConversations;
  const isNewUser = config.setupWizard?.status !== 'complete';

  return (
    <Box minH="90vh" bg="bg.canvas" display="flex">
      <VStack flex="1" minW="0" position="relative" align="stretch">
        <Box w="100%" flex="1" mx="auto" px={{ base: 4, md: 8, lg: 12 }} pt={{ base: 3, md: 4, lg: 5 }} pb={{ base: 6, md: 8, lg: 10 }} css={{ containerType: 'inline-size' }}>
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

          <HStack gap={1} mt={4} mb={8} flexWrap="wrap">
            <QuickLink href="/explore" icon={FILE_TYPE_METADATA.explore.icon} label="Explore" color="accent.teal" />
            <QuickLink href={`/p/${mode}`} icon={LuFolder} label="Files" color="accent.primary" />
            <QuickLink href="/conversations" icon={LuHistory} label="Conversations" color="accent.secondary" />
          </HStack>

          {/* Two-column layout — switches at 700px container width */}
          <Flex gap={2} css={{ flexDirection: 'column', '@container (min-width: 700px)': { flexDirection: 'row' } }}>
            {/* Left column */}
            <VStack flex="1" minW={0} align="stretch" gap={2}>
              {isNewUser ? (
                <SectionPanel>
                  <WelcomeBanner />
                </SectionPanel>
              ) : leftColEmpty ? (
                <ColumnEmptyState
                  icon={LuScanSearch}
                  message="Start exploring your data"
                  linkLabel="Go to Explore"
                  linkHref="/explore"
                  color="accent.teal"
                />
              ) : (
                <>
                  <SectionPanel><RecentQuestions /></SectionPanel>
                  <SectionPanel><RecentDashboards /></SectionPanel>
                </>
              )}
            </VStack>

            {/* Right column — dashboards + conversations */}
            <VStack
              css={{ width: '100%', '@container (min-width: 700px)': { width: '340px' } }}
              flexShrink={0}
              align="stretch"
              gap={2}
            >
              {rightColEmpty ? (
                <ColumnEmptyState
                  icon={LuFolder}
                  message="Browse your files and dashboards"
                  linkLabel="View Files"
                  linkHref={`/p/${mode}`}
                  color="accent.primary"
                />
              ) : (
                <>
                  <SectionPanel><FeedSummary /></SectionPanel>
                  <SectionPanel><RecentConversations /></SectionPanel>
                  <SectionPanel><SuggestedQuestions /></SectionPanel>
                </>
              )}
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
