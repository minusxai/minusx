'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';
import { Box, VStack, HStack, Flex, useBreakpointValue, Button, Icon, Span } from '@chakra-ui/react';
import { LuPlus, LuGraduationCap } from 'react-icons/lu';
import Breadcrumb from '@/components/Breadcrumb';
import FolderView from '@/components/FolderView';
import RightSidebar from '@/components/RightSidebar';
import MobileRightSidebar from '@/components/MobileRightSidebar';
import SearchBar from '@/components/SearchBar';
import ProductTour from '@/components/ProductTour';
import { useAppSelector } from '@/store/hooks';
import { switchMode } from '@/lib/mode/mode-utils';
import { isAdmin } from '@/lib/auth/role-helpers';
import { useFolder } from '@/lib/hooks/file-state-hooks';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { resolvePath, resolveHomeFolderSync, SYSTEM_FOLDERS, isHiddenSystemPath } from '@/lib/mode/path-resolver';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';


interface PathPageProps {
  params: Promise<{ path?: string[] }>;
}

export default function PathPage({ params }: PathPageProps) {
  const router = useRouter();
  const { navigate } = useNavigationGuard();
  const user = useAppSelector(state => state.auth.user);
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(undefined);
  const [selectedContextPath, setSelectedContextPath] = useState<string | null>(null);

  // Get company configs
  const { config } = useConfigs();

  // Determine if we're on mobile or desktop (true = mobile, false = desktop)
  const isMobile = useBreakpointValue({ base: true, md: false }, { ssr: true });

  // Unwrap params Promise (Next.js 16 requirement)
  const { path } = use(params);
  const pathSegments = path || [];

  // Construct full path from segments
  const fullPath = '/' + pathSegments.join('/');

  // Load folder into Redux (populates pathIndex, uses TTL cache)
  const { files: folderFiles, loading: folderLoading } = useFolder(fullPath);

  // Client-side permission check for folder access
  useEffect(() => {
    if (!user) return;

    // CRITICAL: Validate that requested path matches user's current mode
    // This prevents accessing /org files when in tutorial mode and vice versa
    const currentMode = user.mode || DEFAULT_MODE;
    const modePrefix = `/${currentMode}`;
    const isInCorrectMode = fullPath === modePrefix || fullPath.startsWith(modePrefix + '/');

    if (!isInCorrectMode) {
      // Path doesn't match current mode - redirect to mode root
      const modeRoot = resolvePath(currentMode, '');
      router.replace(`/p${modeRoot}`);
      return;
    }

    // Check if non-admin is trying to access path outside their home folder
    if (!isAdmin(user.role)) {
      const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');

      // Extract top-level mode folder (e.g., /org from /org/testing)
      const topLevelMode = '/' + resolvedHomeFolder.split('/').filter(Boolean)[0];

      // Check if requested path is within the top-level mode folder
      const isWithinMode = fullPath === topLevelMode || fullPath.startsWith(topLevelMode + '/');

      if (!isWithinMode) {
        router.replace(`/p${resolvedHomeFolder}`);
        return;
      }

      // Check if requested path is a parent folder (going UP the chain within mode)
      const isParentPath = resolvedHomeFolder.startsWith(fullPath + '/');

      // Check if requested path is home folder or subfolder
      const isHomeOrSubPath = fullPath === resolvedHomeFolder || fullPath.startsWith(resolvedHomeFolder + '/');

      // If not a parent and not in home tree, redirect back to home folder
      if (!isParentPath && !isHomeOrSubPath) {
        router.replace(`/p${resolvedHomeFolder}`);
        return;
      }
    }
  }, [user, fullPath, router]);

  // Determine page title from path
  const pageTitle = useMemo(() => {
    return pathSegments.length > 0
      ? pathSegments[pathSegments.length - 1]
      : 'Files';
  }, [pathSegments]);

  // Build breadcrumb items
  const breadcrumbItems = useMemo(() => {
    const currentMode = user?.mode || DEFAULT_MODE;
    return [
      { label: 'Home', href: '/' },
      ...pathSegments.map((segment, index) => ({
        label: segment === currentMode ? config.branding.displayName : segment,
        href: index === pathSegments.length - 1 ? undefined : `/p/${pathSegments.slice(0, index + 1).join('/')}`
      }))
    ];
  }, [pathSegments, config.branding.displayName, user?.mode]);

  // Right sidebar config - hide for system folders
  const shouldShowSidebar = useMemo(() => {
    const mode = user?.mode || DEFAULT_MODE;
    return !isHiddenSystemPath(fullPath, mode);
  }, [fullPath, user?.mode]);

  // Chat is hidden for system folders (they have special views)
  const showChat = useMemo(() => {
    const mode = user?.mode || DEFAULT_MODE;
    return !isHiddenSystemPath(fullPath, mode);
  }, [fullPath, user?.mode]);

  // Determine header right content based on path
  const headerRightContent = useMemo(() => {
    const mode = user?.mode || DEFAULT_MODE;
    const elements: React.ReactNode[] = [];

    // Add Connection button for /database path
    if (fullPath === resolvePath(mode, SYSTEM_FOLDERS.database)) {
      elements.push(
        <Button
          key="add-connection"
          onClick={() => navigate('/new/connection')}
          bg="accent.teal"
          color="white"
          size="sm"
          _hover={{ transform: 'translateY(-1px)', shadow: 'md' }}
        >
          <LuPlus />
          Add Connection
        </Button>
      );
    }

    // Try Demo Mode button (only in org mode)
    if (mode === 'org') {
      elements.push(
        <Button
          key="try-demo"
          onClick={() => switchMode('tutorial')}
          variant="outline"
          size="sm"
          borderColor="accent.danger"
          color="accent.danger"
          _hover={{ bg: 'accent.danger', color: 'white' }}
          gap={2}
          aria-label='Try Demo Button'
        >
          <Icon as={LuGraduationCap} />
          Try Demo Mode <Span fontSize="2xs">(Sample Data Included)</Span>
        </Button>
      );
    }

    if (elements.length === 0) return undefined;
    if (elements.length === 1) return elements[0];
    return <HStack gap={3}>{elements}</HStack>;
  }, [fullPath, user?.mode, router]);

  // Don't render until user is loaded
  if (!user) {
    return null;
  }

  const shouldShowContextSelector = user?.role === 'admin';

  return (
    <Box minH="90vh" bg="bg.canvas" display="flex">
      {/* Product tour for tutorial mode */}
      <ProductTour />
      <VStack flex="1" minW="0" position="relative" align={"stretch"}>
        <Box w="100%" flex="1" mx="auto" px={{ base: 4, md: 8, lg: 12 }} pt={{ base: 3, md: 4, lg: 5 }} pb={{ base: 6, md: 8, lg: 10 }}>
          <Flex justify="space-between" align="center" mb={4} gap={4}>
            <Box flex="1" minW={0}>
              <Breadcrumb items={breadcrumbItems} />
            </Box>
          </Flex>

          <FolderView
            path={fullPath}
            title={pageTitle === (user?.mode || DEFAULT_MODE) ? config.branding.displayName : pageTitle}
            headerRight={headerRightContent}
          />
        </Box>
        {showChat && <SearchBar />}
      </VStack>

      {shouldShowSidebar && (
        <>
          {/* Conditionally render based on device - not just hide with CSS */}
          {isMobile === false && (
            <RightSidebar
              title="Folder Context"
              filePath={fullPath}
              showChat={showChat}
              contextVersion={selectedVersion}
              selectedContextPath={selectedContextPath}
              onContextChange={shouldShowContextSelector ? (_path: string | null, version?: number) => {
                setSelectedVersion(version)
                setSelectedContextPath(_path)
                } : undefined
              }
            />
          )}
          {isMobile === true && (
            <MobileRightSidebar
              title="Folder Context"
              filePath={fullPath}
              showChat={showChat}
              contextVersion={selectedVersion}
              selectedContextPath={selectedContextPath}
              onContextChange={shouldShowContextSelector ? (_path: string | null, version?: number) => {
                setSelectedVersion(version)
                setSelectedContextPath(_path)
                } : undefined
              }
            />
          )}
        </>
      )}
    </Box>
  );
}
