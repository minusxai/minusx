'use client';

import { useState } from 'react';
import { Box, Flex, Heading, Text, VStack, Icon, Collapsible } from '@chakra-ui/react';
import {
  LuDatabase,
  LuScanSearch,
  LuLayoutDashboard,
  LuNotebookText,
  LuSparkles,
  LuChevronDown,
  LuChevronRight,
  LuFileText,
  LuBookOpen,
  LuUsers,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
import NextLink from 'next/link';
import Breadcrumb from '@/components/Breadcrumb';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { useContexts } from '@/lib/hooks/useContexts';

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

export default function GettingStartedPage() {
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
          description: 'Select which tables are relevant and add business context — column descriptions, metric definitions, team-specific notes. This helps the agent write better queries.',
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
          description: 'Write or generate a SQL query, pick a visualization (table, bar, line, pie, etc.), and save it for later. Saved questions can be added to dashboards.',
          link: { label: 'New Question', href: '/new/question' },
        },
        {
          icon: LuLayoutDashboard,
          title: 'Build a dashboard',
          description: 'Combine multiple saved questions into a single view with a grid layout. Add parameters to filter across all questions at once.',
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
          description: 'Practical walkthroughs for common workflows — connecting databases, writing context, building dashboards, and more.',
          link: { label: 'Open Guides', href: 'https://docsv2.minusx.ai/guides' },
        },
      ],
    },
  ];

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Getting Started', href: undefined },
  ];

  return (
    <Box minH="100vh" bg="bg.canvas">
      <Box px={{ base: 4, md: 8, lg: 12 }} pt={{ base: 3, md: 4, lg: 5 }} pb={{ base: 6, md: 8, lg: 10 }}>
        <Breadcrumb items={breadcrumbItems} />

        <Heading
          fontSize={{ base: '3xl', md: '4xl', lg: '5xl' }}
          fontWeight="900"
          letterSpacing="-0.03em"
          mt={10}
          mb={3}
          color="fg.default"
        >
          Getting Started
        </Heading>
        <Text fontSize="md" color="fg.muted" mb={10}>
          Everything you need to go from zero to insights with {agentName}.
        </Text>

        <VStack alignItems={"center"} justify={"center"}>
            <VStack alignItems={"stretch"} w={{ base: '100%', md: '80%', lg: '50%' }}>
            {sections.map((section) => (
                <Box key={section.title}>
                <Text
                    fontSize="lg"
                    fontWeight="700"
                    color="fg.default"
                    mb={2}
                >
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
      </Box>
    </Box>
  );
}
