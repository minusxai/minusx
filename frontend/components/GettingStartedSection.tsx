'use client';

/**
 * GettingStartedSection Component
 * Dismissable section showing incomplete getting started items above folder files
 * Works in both org mode and tutorial mode with different items
 */

import { useState, useEffect } from 'react';
import { Box, HStack, Text, Icon, IconButton, SimpleGrid, Button } from '@chakra-ui/react';
import NextLink from 'next/link';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';
import {
  LuX,
  LuCheck,
  LuTable,
  LuLayoutDashboard,
  LuRocket,
  LuBookOpen,
  LuArrowRight,
  LuSparkles,
  LuChevronDown,
  LuChevronRight,
  LuGraduationCap,
  LuDatabase,
  LuUsers
} from 'react-icons/lu';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { useConnections } from '@/lib/hooks/useConnections';
import {
  setSidebarPendingMessage,
  setActiveSidebarSection,
  setRightSidebarCollapsed
} from '@/store/uiSlice';
import { isAdmin } from '@/lib/auth/role-helpers';
import { switchMode } from '@/lib/mode/mode-utils';

const SAMPLE_DATABASE_ID = 9;
const SAMPLE_DASHBOARD_ID = 11;
const KNOWLEDGE_BASE_ID = 10;
const CLICKED_ITEMS_STORAGE_KEY = 'minusx-getting-started-clicked';

interface GettingStartedItem {
  id: string;
  label: string;
  description: string;
  icon: typeof LuTable;
  href?: string;
  onClick?: () => void;
  isCompleted?: boolean;
  isButton?: boolean;
}

// Helper to get clicked items from localStorage
function getClickedItems(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = localStorage.getItem(CLICKED_ITEMS_STORAGE_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

// Helper to save clicked items to localStorage
function saveClickedItems(items: Set<string>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CLICKED_ITEMS_STORAGE_KEY, JSON.stringify([...items]));
}

// Tutorial mode items
const TUTORIAL_ITEMS: Omit<GettingStartedItem, 'isCompleted'>[] = [
  {
    id: 'tables',
    label: 'Browse Tables',
    description: 'Preview database tables',
    icon: LuTable,
    href: `/f/${SAMPLE_DATABASE_ID}?mode=tutorial`,
  },
  {
    id: 'dashboard',
    label: 'View Dashboard',
    description: 'Example dashboard with questions',
    icon: LuLayoutDashboard,
    href: `/f/${SAMPLE_DASHBOARD_ID}?mode=tutorial`,
  },
  {
    id: 'explore',
    label: 'Dive into Data',         
    description: 'MinusX exploration mode',
    icon: LuRocket,
    href: '/explore?mode=tutorial',
  },
  {
    id: 'knowledge',
    label: 'Refer Knowledge Base',
    description: 'View context and documentation',
    icon: LuBookOpen,
    href: `/f/${KNOWLEDGE_BASE_ID}?mode=tutorial`,
  },
];

export default function GettingStartedSection() {
  const dispatch = useAppDispatch();
  const user = useAppSelector(state => state.auth.user);
  const { connections: connectionsMap } = useConnections({ skip: true });
  const [clickedItems, setClickedItems] = useState<Set<string>>(() => getClickedItems());
  const [userCount, setUserCount] = useState<number>(1);
  const [isLoaded, setIsLoaded] = useState(false);

  const isTutorialMode = user?.mode === 'tutorial';
  const userIsAdmin = user?.role && isAdmin(user.role);

  // Local state only - resets on refresh
  const [isDismissed, setIsDismissed] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Fetch user count for admins
  useEffect(() => {
    if (userIsAdmin) {
      fetchWithCache('/api/users', {
        method: 'GET',
        cacheStrategy: API.users.list.cache,
      })
        .then(data => {
          if (data.data?.users) {
            setUserCount(data.data.users.length);
          }
        })
        .catch(() => {})
        .finally(() => setIsLoaded(true));
    } else {
      setIsLoaded(true);
    }
  }, [userIsAdmin]);

  // Handle item click - mark as completed
  const handleItemClick = (itemId: string) => {
    const newClicked = new Set(clickedItems);
    newClicked.add(itemId);
    setClickedItems(newClicked);
    saveClickedItems(newClicked);
  };

  // Handle dismiss - local state only, resets on refresh
  const handleDismiss = () => {
    setIsDismissed(true);
  };

  // Build items based on mode
  const hasAddedConnection = Object.keys(connectionsMap).length > 0;
  const hasInvitedUsers = userCount > 1;

  // Ask AI action
  const handleAskAI = () => {
    dispatch(setSidebarPendingMessage('What can MinusX do?'));
    dispatch(setActiveSidebarSection('chat'));
    dispatch(setRightSidebarCollapsed(false));
  };

  const allItems: GettingStartedItem[] = isTutorialMode
    ? TUTORIAL_ITEMS.map(item => ({
        ...item,
        isCompleted: clickedItems.has(item.id),
      }))
    : [
        {
          id: 'tutorial',
          label: 'Try Demo Mode',
          description: 'Explore all features (Sample Data included)',
          icon: LuGraduationCap,
          onClick: () => switchMode('tutorial'),
          isCompleted: clickedItems.has('tutorial'),
        },
        {
          id: 'askAI',
          label: 'Talk to MinusX',
          description: '"What all can MinusX do?"',
          icon: LuSparkles,
          onClick: handleAskAI,
          isCompleted: clickedItems.has('askAI'),
          isButton: true,
        },
        ...(userIsAdmin ? [
          {
            id: 'connection',
            label: 'Connect Data',
            description: 'Add your database',
            icon: LuDatabase,
            href: '/new/connection',
            isCompleted: hasAddedConnection,
          },
          {
            id: 'users',
            label: 'Invite Team',
            description: 'Add team members',
            icon: LuUsers,
            href: '/users',
            isCompleted: hasInvitedUsers,
          },
        ] : []),
      ];

  const totalItems = allItems.length;
  const completedCount = allItems.filter(item => item.isCompleted).length;

  // Don't show if dismissed or all items completed
  if (isDismissed || completedCount === totalItems) {
    return null;
  }

  const accentColor = isTutorialMode ? 'accent.danger' : 'accent.teal';

  return (
    <Box
      bg={isTutorialMode ? 'accent.danger/5' : 'accent.teal/5'}
      border="1px solid"
      borderColor={isTutorialMode ? 'accent.danger/20' : 'accent.teal/20'}
      borderRadius="xl"
      mb={6}
      overflow="hidden"
      aria-label='Getting Started Section'
    >
      {/* Header */}
      <HStack
        px={5}
        py={3}
        justify="space-between"
        cursor="pointer"
        onClick={() => setIsCollapsed(!isCollapsed)}
        _hover={{ bg: isTutorialMode ? 'accent.danger/10' : 'accent.teal/10' }}
        transition="background 0.2s"
      >
        <HStack gap={3}>
          <Icon
            as={isCollapsed ? LuChevronRight : LuChevronDown}
            color={accentColor}
            boxSize={4}
          />
          <Text fontWeight="600" color={accentColor} fontSize="sm">
            {isTutorialMode ? 'Demo Mode' : 'Getting Started'}
          </Text>
          <Text fontSize="sm" color="fg.muted" fontFamily="mono">
            ({completedCount}/{totalItems})
          </Text>
        </HStack>
        <HStack gap={2}>
          {isTutorialMode && (
            <Button
              size="xs"
              variant="ghost"
              color="fg.muted"
              onClick={(e) => {
                e.stopPropagation();
                switchMode('org');
              }}
              gap={1}
            >
              Exit Demo
            </Button>
          )}
          <IconButton
            aria-label="Dismiss getting started"
            size="xs"
            variant="ghost"
            color="fg.muted"
            onClick={(e) => {
              e.stopPropagation();
              handleDismiss();
            }}
            _hover={{ color: 'fg.default' }}
          >
            <LuX />
          </IconButton>
        </HStack>
      </HStack>

      {/* Content - Collapsible */}
      {!isCollapsed && (
        <Box px={5} pb={4}>
          <SimpleGrid columns={{ base: 1, sm: 2, md: allItems.length }} gap={3}>
            {allItems.map((item) => {
              const isCompleted = item.isCompleted;

              const content = (
                <Box
                  p={4}
                  bg={isCompleted ? 'bg.muted' : 'bg.surface'}
                  borderRadius="lg"
                  border="1px solid"
                  borderColor={isCompleted ? 'border.muted' : 'border.muted'}
                  _hover={isCompleted ? {} : { borderColor: accentColor, bg: 'bg.muted' }}
                  transition="all 0.2s"
                  h="100%"
                >
                  <HStack justify="space-between" mb={2}>
                    <Icon as={item.icon} boxSize={5} color={isCompleted ? 'fg.muted' : accentColor} />
                    {isCompleted ? (
                      <Icon as={LuCheck} boxSize={4} color="accent.teal" />
                    ) : (
                      <Icon as={LuArrowRight} boxSize={4} color={accentColor} />
                    )}
                  </HStack>
                  <Text
                    fontWeight="600"
                    fontSize="sm"
                    color={isCompleted ? 'fg.muted' : 'fg.default'}
                    mb={1}
                    textDecoration={isCompleted ? 'line-through' : 'none'}
                  >
                    {item.label}
                  </Text>
                  {item.isButton ? (
                    <Box
                      display="inline-block"
                      px={2}
                      py={0.5}
                      bg={isCompleted ? 'gray.200/30' : `${accentColor}/90`}
                      borderRadius="md"
                      fontSize="xs"
                      fontWeight="500"
                      color={isCompleted ? 'fg.muted' : 'white'}
                    >
                      {item.description}
                    </Box>
                  ) : (
                    <Text fontSize="xs" color="fg.muted">
                      {item.description}
                    </Text>
                  )}
                </Box>
              );

              // Completed items are not clickable
            //   if (isCompleted) {
            //     return <Box key={item.id}>{content}</Box>;
            //   }

              if (item.href) {
                return (
                  <NextLink key={item.id} href={item.href} onClick={() => handleItemClick(item.id)}>
                    {content}
                  </NextLink>
                );
              }

              return (
                <Box
                  key={item.id}
                  onClick={() => {
                    handleItemClick(item.id);
                    item.onClick?.();
                  }}
                >
                  {content}
                </Box>
              );
            })}
          </SimpleGrid>
        </Box>
      )}
    </Box>
  );
}
