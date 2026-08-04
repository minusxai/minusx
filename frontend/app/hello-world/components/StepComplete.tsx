'use client';

import { useState, useMemo } from 'react';
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
  LuCheck,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
// Param-preserving Link so tutorial/getting-started links keep ?v=2 (and as_user/mode).
import { Link as NextLink } from '@/components/ui/Link';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { useContexts } from '@/lib/hooks/useContexts';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { sparkleKeyframes } from '@/lib/ui/animations';

// ── Guide configuration ──────────────────────────────────────────────
// Edit these to change what shows on the "You're all set" page.
// Each section has a title and a list of accordion items.
// Items can have an optional link — either a literal (label + href + disabled flag)
// or the string 'context', resolved at render time to the first context file.
// Use the {agentName} placeholder in titles/descriptions — it's replaced at render time.

/** What the workspace actually contains, for rows that can already be satisfied. */
interface SetupState {
  connectionName?: string;
  /** Only a context with docs counts — see `doneWhen` on the context row. */
  contextName?: string;
  dashboardName?: string;
}

interface GuideItemConfig {
  icon: IconType;
  title: string;
  /** Use {agentName} as a placeholder — replaced at render time */
  description: string;
  link?: { label: string; href: string; disabled?: boolean } | 'context';
  /**
   * Whether this row is already satisfied. Omit for rows that are pure suggestion — most of
   * this list is "here is what you could do next", and a tick on those would be noise.
   */
  doneWhen?: (state: SetupState) => boolean;
}

interface GuideSectionConfig {
  title: string;
  items: GuideItemConfig[];
}

const GUIDE_SECTIONS: GuideSectionConfig[] = [
  {
    title: 'Set up your workspace',
    items: [
      {
        icon: LuDatabase,
        title: 'Connect a database',
        description: 'Add a database connection so {agentName} can query your data. Supports DuckDB, PostgreSQL, BigQuery, etc.',
        link: { label: 'Add Dataset', href: '/new/connection' },
        doneWhen: (s) => !!s.connectionName,
      },
      {
        icon: LuNotebookText,
        title: 'Add context about your data',
        description: 'Select which tables are relevant and add business context — column descriptions, metric definitions, team-specific notes.',
        link: 'context',
        doneWhen: (s) => !!s.contextName,
      },
      {
        icon: LuUsers,
        title: 'Invite colleagues',
        // Deliberately no `doneWhen`. A solo workspace genuinely has not done this, and it is the
        // one row in this section that stays a real suggestion after the wizard finishes.
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
        description: 'Open Explore and type a question like "What were our top 10 products last month?" — {agentName} will write the SQL and show you results.',
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
    title: 'Get the most out of {agentName}',
    items: [
      {
        icon: LuFileText,
        title: 'Read the docs',
        description: 'Learn about {agentName}\'s features, configuration options, and best practices.',
        link: { label: 'Open Docs', href: 'https://docs.minusx.ai/docs' },
      },
      {
        icon: LuBookOpen,
        title: 'Follow step-by-step guides',
        description: 'Practical walkthroughs for common workflows.',
        link: { label: 'Open Guides', href: 'https://docs.minusx.ai/guides' },
      },
    ],
  },
];

const QUICK_ACTIONS = [
  { label: 'Start exploring', icon: LuSparkles, href: '/explore', variant: 'solid' as const },
  { label: 'Read the docs', icon: LuRocket, href: 'https://docs.minusx.ai/docs', variant: 'outline' as const },
];

// ── Components ───────────────────────────────────────────────────────

interface ResolvedLink {
  label: string;
  href: string;
  disabled?: boolean;
}

function AccordionItem({ icon, title, description, link, done = false }: {
  icon: IconType;
  title: string;
  description: string;
  link?: ResolvedLink;
  done?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Box
      data-guide-item
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
          <Icon as={done ? LuCheck : icon} boxSize={5} color="accent.teal" />
        </Box>
        <Text
          flex={1}
          textAlign="left"
          fontSize="sm"
          fontWeight="500"
          fontFamily="mono"
          color={done ? 'fg.muted' : 'fg.default'}
        >
          {title}
        </Text>
        {done && (
          <Text
            aria-label={`${title} — done`}
            fontSize="2xs"
            fontFamily="mono"
            color="accent.teal"
            textTransform="uppercase"
            letterSpacing="0.08em"
            mr={1}
          >
            Done
          </Text>
        )}
        <Icon as={isOpen ? LuChevronDown : LuChevronRight} boxSize={4} color="fg.muted" />
      </Box>
      <Collapsible.Root open={isOpen}>
        <Collapsible.Content>
          <Box px={5} pt={3} pb={4} pl={19}>
            <Text fontSize="sm" color="fg.muted" lineHeight="tall">
              {description}
            </Text>
            {link && (
              <Flex justify="flex-end" mt={3}>
                {link.disabled ? (
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
                    {link.label}
                  </Box>
                ) : (
                  <NextLink href={link.href} style={{ textDecoration: 'none' }}>
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
                      {link.label}
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
  const { contexts, homeContext } = useContexts();
  const firstContext = contexts[0];

  // The onboarding "Build" step creates a dashboard ("Getting Started Dashboard"). Surface a direct
  // link to it here — the most recently created dashboard (highest id) the user can access — so the
  // completion screen closes the loop instead of only offering generic CTAs.
  const dashboardCriteria = useMemo(() => ({ type: 'dashboard' as const }), []);
  const { files: dashboardFiles } = useFilesByCriteria({ criteria: dashboardCriteria, partial: true });
  const latestDashboard = useMemo(() => {
    // Drafts are excluded, not just synthetic negative ids. An unpublished draft dashboard keeps a
    // real positive id in the store, so it used to satisfy this filter and render a CTA pointing at
    // a file the server does not list — a button that looks live and goes nowhere. Only a published
    // dashboard is something the user can actually be sent to.
    const real = dashboardFiles.filter((f) => (f.id as number) > 0 && f.draft !== true);
    return real.length ? real.reduce((a, b) => ((a.id as number) > (b.id as number) ? a : b)) : null;
  }, [dashboardFiles]);

  // What this workspace actually has, so the checklist below can stop listing finished work as
  // pending and the summary can name what the wizard produced.
  const connectionCriteria = useMemo(() => ({ type: 'connection' as const }), []);
  const { files: connectionFiles } = useFilesByCriteria({ criteria: connectionCriteria, partial: true });

  const setupState: SetupState = useMemo(() => {
    const connection = connectionFiles.find((f) => (f.id as number) > 0 && f.draft !== true);

    // Read docs off `homeContext`, NOT off the `contexts` list. That list is a `partial: true`
    // load — metadata only, no `content` at all — so any docs check against it is always false and
    // the row would never tick in production however many docs exist. `homeContext` is the one
    // context useContexts fully loads, and it resolves to the direct child of the home folder,
    // which is where the wizard writes its "Knowledge Base".
    //
    // Existence is deliberately not the test: the workspace seeds a context per folder and several
    // ship named "Knowledge Base" holding nothing, so ticking on existence would mark this done for
    // a user who skipped the step entirely. Only docs count.
    const docs =
      (homeContext?.content as { fullDocs?: unknown[]; versions?: { docs?: unknown[] }[] } | undefined);
    const hasDocs =
      (Array.isArray(docs?.fullDocs) && docs.fullDocs.length > 0) ||
      (Array.isArray(docs?.versions?.[0]?.docs) && docs.versions[0].docs.length > 0);

    return {
      connectionName: connection?.name,
      contextName: hasDocs ? homeContext?.name : undefined,
      dashboardName: latestDashboard?.name,
    };
  }, [connectionFiles, homeContext, latestDashboard]);

  const builtItems = useMemo(() => [
    setupState.connectionName && { label: 'Connected', value: setupState.connectionName, icon: LuDatabase },
    setupState.contextName && { label: 'Documented', value: setupState.contextName, icon: LuNotebookText },
    setupState.dashboardName && { label: 'Built', value: setupState.dashboardName, icon: LuLayoutDashboard },
  ].filter(Boolean) as { label: string; value: string; icon: IconType }[], [setupState]);

  const resolveTemplate = (s: string) => s.replace(/\{agentName\}/g, agentName);

  const resolveLink = (link: GuideItemConfig['link']): ResolvedLink | undefined => {
    if (!link) return undefined;
    if (link === 'context') {
      return firstContext
        ? { label: 'Edit Context', href: `/f/${firstContext.id}` }
        : { label: 'No Knowledge Base Available', href: '#', disabled: true };
    }
    return link;
  };

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

      {/* What setup actually produced. Without this the screen congratulates the user and then
          immediately lists the work it just did for them as still pending, naming none of it. */}
      {builtItems.length > 0 && (
        <Box
          aria-label="What setup created"
          borderWidth="1px"
          borderColor="accent.teal/30"
          bg="accent.teal/5"
          borderRadius="lg"
          px={4}
          py={3}
        >
          <VStack gap={1.5} align="stretch">
            {builtItems.map((built) => (
              <HStack key={built.label} gap={2}>
                <Icon as={built.icon} boxSize={3.5} color="accent.teal" flexShrink={0} />
                <Text fontSize="xs" fontFamily="mono" color="fg.muted">
                  {built.label}
                </Text>
                <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="500">
                  {built.value}
                </Text>
              </HStack>
            ))}
          </VStack>
        </Box>
      )}

      {/* Primary CTA: jump straight to the dashboard the onboarding just built */}
      {latestDashboard && (
        <HStack justify="center" pb={1}>
          <Button
            bg="accent.teal"
            color="white"
            size="md"
            fontFamily="mono"
            _hover={{ opacity: 0.9 }}
            onClick={() => router.push(`/f/${latestDashboard.id}`)}
          >
            <LuLayoutDashboard size={16} />
            View your dashboard
          </Button>
        </HStack>
      )}

      {/* Quick actions */}
      <HStack justify="center" gap={4} flexWrap="wrap">
        {QUICK_ACTIONS.map((action) => (
          <Button
            key={action.href}
            bg={action.variant === 'solid' ? 'accent.teal' : undefined}
            color={action.variant === 'solid' ? 'white' : undefined}
            variant={action.variant === 'outline' ? 'outline' : undefined}
            _hover={action.variant === 'solid' ? { opacity: 0.9 } : undefined}
            size="sm"
            fontFamily="mono"
            onClick={() => router.push(action.href)}
          >
            <action.icon size={14} />
            {action.label}
          </Button>
        ))}
      </HStack>

      {/* Guide sections */}
      <VStack gap={6} align="stretch" pt={2}>
        {GUIDE_SECTIONS.map((section) => (
          <Box key={section.title}>
            <Text fontSize="md" fontWeight="700" color="fg.default" mb={2}>
              {resolveTemplate(section.title)}
            </Text>
            <VStack gap={2} align="stretch">
              {section.items.map((item) => (
                <AccordionItem
                  key={item.title}
                  icon={item.icon}
                  title={resolveTemplate(item.title)}
                  description={resolveTemplate(item.description)}
                  link={resolveLink(item.link)}
                  done={item.doneWhen?.(setupState) ?? false}
                />
              ))}
            </VStack>
          </Box>
        ))}
      </VStack>
    </VStack>
  );
}
