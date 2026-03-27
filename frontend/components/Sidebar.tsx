'use client';

import { LuChevronLeft, LuChevronRight, LuHouse, LuLogOut, LuX, LuSettings, LuFileText, LuHeadset, LuGithub, LuEllipsisVertical, LuSun, LuMoon } from 'react-icons/lu';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { Box, Flex, VStack, HStack, Text, IconButton, Icon, Menu } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import { Link } from '@/components/ui/Link';
import { ReactNode, useMemo, useState, useEffect } from 'react';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';
import { usePathname, useSearchParams } from 'next/navigation';
import { signOut } from 'next-auth/react';
import ImpersonationSelector from './ImpersonationSelector';
import CreateMenu from './CreateMenu';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { selectFile } from '@/store/filesSlice';
import { toggleLeftSidebar, selectShowDebug, selectShowAdvanced, toggleColorMode } from '@/store/uiSlice';
import { APP_VERSION } from '@/lib/constants';
import { exitImpersonation } from '@/lib/navigation/url-utils';
import { isAdmin } from '@/lib/auth/role-helpers';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { analytics, AnalyticsEvents } from '@/lib/analytics';

interface NavItemProps {
  href: string;
  icon: ReactNode;
  label: string;
  isCollapsed: boolean;
  isActive: boolean;
}

function NavItem({ href, icon, label, isCollapsed, isActive }: NavItemProps) {
  return (
    <Tooltip content={label} disabled={!isCollapsed} positioning={{ placement: 'right' }}>
      <Link href={href} prefetch={true} style={{ textDecoration: 'none' }}>
        <Box
          aria-label={label}
          px={isCollapsed ? 0 : 3}
          py={2}
          borderRadius="md"
          cursor="pointer"
          bg={isActive ? 'bg.transparent' : 'transparent'}
          borderWidth="2px"
          borderColor={isActive ? 'accent.teal' : 'transparent'}
          _hover={{ bg: 'bg.muted' }}
          transition="all 0.2s"
          display="flex"
          alignItems="center"
          justifyContent={isCollapsed ? 'center' : 'flex-start'}
          gap={3}
        >
          <Box color="accent.teal" display="flex" alignItems="center" fontSize="lg">
            {icon}
          </Box>
          {!isCollapsed && (
            <Text
              fontSize="sm"
              color="fg.default"
              fontFamily="mono"
              fontWeight={isActive ? '600' : '400'}
              opacity={isCollapsed ? 0 : 1}
              transition="opacity 0.2s"
            >
              {label}
            </Text>
          )}
        </Box>
      </Link>
    </Tooltip>
  );
}

export default function Sidebar() {
  const dispatch = useAppDispatch();
  const isCollapsed = useAppSelector((state) => state.ui.leftSidebarCollapsed);
  const showDebug = useAppSelector(selectShowDebug);
  const showAdvanced = useAppSelector(selectShowAdvanced);
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const pathname = usePathname();
  const { navigate } = useNavigationGuard();
  const searchParams = useSearchParams();
  const effectiveUser = useAppSelector(selectEffectiveUser);

  // Avoid hydration mismatch: showAdvanced is false on server, may be true on client after localStorage restore
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  // Check for impersonation - safe for SSR
  const isImpersonating = searchParams?.has('as_user') ?? false;

  // Get company-specific config from Redux
  const { config } = useConfigs();

  const displayName = config.branding.agentName;

  // Extract file ID from pathname if on file page
  const fileIdMatch = pathname.match(/^\/f\/(\d+)/);
  const currentFileId = fileIdMatch ? parseInt(fileIdMatch[1], 10) : null;

  // Get current file using selector (only if on file page)
  const currentFile = useAppSelector(state =>
    currentFileId ? selectFile(state, currentFileId) : undefined
  );

  // Extract current path for folder modal and new files
  // Supports both /p/... (folder) and /f/[id] (file) routes
  const currentPath = useMemo(() => {
    if (pathname.startsWith('/p/')) {
      return pathname.replace('/p', '');
    }
    if (currentFile?.path) {
      // Extract parent path from file's path
      const pathParts = currentFile.path.split('/');
      pathParts.pop(); // Remove filename
      return pathParts.join('/') || '/';
    }
    return '/';
  }, [pathname, currentFile]);

  const handleToggleSidebar = () => {
    dispatch(toggleLeftSidebar());
  };

  const homeItem = { href: '/', icon: <LuHouse />, label: 'Home' };

  type NavItem = { href: string; icon: React.ReactElement; label: string; adminOnly?: boolean };
  type NavAction = { label: string; fileType: string; icon: React.ReactElement; adminOnly?: boolean };
  type NavSection = { category: string; items: NavItem[]; actions?: NavAction[] };

  // Get user mode for mode-aware navigation
  const mode = effectiveUser?.mode || 'org';

  const rawNavSections: NavSection[] = [
    {
      category: 'Analytics',
      items: [
        { href: '/explore', icon: <FILE_TYPE_METADATA.explore.icon />, label: FILE_TYPE_METADATA.explore.label },
      ],
      actions: [
        { label: 'Add New Question', fileType: 'question', icon: <FILE_TYPE_METADATA.question.icon size={12} /> },
        { label: 'Add New Dashboard', fileType: 'dashboard', icon: <FILE_TYPE_METADATA.dashboard.icon size={12} /> },
      ]
    },
    {
      category: 'Engineering',
      items: [
        { href: `/p/${mode}/database`, icon: <FILE_TYPE_METADATA.connection.icon />, label: FILE_TYPE_METADATA.connection.label, adminOnly: true },
      ],
      actions: [
        { label: 'Add New DB Connection', fileType: 'connection', icon: <FILE_TYPE_METADATA.connection.icon size={12} />, adminOnly: true },
      ]
    },
    {
      category: 'Debug',
      items: [
        { href: '/recordings', icon: <FILE_TYPE_METADATA.session.icon />, label: FILE_TYPE_METADATA.session.label, adminOnly: true },
        { href: `/p/${mode}/logs`, icon: <FILE_TYPE_METADATA.conversation.icon />, label: FILE_TYPE_METADATA.conversation.label, adminOnly: true },
      ]
    }
  ];

  const userIsAdmin = effectiveUser?.role && isAdmin(effectiveUser.role);
  const navSections = rawNavSections
    .filter(section => {
      // Hide Debug category if showDebug is false
      if (section.category === 'Debug' && !showDebug) {
        return false;
      }
      return true;
    })
    .map(section => ({
      ...section,
      items: section.items.filter((item: NavItem) => !item.adminOnly || userIsAdmin),
      actions: section.actions?.filter((action: NavAction) => !action.adminOnly || userIsAdmin),
    }))
    .filter(section => section.items.length > 0);

  return (
    <Box
      aria-label="left-sidebar"
      position="fixed"
      left={0}
      top={0}
      h="100vh"
      w={isCollapsed ? '72px' : '260px'}
      bg="bg.surface"
      borderRight="1px solid"
      borderColor="border.default"
      transition="width 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
      overflow="hidden"
      zIndex={100}
      display={{ base: 'none', md: 'flex' }} // Hide on mobile, show on desktop
      flexDirection="column"
    >
      {/* Header */}
      <Flex
        h="72px"
        align="center"
        justify={isCollapsed ? 'center' : 'space-between'}
        px={isCollapsed ? 0 : 6}
        borderBottom="1px solid"
        borderColor="border.default"
      >
        <Link href="/" prefetch={true} style={{ textDecoration: 'none' }}>
          {isCollapsed ? (
            <Box
              cursor="pointer"
              _hover={{ opacity: 0.8 }}
              transition="opacity 0.2s"
            >
              <Box
                aria-label="Company logo"
                role="img"
                width={8}
                height={8}
                flexShrink={0}
              />
            </Box>
          ) : (
            <HStack gap={3} cursor="pointer" _hover={{ opacity: 0.8 }} transition="opacity 0.2s">
              <Box
                aria-label="Company logo"
                role="img"
                width={8}
                height={8}
                flexShrink={0}
              />
              <Text
                fontSize="lg"
                fontWeight="900"
                letterSpacing="-0.02em"
                color="fg.default"
                fontFamily="body"
                opacity={isCollapsed ? 0 : 1}
                transition="opacity 0.2s"
              >
                {displayName}
              </Text>
            </HStack>
          )}
        </Link>
        {!isCollapsed && (
          <IconButton
            onClick={handleToggleSidebar}
            variant="ghost"
            aria-label="Collapse sidebar"
            size="sm"
            opacity={isCollapsed ? 0 : 1}
            transition="opacity 0.2s"
          >
            <LuChevronLeft />
          </IconButton>
        )}
      </Flex>

      {/* Navigation */}
      <VStack
        flex={1}
        align="stretch"
        gap={2}
        p={isCollapsed ? 3 : 4}
        overflowY="auto"
        css={{ scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}
      >
        {/* New Button */}
        <CreateMenu variant="sidebar" currentPath={currentPath} isCollapsed={isCollapsed} />

        {/* Navigation Links */}
        <VStack align="stretch" gap={1}>
          {/* Home Item (outside of sections) */}
          <NavItem
            href={homeItem.href}
            icon={homeItem.icon}
            label={homeItem.label}
            isCollapsed={isCollapsed}
            isActive={pathname === homeItem.href}
          />

          {navSections.map((section) => (
            <Box key={section.category}>
              {/* Section Header (only when expanded) */}
              {!isCollapsed && (
                <Box px={3} py={2} mt={4} opacity={isCollapsed ? 0 : 1} transition="opacity 0.2s">
                  <Text fontSize="2xs" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="0.1em" fontFamily="mono">
                    {section.category}
                  </Text>
                </Box>
              )}
              {/* Section Divider (when collapsed) */}
              {isCollapsed && (
                <Box h="1px" bg="border.muted" my={3} />
              )}
              {/* Section Items */}
              {section.items.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  isCollapsed={isCollapsed}
                  isActive={pathname === item.href}
                />
              ))}
              {/* Section Action Buttons (expanded only) */}
              {!isCollapsed && section.actions && section.actions.length > 0 && (
                <Flex gap={2} px={3} py={1} flexWrap="wrap" alignItems="center">
                  {section.actions.map((action) => (
                    <Box
                      key={action.fileType}
                      as="button"
                      fontSize="xs"
                      color="accent.teal"
                      fontFamily="mono"
                      fontWeight="500"
                      cursor="pointer"
                      bg="bg.subtle"
                      borderRadius="full"
                      px={2.5}
                      py={1}
                      _hover={{ bg: 'bg.muted' }}
                      transition="all 0.2s"
                      onClick={() => navigate(`/new/${action.fileType}?folder=${encodeURIComponent(currentPath)}`)}
                      display="flex"
                      alignItems="center"
                      gap={1}
                    >
                      {action.icon}
                      {action.label}
                    </Box>
                  ))}
                </Flex>
              )}
            </Box>
          ))}
        </VStack>
      </VStack>

      {/* Footer with Theme Toggle */}
      <Box
        // borderTop="1px solid"
        // borderColor="border.default"
      >
        {/* Collapse button when collapsed */}
        {isCollapsed && (
          <Flex justify="center" py={3} borderY="1px solid" borderColor="border.default">
            <IconButton
              onClick={handleToggleSidebar}
              variant="ghost"
              aria-label="Expand sidebar"
              size="sm"
            >
              <LuChevronRight />
            </IconButton>
          </Flex>
        )}

        {/* Impersonation Selector (Admin + Advanced only, when expanded, after mount to avoid hydration mismatch) */}
        {mounted && !isCollapsed && showAdvanced && effectiveUser?.role && isAdmin(effectiveUser.role) && (
          <Box
            px={4}
            py={3}
            borderBottom="1px solid"
            borderColor="border.default"
            opacity={isCollapsed ? 0 : 1}
            transition="opacity 0.2s"
          >
            <ImpersonationSelector />
          </Box>
        )}

        {/* User Menu */}
        <Box borderTop="1px solid" borderColor="border.default">
          <Menu.Root positioning={{ placement: isCollapsed ? 'right-end' : 'top-start' }}>
            <Menu.Trigger asChild>
              <Flex
                align="center"
                gap={3}
                px={isCollapsed ? 0 : 4}
                py={3}
                justify={isCollapsed ? 'center' : 'flex-start'}
                cursor="pointer"
                _hover={{ bg: 'bg.muted' }}
                transition="background 0.2s"
              >
                <Flex
                  align="center"
                  justify="center"
                  w={8}
                  h={8}
                  borderRadius="full"
                  bg="accent.teal"
                  color="white"
                  flexShrink={0}
                  fontSize="sm"
                  fontWeight="700"
                >
                  {(effectiveUser?.name || effectiveUser?.email || '?').charAt(0).toUpperCase()}
                </Flex>
                {!isCollapsed && (
                  <Box flex={1} minW={0}>
                    <Text fontSize="sm" color="fg.default" fontFamily="mono" fontWeight="600" truncate>
                      {effectiveUser?.name || effectiveUser?.email}
                    </Text>
                    <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" truncate>
                      {effectiveUser?.email}
                    </Text>
                  </Box>
                )}
                {!isCollapsed && (
                  <Icon as={LuEllipsisVertical} boxSize={4} color="fg.muted" flexShrink={0} />
                )}
                {isImpersonating && !isCollapsed && (
                  <Tooltip content="Exit impersonation">
                    <IconButton
                      onClick={(e) => { e.stopPropagation(); exitImpersonation(); }}
                      size="xs"
                      variant="ghost"
                      colorPalette="orange"
                      aria-label="Exit impersonation"
                    >
                      <LuX />
                    </IconButton>
                  </Tooltip>
                )}
              </Flex>
            </Menu.Trigger>
            <Menu.Positioner zIndex={200}>
              <Menu.Content minW="220px" p={2} bg="bg.surface" shadow="lg" borderRadius="lg" fontFamily="mono">
                {/* User info header */}
                <Box px={3} py={2} mb={1}>
                  <Text fontSize="xs" color="fg.subtle" fontFamily="mono">Signed in as</Text>
                  <Text fontSize="sm" fontWeight="600" fontFamily="mono" truncate>
                    {effectiveUser?.email || effectiveUser?.name}
                  </Text>
                </Box>
                <Box h="1px" bg="border.muted" my={1} />

                {/* Settings */}
                <Menu.Item
                  value="settings"
                  cursor="pointer"
                  borderRadius="md"
                  px={3}
                  py={2}
                  _hover={{ bg: 'bg.muted' }}
                  onClick={() => navigate('/settings')}
                >
                  <HStack gap={3}>
                    <Icon as={LuSettings} boxSize={4} color="accent.teal" />
                    <Text fontWeight="500" fontSize="sm">Settings</Text>
                  </HStack>
                </Menu.Item>

                {/* Dark/Light Mode Toggle */}
                <Menu.Item
                  value="theme"
                  cursor="pointer"
                  borderRadius="md"
                  px={3}
                  py={2}
                  _hover={{ bg: 'bg.muted' }}
                  onClick={() => dispatch(toggleColorMode())}
                  closeOnSelect={false}
                >
                  <HStack gap={3}>
                    <Icon as={colorMode === 'dark' ? LuSun : LuMoon} boxSize={4} color="accent.teal" />
                    <Text fontWeight="500" fontSize="sm">{colorMode === 'dark' ? 'Light Mode' : 'Dark Mode'}</Text>
                  </HStack>
                </Menu.Item>

                <Box h="1px" bg="border.muted" my={1} />

                {/* External links */}
                <Menu.Item
                  value="docs"
                  cursor="pointer"
                  borderRadius="md"
                  px={3}
                  py={2}
                  _hover={{ bg: 'bg.muted' }}
                  onClick={() => window.open(config.links.docsUrl, '_blank')}
                >
                  <HStack gap={3}>
                    <Icon as={LuFileText} boxSize={4} color="accent.teal" />
                    <Text fontWeight="500" fontSize="sm">Docs</Text>
                  </HStack>
                </Menu.Item>
                <Menu.Item
                  value="support"
                  cursor="pointer"
                  borderRadius="md"
                  px={3}
                  py={2}
                  _hover={{ bg: 'bg.muted' }}
                  onClick={() => window.open(config.links.supportUrl, '_blank')}
                >
                  <HStack gap={3}>
                    <Icon as={LuHeadset} boxSize={4} color="accent.teal" />
                    <Text fontWeight="500" fontSize="sm">Support</Text>
                  </HStack>
                </Menu.Item>
                <Menu.Item
                  value="github"
                  cursor="pointer"
                  borderRadius="md"
                  px={3}
                  py={2}
                  _hover={{ bg: 'bg.muted' }}
                  onClick={() => window.open(config.links.githubIssuesUrl, '_blank')}
                >
                  <HStack gap={3}>
                    <Icon as={LuGithub} boxSize={4} color="accent.teal" />
                    <Text fontWeight="500" fontSize="sm">GitHub Issues</Text>
                  </HStack>
                </Menu.Item>

                <Box h="1px" bg="border.muted" my={1} />

                {/* Logout */}
                <Menu.Item
                  value="logout"
                  cursor="pointer"
                  borderRadius="md"
                  px={3}
                  py={2}
                  _hover={{ bg: 'bg.muted' }}
                  onClick={() => {
                    const redirectUrl = `${window.location.origin}/login`;
                    analytics.captureEvent(AnalyticsEvents.USER_SIGNED_OUT);
                    analytics.reset();
                    signOut({ callbackUrl: redirectUrl, redirect: false, redirectTo: redirectUrl }).then(() => {
                      window.location.href = redirectUrl;
                    });
                  }}
                >
                  <HStack gap={3}>
                    <Icon as={LuLogOut} boxSize={4} color="accent.danger" />
                    <Text fontWeight="500" fontSize="sm" color="accent.danger">Logout</Text>
                  </HStack>
                </Menu.Item>

                {/* Version */}
                <Box px={3} py={2} mt={1}>
                  <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">
                    {displayName} v{APP_VERSION}
                  </Text>
                </Box>
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </Box>
      </Box>

    </Box>
  );
}
