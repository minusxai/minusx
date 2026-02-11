'use client';

import { LuChevronLeft, LuChevronRight, LuHouse, LuLogOut, LuX, LuSettings, LuFileText, LuLifeBuoy, LuGithub } from 'react-icons/lu';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { Box, Flex, VStack, HStack, Text, IconButton, Icon } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import { Link } from '@/components/ui/Link';
import { ReactNode, useMemo } from 'react';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';
import { usePathname, useSearchParams } from 'next/navigation';
import { signOut } from 'next-auth/react';
import ImpersonationSelector from './ImpersonationSelector';
import CreateMenu from './CreateMenu';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { selectFile } from '@/store/filesSlice';
import { toggleLeftSidebar, selectShowDebug } from '@/store/uiSlice';
import { APP_VERSION } from '@/lib/constants';
import { exitImpersonation } from '@/lib/navigation/url-utils';
import { isAdmin } from '@/lib/auth/role-helpers';
import { useConfigs } from '@/lib/hooks/useConfigs';

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
          bg={isActive ? 'bg.muted' : 'transparent'}
          borderWidth="1px"
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
  const pathname = usePathname();
  const { navigate } = useNavigationGuard();
  const searchParams = useSearchParams();
  const effectiveUser = useAppSelector(selectEffectiveUser);

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
  type NavSection = { category: string; items: NavItem[] };

  // Get user mode for mode-aware navigation
  const mode = effectiveUser?.mode || 'org';

  const rawNavSections: NavSection[] = [
    {
      category: 'Analytics',
      items: [
        { href: '/explore', icon: <FILE_TYPE_METADATA.explore.icon />, label: FILE_TYPE_METADATA.explore.label },
      ]
    },
    {
      category: 'Engineering',
      items: [
        { href: `/p/${mode}/database`, icon: <FILE_TYPE_METADATA.connection.icon />, label: FILE_TYPE_METADATA.connection.label, adminOnly: true },
      ]
    },
    {
      category: 'Management',
      items: [
        { href: '/users', icon: <FILE_TYPE_METADATA.users.icon />, label: FILE_TYPE_METADATA.users.label, adminOnly: true },
        { href: `/p/${mode}/configs`, icon: <FILE_TYPE_METADATA.config.icon />, label: FILE_TYPE_METADATA.config.label, adminOnly: true },
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
      items: section.items.filter((item: NavItem) => !item.adminOnly || (effectiveUser?.role && isAdmin(effectiveUser.role)))
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
        overflow="hidden"
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

        {/* Impersonation Selector (Admin only, when expanded) */}
        {!isCollapsed && effectiveUser?.role && isAdmin(effectiveUser.role) && (
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

        {/* User Info & Logout Box */}
        <Box
          borderBottom="1px solid"
          borderColor="border.default"
        >
          {/* User Info (when expanded) */}
          {!isCollapsed && (
            <Box
              px={4}
              pt={3}
              pb={2}
              opacity={isCollapsed ? 0 : 1}
              transition="opacity 0.2s"
            >
              <HStack justify="space-between" align="start">
                <Box flex={1}>
                  <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" mb={0.5}>
                    Signed in as
                  </Text>
                  <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="600" truncate>
                    {effectiveUser?.email || effectiveUser?.name}
                  </Text>
                </Box>
                {isImpersonating && (
                  <Tooltip content="Exit impersonation">
                    <IconButton
                      onClick={exitImpersonation}
                      size="xs"
                      variant="ghost"
                      colorPalette="orange"
                      aria-label="Exit impersonation"
                    >
                      <LuX />
                    </IconButton>
                  </Tooltip>
                )}
              </HStack>
            </Box>
          )}

          {/* Settings Button */}
          <Flex
            align="center"
            gap={3}
            px={isCollapsed ? 0 : 4}
            py={4}
            justify={isCollapsed ? 'center' : 'space-between'}
            _hover={{ bg: 'bg.muted' }}
            transition="background 0.2s"
            cursor="pointer"
            onClick={() => navigate('/settings')}
            >
            {!isCollapsed && (
                <Text
                  fontSize="sm"
                  color="fg.default"
                  fontFamily="mono"
                  opacity={isCollapsed ? 0 : 1}
                  transition="opacity 0.2s"
                >
                Settings
                </Text>
            )}
            <Icon as={LuSettings} boxSize={4} color={"accent.teal"} />
          </Flex>

          {/* Logout Button */}
          <Flex
            align="center"
            gap={3}
            px={isCollapsed ? 0 : 4}
            py={3}
            justify={isCollapsed ? 'center' : 'space-between'}
            cursor="pointer"
            _hover={{ bg: 'bg.muted' }}
            transition="background 0.2s"
            onClick={() => {
              const redirectUrl = `${window.location.origin}/login`;
              console.log('[Sidebar] Signing out, redirectTo:', redirectUrl);
              signOut({ callbackUrl: redirectUrl, redirect:false, redirectTo: redirectUrl }).then(() => {
                window.location.href = redirectUrl; // Ensure redirect after sign out
              });
            }}
          >
            {!isCollapsed && (
              <Text
                fontSize="sm"
                color="fg.default"
                fontFamily="mono"
                opacity={isCollapsed ? 0 : 1}
                transition="opacity 0.2s"
              >
                Logout
              </Text>
            )}
            <Icon as={LuLogOut} boxSize={4} color="accent.danger" />
          </Flex>
        </Box>


        {/* External Links */}
        <HStack
          justify={isCollapsed ? 'center' : 'space-around'}
          py={3}
          borderTop="1px solid"
          borderColor="border.muted"
        >
          <Tooltip content="Docs" positioning={{ placement: 'top' }}>
            <a href={config.links.docsUrl} target="_blank" rel="noopener noreferrer">
              <IconButton
                variant="ghost"
                size="sm"
                color="fg.muted"
                _hover={{ color: 'accent.teal' }}
                aria-label="Docs"
              >
                <LuFileText />
              </IconButton>
            </a>
          </Tooltip>
          <Tooltip content="Support" positioning={{ placement: 'top' }}>
            <a href={config.links.supportUrl} target="_blank" rel="noopener noreferrer">
              <IconButton
                variant="ghost"
                size="sm"
                color="fg.muted"
                _hover={{ color: 'accent.teal' }}
                aria-label="Support"
              >
                <LuLifeBuoy />
              </IconButton>
            </a>
          </Tooltip>
          <Tooltip content="GitHub Issues" positioning={{ placement: 'top' }}>
            <a href={config.links.githubIssuesUrl} target="_blank" rel="noopener noreferrer">
              <IconButton
                variant="ghost"
                size="sm"
                color="fg.muted"
                _hover={{ color: 'accent.teal' }}
                aria-label="GitHub Issues"
              >
                <LuGithub />
              </IconButton>
            </a>
          </Tooltip>
        </HStack>

        {/* Version */}
        {!isCollapsed && (
          <Box
            px={4}
            py={3}
            borderTop="1px solid"
            borderColor="border.muted"
            opacity={isCollapsed ? 0 : 1}
            transition="opacity 0.2s"
          >
            <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
              {displayName} v{APP_VERSION}
            </Text>
          </Box>
        )}
        {isCollapsed && (
          <Box
            px={4}
            py={3}
            borderTop="1px solid"
            borderColor="border.muted"
            opacity={isCollapsed ? 0 : 1}
            transition="opacity 0.2s"
          >
            <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">
              v{APP_VERSION}
            </Text>
          </Box>
        )}
      </Box>

    </Box>
  );
}
