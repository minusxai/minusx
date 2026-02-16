'use client';

/**
 * CreateMenu Component - Reusable create file menu
 *
 * Used in:
 * - Sidebar (main navigation)
 * - FolderView (empty folder state)
 * - MobileNewFileSheet (mobile bottom sheet)
 */
import { Box, HStack, VStack, Text, Icon, Menu, Portal, Button } from '@chakra-ui/react';
import { LuPlus, LuRocket } from 'react-icons/lu';
import { useState } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { useAccessRules } from '@/lib/auth/access-rules.client';
import { isViewer } from '@/lib/auth/role-helpers';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import NewFolderModal from './NewFolderModal';

interface CreateMenuProps {
  /** Current folder path for creating files */
  currentPath?: string;
  /** Visual variant: sidebar (box trigger), button (button trigger), sheet (full list for mobile) */
  variant?: 'sidebar' | 'button' | 'sheet';
  /** Whether sidebar is collapsed (only for sidebar variant) */
  isCollapsed?: boolean;
  /** Menu placement */
  placement?: 'bottom-start' | 'right-start' | 'top-start';
  /** Callback when an item is selected (for sheet variant to close parent dialog) */
  onClose?: () => void;
}

export default function CreateMenu({
  currentPath = '/',
  variant = 'button',
  isCollapsed = false,
  placement = 'bottom-start',
  onClose
}: CreateMenuProps) {
  const router = useRouter();
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const { canShowInCreateMenu } = useAccessRules();

  // Don't render if user is a viewer
  if (!effectiveUser?.role || isViewer(effectiveUser.role)) {
    return null;
  }

  const handleNewFile = (fileType: string) => {
    // Determine the folder to create the file in
    let targetFolder = currentPath === '/'
      ? (effectiveUser ? resolveHomeFolderSync(effectiveUser.mode, effectiveUser.home_folder || '') : '/org')
      : currentPath;

    // Apply minimum path constraints based on file type
    if ((fileType === 'question' || fileType === 'dashboard') && targetFolder === '/') {
      targetFolder = '/org';
    }

    const folderParam = `?folder=${encodeURIComponent(targetFolder)}`;
    router.push(`/new/${fileType}${folderParam}`);
    onClose?.();
  };

  const handleExplore = () => {
    router.push('/explore');
    onClose?.();
  };

  // Derive file types from FILE_TYPE_METADATA keys
  const allFileTypes = Object.keys(FILE_TYPE_METADATA) as Array<keyof typeof FILE_TYPE_METADATA>;

  // Split by category and support status, filtered by createTypes in rules.json
  const supportedAnalyticsTypes = allFileTypes.filter(type =>
    FILE_TYPE_METADATA[type].category === 'analytics' &&
    FILE_TYPE_METADATA[type].supported &&
    canShowInCreateMenu(effectiveUser?.role || 'viewer', type)
  );
  const supportedEngineeringTypes = allFileTypes.filter(type =>
    FILE_TYPE_METADATA[type].category === 'engineering' &&
    FILE_TYPE_METADATA[type].supported &&
    canShowInCreateMenu(effectiveUser?.role || 'viewer', type)
  );
  const comingSoonTypes = allFileTypes.filter(type =>
    !FILE_TYPE_METADATA[type].supported &&
    canShowInCreateMenu(effectiveUser?.role || 'viewer', type)
  );

  const canCreateFolder = canShowInCreateMenu(effectiveUser?.role || 'viewer', 'folder');

  // Determine menu placement based on variant and collapsed state
  const menuPlacement = variant === 'sidebar'
    ? (isCollapsed ? 'right-start' : 'bottom-start')
    : placement;

  // Sheet variant - renders as a list (for mobile bottom sheets)
  if (variant === 'sheet') {
    return (
      <>
        <Box p={4} pb={8} maxH="70vh" overflowY="auto">
          <Text fontSize="xl" fontWeight="700" mb={4} color="fg.default" fontFamily="body">
            Create New
          </Text>

          <VStack gap={0} align="stretch">
            {/* Analytics section */}
            <Box px={4} py={3}>
              <Text fontSize="xs" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="0.1em" fontFamily="mono">
                Analytics
              </Text>
            </Box>
            <Box
              px={4}
              py={3}
              cursor="pointer"
              borderRadius="md"
              _hover={{ bg: 'bg.muted' }}
              onClick={handleExplore}
            >
              <HStack gap={3}>
                <Icon as={LuRocket} boxSize={6} color="accent.teal" />
                <Text fontWeight="500" fontSize="md">Exploration</Text>
              </HStack>
            </Box>
            {supportedAnalyticsTypes.map((type) => (
              <Box
                key={type}
                px={4}
                py={3}
                cursor="pointer"
                borderRadius="md"
                _hover={{ bg: 'bg.muted' }}
                onClick={() => handleNewFile(type)}
              >
                <HStack gap={3}>
                  <Icon as={FILE_TYPE_METADATA[type].icon} boxSize={6} color={FILE_TYPE_METADATA[type].color} />
                  <Text fontWeight="500" fontSize="md">{FILE_TYPE_METADATA[type].label}</Text>
                </HStack>
              </Box>
            ))}

            {canCreateFolder && (
              <>
                <Box h="1px" bg="border.muted" my={3} />
                <Box
                  px={4}
                  py={3}
                  cursor="pointer"
                  borderRadius="md"
                  _hover={{ bg: 'bg.muted' }}
                  onClick={() => setIsFolderModalOpen(true)}
                >
                  <HStack gap={3}>
                    <Icon as={FILE_TYPE_METADATA['folder'].icon} boxSize={6} color={FILE_TYPE_METADATA['folder'].color} />
                    <Text fontWeight="500" fontSize="md">{FILE_TYPE_METADATA['folder'].label}</Text>
                  </HStack>
                </Box>
              </>
            )}

            {supportedEngineeringTypes.length > 0 && (
              <>
                <Box h="1px" bg="border.muted" my={3} />
                <Box px={4} py={3}>
                  <Text fontSize="xs" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="0.1em" fontFamily="mono">
                    Engineering
                  </Text>
                </Box>
                {supportedEngineeringTypes.map((type) => (
                  <Box
                    key={type}
                    px={4}
                    py={3}
                    cursor="pointer"
                    borderRadius="md"
                    _hover={{ bg: 'bg.muted' }}
                    onClick={() => handleNewFile(type)}
                  >
                    <HStack gap={3}>
                      <Icon as={FILE_TYPE_METADATA[type].icon} boxSize={6} color={FILE_TYPE_METADATA[type].color} />
                      <Text fontWeight="500" fontSize="md">{FILE_TYPE_METADATA[type].label}</Text>
                    </HStack>
                  </Box>
                ))}
              </>
            )}

            {comingSoonTypes.length > 0 && (
              <>
                <Box h="1px" bg="border.muted" my={3} />
                <Box px={4} py={3}>
                  <Text fontSize="xs" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="0.1em" fontFamily="mono">
                    Coming Soon
                  </Text>
                </Box>
                {comingSoonTypes.map((type) => (
                  <Box
                    key={type}
                    px={4}
                    py={3}
                    cursor="not-allowed"
                    borderRadius="md"
                    opacity={0.5}
                  >
                    <HStack gap={3}>
                      <Icon as={FILE_TYPE_METADATA[type].icon} boxSize={6} color={FILE_TYPE_METADATA[type].color} />
                      <Text fontWeight="500" fontSize="md">{FILE_TYPE_METADATA[type].label}</Text>
                    </HStack>
                  </Box>
                ))}
              </>
            )}
          </VStack>
        </Box>

        <NewFolderModal
          isOpen={isFolderModalOpen}
          onClose={() => setIsFolderModalOpen(false)}
          defaultParentPath={currentPath}
        />
      </>
    );
  }

  // Menu variants (sidebar, button) - renders as dropdown menu
  return (
    <>
      <Menu.Root positioning={{ placement: menuPlacement }}>
        <Menu.Trigger asChild>
          {variant === 'sidebar' ? (
            <Box
              px={isCollapsed ? 0 : 3}
              py={2}
              borderRadius="md"
              cursor="pointer"
              _hover={{ transform: 'translateY(-1px)', shadow: 'md' }}
              transition="all 0.2s"
              display="flex"
              alignItems="center"
              justifyContent={isCollapsed ? 'center' : 'flex-start'}
              gap={3}
              bg="accent.teal"
              shadow="sm"
              transform="translateY(0)"
            >
              <Box color="white" display="flex" alignItems="center" fontSize="lg">
                <LuPlus />
              </Box>
              {!isCollapsed && (
                <Text
                  fontSize="sm"
                  color="white"
                  fontFamily="mono"
                  fontWeight="600"
                  opacity={isCollapsed ? 0 : 1}
                  transition="opacity 0.2s"
                >
                  Create
                </Text>
              )}
            </Box>
          ) : (
            <Button
              bg="accent.teal"
              color="white"
              size="md"
              fontWeight="600"
              _hover={{ opacity: 0.9 }}
              gap={2}
            >
              <Icon as={LuPlus} />
              Create
            </Button>
          )}
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content
              minW="220px"
              p={2}
              bg="bg.surface"
              shadow="lg"
              borderRadius="lg"
            >
              {/* Analytics section */}
              <Box px={3} py={2}>
                <Text fontSize="2xs" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="0.1em" fontFamily="mono">
                  Analytics
                </Text>
              </Box>
              <Menu.Item
                key="exploration"
                value="exploration"
                cursor="pointer"
                borderRadius="md"
                px={3}
                py={2}
                _hover={{ bg: 'bg.muted' }}
                onClick={handleExplore}
              >
                <HStack gap={3}>
                  <Icon as={LuRocket} boxSize={5} color="accent.teal" />
                  <Text fontWeight="500">Exploration</Text>
                </HStack>
              </Menu.Item>
              {supportedAnalyticsTypes.map((type) => (
                <Menu.Item
                  key={type}
                  value={type}
                  cursor="pointer"
                  borderRadius="md"
                  px={3}
                  py={2}
                  _hover={{ bg: 'bg.muted' }}
                  onClick={() => handleNewFile(type)}
                >
                  <HStack gap={3}>
                    <Icon as={FILE_TYPE_METADATA[type].icon} boxSize={5} color={FILE_TYPE_METADATA[type].color} />
                    <Text fontWeight="500">{FILE_TYPE_METADATA[type].label}</Text>
                  </HStack>
                </Menu.Item>
              ))}

              {/* Folder */}
              {canCreateFolder && (
                <>
                  <Box h="1px" bg="border.muted" my={2} />
                  <Menu.Item
                    key="folder"
                    value="folder"
                    cursor="pointer"
                    borderRadius="md"
                    px={3}
                    py={2}
                    _hover={{ bg: 'bg.muted' }}
                    onClick={() => setIsFolderModalOpen(true)}
                  >
                    <HStack gap={3}>
                      <Icon as={FILE_TYPE_METADATA['folder'].icon} boxSize={5} color={FILE_TYPE_METADATA['folder'].color} />
                      <Text fontWeight="500">{FILE_TYPE_METADATA['folder'].label}</Text>
                    </HStack>
                  </Menu.Item>
                </>
              )}

              {/* Engineering section */}
              {supportedEngineeringTypes.length > 0 && (
                <>
                  <Box h="1px" bg="border.muted" my={2} />
                  <Box px={3} py={2}>
                    <Text fontSize="2xs" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="0.1em" fontFamily="mono">
                      Engineering
                    </Text>
                  </Box>
                  {supportedEngineeringTypes.map((type) => (
                    <Menu.Item
                      key={type}
                      value={type}
                      cursor="pointer"
                      borderRadius="md"
                      px={3}
                      py={2}
                      _hover={{ bg: 'bg.muted' }}
                      onClick={() => handleNewFile(type)}
                    >
                      <HStack gap={3}>
                        <Icon as={FILE_TYPE_METADATA[type].icon} boxSize={5} color={FILE_TYPE_METADATA[type].color} />
                        <Text fontWeight="500">{FILE_TYPE_METADATA[type].label}</Text>
                      </HStack>
                    </Menu.Item>
                  ))}
                </>
              )}

              {/* Coming Soon section */}
              {comingSoonTypes.length > 0 && (
                <>
                  <Box h="1px" bg="border.muted" my={2} />
                  <Box px={3} py={2}>
                    <Text fontSize="2xs" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="0.1em" fontFamily="mono">
                      Coming Soon
                    </Text>
                  </Box>
                  {comingSoonTypes.map((type) => (
                    <Menu.Item
                      key={type}
                      value={type}
                      disabled
                      cursor="not-allowed"
                      borderRadius="md"
                      px={3}
                      py={2}
                      opacity={0.5}
                    >
                      <HStack gap={3}>
                        <Icon as={FILE_TYPE_METADATA[type].icon} boxSize={5} color={FILE_TYPE_METADATA[type].color} />
                        <Text fontWeight="500">{FILE_TYPE_METADATA[type].label}</Text>
                      </HStack>
                    </Menu.Item>
                  ))}
                </>
              )}
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      {/* New Folder Modal */}
      <NewFolderModal
        isOpen={isFolderModalOpen}
        onClose={() => setIsFolderModalOpen(false)}
        defaultParentPath={currentPath}
      />
    </>
  );
}
