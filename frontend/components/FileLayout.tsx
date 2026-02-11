'use client';

/**
 * FileLayout Component - Phase 1: Simplified Pure Layout
 *
 * This component is now a pure layout container:
 * - Handles breadcrumb rendering
 * - Manages right sidebar
 * - Sets page type in Redux
 * - Delegates all file-type-specific rendering to children
 *
 * The 70-line if-else chain has been removed and replaced with
 * the fileComponents mapping system used by FileView.
 */
import { Box, VStack, Flex, useBreakpointValue } from '@chakra-ui/react';
import Breadcrumb from './Breadcrumb';
import RightSidebar, { RightSidebarProps } from './RightSidebar';
import MobileRightSidebar from './MobileRightSidebar';
import BottomBar from './BottomBar';
import SearchBar from './SearchBar';
import { ReactNode } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { DbFile } from '@/lib/types';
import { useFolder } from '@/lib/hooks/useFolder';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { setLeftSidebarCollapsed } from '@/store/uiSlice';
import { useEffect } from 'react';
import { useConfigs } from '@/lib/hooks/useConfigs';

/**
 * FileLayout Props - Phase 1: Simplified to use children only
 */
interface FileLayoutProps {
  filePath: string;
  fileName: string;
  fileType: DbFile['type'];
  fileId?: number;
  children: ReactNode;
  rightSidebar: RightSidebarProps
}

export default function FileLayout(props: FileLayoutProps) {
  const { filePath, fileName, fileType, fileId, rightSidebar } = props;
  const user = useAppSelector(state => state.auth.user);

  // Determine if we're on mobile or desktop (true = mobile, false = desktop)
  const isMobile = useBreakpointValue({ base: true, md: false }, { ssr: false });

  // Fetch sibling files from parent folder
  const { files: siblingFiles } = useFolder(filePath);

  // Get company-specific config from Redux
  const { config } = useConfigs();

  // Build breadcrumb from file path
  // Example: /org/team/Sales => Home > org > team > Sales (filename)
  const pathParts = filePath.split('/').filter(Boolean);

  const breadcrumbItems: Array<{ label: string; href?: string }> = [
    { label: 'Home', href: '/' }
  ];

  // Build intermediate path segments
  const currentMode = user?.mode || 'org';
  let accumulatedPath = '';
  for (let i = 0; i < pathParts.length; i++) {
    accumulatedPath += '/' + pathParts[i];
    breadcrumbItems.push({
      label: pathParts[i] === currentMode ? config.branding.displayName : pathParts[i],
      href: `/p${accumulatedPath}`
    });
  }

  // Add filename as final item (no href)
  breadcrumbItems.push({ label: fileName });

  // Phase 1: Always use children prop
  // Type-based rendering is now handled by FileView component via fileComponents mapping
  const content = props.children;
  const shouldShowRightSidebar = fileType === 'question' || fileType === 'dashboard' || fileType === 'report'
  const shouldShowBottomBar = fileType === 'question' && !isMobile
  const metadata = getFileTypeMetadata(fileType);
  const dispatch = useAppDispatch();

  // Extract database name from appState (for question pages)
  const appStateDatabaseName = rightSidebar?.appState?.pageType === 'question'
    ? (rightSidebar.appState as any).database_name
    : undefined;
  
//   useEffect(() => {
//       dispatch(setLeftSidebarCollapsed(fileType !== 'folder')); // Ensure left sidebar is closed for file pages
//   }, [dispatch]);

  return (
    <Box display="flex" h={metadata.h} bg="bg.canvas"
    overflow={metadata.h === '100vh' ? 'hidden' : 'visible'}
    >
      <VStack flex="1" minW="0" position="relative" align="stretch" overflow={metadata.h === '100vh' ? 'hidden' : 'visible'} minHeight="0">
        <VStack maxW="100%" flex="1" mx="0"
            px={{ base: 4, md: 8, lg: 12 }}
            pt={{ base: 3, md: 4, lg: 5 }}
            pb={shouldShowBottomBar ? 0 : { base: 4, md: 6, lg: 8 }}
            align="stretch" overflow="hidden" minHeight="0">
          <Flex justify="space-between" align="center" mb={4} gap={4}>
            <Box flex="1" minW={0}>
              <Breadcrumb
                items={breadcrumbItems}
                siblingFiles={fileId ? siblingFiles : undefined}
                currentFileId={fileId}
              />
            </Box>
          </Flex>
          {content}
        </VStack>
        {/* Sticky search bar container - only when bottom bar is not shown */}
        {!shouldShowBottomBar && shouldShowRightSidebar && rightSidebar && rightSidebar.showChat && (
          <SearchBar filePath={rightSidebar.filePath} databaseName={appStateDatabaseName} />
        )}

        {/* Bottom bar for question page - includes search bar */}
        {shouldShowBottomBar && (
          <BottomBar showChat={rightSidebar?.showChat} filePath={rightSidebar?.filePath} databaseName={appStateDatabaseName} />
        )}
      </VStack>
      {shouldShowRightSidebar && rightSidebar && (
        <>
          {/* Conditionally render based on device - not just hide with CSS */}
          {isMobile === false && (
            <RightSidebar
              {...rightSidebar}
            />
          )}
          {isMobile === true && (
            <MobileRightSidebar
              {...rightSidebar}
            />
          )}
        </>
      )}
    </Box>
  );
}
