'use client';

import { useState } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Icon, Flex, Collapsible } from '@chakra-ui/react';
import {
  LuRocket,
  LuDatabase,
  LuNotebookText,
  LuLayoutDashboard,
  LuScanSearch,
  LuSparkles,
  LuChevronDown,
  LuChevronRight,
  LuFileText,
  LuBookOpen,
  LuUsers,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
import NextLink from 'next/link';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { useContexts } from '@/lib/hooks/useContexts';
import { sparkleKeyframes } from '@/lib/ui/animations';

interface GuideItem {
  icon: IconType;
  title: string;
  description: string;
  link?: { label: string; href: string; disabled?: boolean };
}

interface GuideSection {
  title: string;
  items: GuideItem[];
}

function AccordionItem({ item }: { item: GuideItem }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Box
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="lg"
      overflow="hidden"
      transition="all 0.2s"
    >
      <Box
        as="button"
        width="100%"
        display="flex"
        alignItems="center"
        gap={4}
        px={4}
        py={1}
        cursor="pointer"
        bg={isOpen ? 'bg.muted' : 'transparent'}
        _hover={{ bg: 'bg.muted' }}
        transition="background 0.2s"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          w={10}
          h={10}
          borderRadius="lg"
          bg={isOpen ? 'bg.muted' : 'bg.subtle'}
          flexShrink={0}
        >
          <Icon as={item.icon} boxSize={5} color="accent.teal" />
        </Box>
        <Text flex={1} textAlign="left" fontSize="sm" fontWeight="500" fontFamily="mono" color="fg.default">
          {item.title}
        </Text>
        <Icon as={isOpen ? LuChevronDown : LuChevronRight} boxSize={4} color="fg.muted" />
      </Box>
      <Collapsible.Root open={isOpen}>
        <Collapsible.Content>
          <Box px={5} pt={3} pb={4} pl={19}>
            <Text fontSize="sm" color="fg.muted" lineHeight="tall">
              {item.description}
            </Text>
            {item.link && (
              <Flex justify="flex-end" mt={3}>
                {item.link.disabled ? (
                  <Box
                    px={4}
                    py={1.5}
                    bg="bg.muted"
                    color="fg.muted"
                    fontSize="sm"
                    fontWeight="500"
                    fontFamily="mono"
                    borderRadius="md"
                    cursor="not-allowed"
                    opacity={0.6}
                  >
                    {item.link.label}
                  </Box>
                ) : (
                  <NextLink href={item.link.href} style={{ textDecoration: 'none' }}>
                    <Box
                      px={4}
                      py={1.5}
                      bg="accent.teal"
                      color="white"
                      fontSize="sm"
                      fontWeight="500"
                      fontFamily="mono"
                      borderRadius="md"
                      cursor="pointer"
                      _hover={{ opacity: 0.9 }}
                      transition="opacity 0.2s"
                    >
                      {item.link.label}
                    </Box>
                  </NextLink>
                )}
              </Flex>
            )}
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>
    </Box>
  );
}

export default function StepComplete() {
  const router = useRouter();
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const { contexts } = useContexts();
  const firstContext = contexts[0];
  const contextLink = firstContext
    ? { label: 'Edit Context', href: `/f/${firstContext.id}` }
    : { label: 'No Knowledge Base Available', href: '#', disabled: true };

  const sections: GuideSection[] = [
    {
      title: 'Set up your workspace',
      items: [
        {
          icon: LuDatabase,
          title: 'Connect a database',
          description: `Add a database connection so ${agentName} can query your data. Supports DuckDB, PostgreSQL, BigQuery, etc.`,
          link: { label: 'Add Connection', href: '/new/connection' },
        },
        {
          icon: LuNotebookText,
          title: 'Add context about your data',
          description: 'Select which tables are relevant and add business context — column descriptions, metric definitions, team-specific notes.',
          link: contextLink,
        },
        {
          icon: LuUsers,
          title: 'Invite colleagues',
          description: 'Add team members so they can explore data, build dashboards, and collaborate with the AI.',
          link: { label: 'Manage Users', href: '/settings?tab=users' },
        },
      ],
    },
    {
      title: 'Start exploring your data',
      items: [
        {
          icon: LuSparkles,
          title: 'Ask a question in natural language',
          description: `Open Explore and type a question like "What were our top 10 products last month?" — ${agentName} will write the SQL and show you results.`,
          link: { label: 'Open Explore', href: '/explore' },
        },
        {
          icon: LuScanSearch,
          title: 'Create a saved question',
          description: 'Write or generate a SQL query, pick a visualization, and save it for later.',
          link: { label: 'New Question', href: '/new/question' },
        },
        {
          icon: LuLayoutDashboard,
          title: 'Build a dashboard',
          description: 'Combine multiple saved questions into a single view with a grid layout.',
          link: { label: 'New Dashboard', href: '/new/dashboard' },
        },
      ],
    },
    {
      title: `Get the most out of ${agentName}`,
      items: [
        {
          icon: LuFileText,
          title: 'Read the docs',
          description: `Learn about ${agentName}'s features, configuration options, and best practices.`,
          link: { label: 'Open Docs', href: 'https://docsv2.minusx.ai/docs' },
        },
        {
          icon: LuBookOpen,
          title: 'Follow step-by-step guides',
          description: 'Practical walkthroughs for common workflows.',
          link: { label: 'Open Guides', href: 'https://docsv2.minusx.ai/guides' },
        },
      ],
    },
  ];

  return (
    <VStack gap={3} align="stretch">
      <style>{sparkleKeyframes}</style>

      {/* Header */}
      <VStack gap={1} textAlign="center" py={2}>
        <Box css={{ animation: 'sparkle 2s ease-in-out infinite' }}>
          <Icon as={LuRocket} boxSize={10} color="accent.teal" />
        </Box>
        <Heading size="lg" fontFamily="mono" fontWeight="400">
          You&apos;re all set!
        </Heading>
      </VStack>

      {/* Quick actions */}
      <HStack justify="center" gap={4}>
        <Button
          bg="accent.teal"
          color="white"
          _hover={{ opacity: 0.9 }}
          size="sm"
          fontFamily="mono"
          onClick={() => router.push('/')}
        >
          <LuRocket size={14} />
          Go to home
        </Button>
        <Button
          variant="outline"
          size="sm"
          fontFamily="mono"
          onClick={() => router.push('/explore')}
        >
          <LuSparkles size={14} />
          Start exploring
        </Button>
      </HStack>

      {/* Guide sections — same as /getting-started page */}
      <VStack gap={6} align="stretch" pt={2}>
        {sections.map((section) => (
          <Box key={section.title}>
            <Text fontSize="md" fontWeight="700" color="fg.default" mb={2}>
              {section.title}
            </Text>
            <VStack gap={2} align="stretch">
              {section.items.map((item) => (
                <AccordionItem key={item.title} item={item} />
              ))}
            </VStack>
          </Box>
        ))}
      </VStack>
    </VStack>
  );
}
