'use client';

import { useState } from 'react';
import { Box, Heading, Text, VStack, HStack, Icon, Collapsible } from '@chakra-ui/react';
import {
  LuDatabase,
  LuScanSearch,
  LuLayoutDashboard,
  LuNotebookText,
  LuSparkles,
  LuChevronDown,
  LuChevronRight,
  LuExternalLink,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
import NextLink from 'next/link';
import Breadcrumb from '@/components/Breadcrumb';
import { useConfigs } from '@/lib/hooks/useConfigs';

interface GuideItem {
  icon: IconType;
  title: string;
  description: string;
  link?: { label: string; href: string };
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
        px={5}
        py={4}
        cursor="pointer"
        _hover={{ bg: 'bg.subtle' }}
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
          bg="bg.subtle"
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
          <Box px={5} pb={4} pl={19}>
            <Text fontSize="sm" color="fg.muted" lineHeight="tall" mb={item.link ? 3 : 0}>
              {item.description}
            </Text>
            {item.link && (
              <NextLink href={item.link.href} style={{ textDecoration: 'none' }}>
                <HStack
                  gap={1}
                  color="accent.teal"
                  fontSize="sm"
                  fontWeight="500"
                  _hover={{ opacity: 0.8 }}
                  transition="opacity 0.2s"
                >
                  <Text>{item.link.label}</Text>
                  <Icon as={LuExternalLink} boxSize={3} />
                </HStack>
              </NextLink>
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

  const sections: GuideSection[] = [
    {
      title: 'Set up your workspace',
      items: [
        {
          icon: LuDatabase,
          title: 'Connect a database',
          description: `Add a database connection so ${agentName} can query your data. Supports DuckDB, PostgreSQL, and BigQuery.`,
          link: { label: 'Add Connection', href: '/new/connection' },
        },
        {
          icon: LuNotebookText,
          title: 'Add context about your data',
          description: 'Select which tables are relevant and add business context — column descriptions, metric definitions, team-specific notes. This helps the AI write better queries.',
          link: { label: 'Add Context', href: '/new/context' },
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
          icon: LuNotebookText,
          title: 'Write good context',
          description: 'The better your context, the better the AI performs. Include things like: what each table represents, how key metrics are calculated, and any naming conventions or gotchas in your schema.',
        },
        {
          icon: LuSparkles,
          title: 'Iterate with the AI',
          description: `You can refine results by chatting — ask ${agentName} to filter, group, change the visualization, or fix errors. The AI sees your current query and results, so it can build on what you have.`,
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
            <VStack gap={10} align="stretch">
            {sections.map((section) => (
                <Box key={section.title}>
                <Text
                    fontSize="lg"
                    fontWeight="700"
                    color="fg.default"
                    mb={4}
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

            {/* Footer links */}
            <Box mt={12} mb={8} pt={8} borderTop="1px solid" borderColor="border.default" textAlign="center">
            <Text fontSize="sm" color="fg.muted" lineHeight="tall">
                {agentName} can do a lot. To learn more, check out our{' '}
                <NextLink href={config.links.docsUrl} target="_blank" style={{ color: 'var(--chakra-colors-accent-teal)', textDecoration: 'underline' }}>
                Docs
                </NextLink>
                {' '}or reach out via{' '}
                <NextLink href={config.links.supportUrl} target="_blank" style={{ color: 'var(--chakra-colors-accent-teal)', textDecoration: 'underline' }}>
                Support
                </NextLink>.
            </Text>
            </Box>
            </VStack>
        </VStack>
      </Box>
    </Box>
  );
}
