'use client';

import { useState } from 'react';
import { Flex, Text, Menu, Icon, Box, Button } from '@chakra-ui/react';
import { Link } from '@/components/ui/Link';
import { LuChevronRight, LuChevronDown, LuTriangleAlert } from 'react-icons/lu';
import { BaseFileMetadata } from '@/lib/types';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import DemoModeBanner from '@/components/DemoModeBanner';
import FileSearchBar from './FileSearchBar';
import { useDirtyFiles } from '@/lib/hooks/file-state-hooks';
import PublishModal from './PublishModal';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  siblingFiles?: BaseFileMetadata[];
  currentFileId?: number;
}

export default function Breadcrumb({ items, siblingFiles, currentFileId }: BreadcrumbProps) {
  const { navigate } = useNavigationGuard();
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const isTutorialMode = effectiveUser?.mode === 'tutorial';
  const dirtyFiles = useDirtyFiles();
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const isLastItem = (index: number) => index === items.length - 1;
  const hasDropdown = siblingFiles && siblingFiles.length > 0;

  // Colors that adapt based on demo mode
  const textColor = isTutorialMode ? 'white' : 'fg.muted';
  const textColorActive = isTutorialMode ? 'white' : 'fg.default';
  const chevronColor = isTutorialMode ? 'rgba(255,255,255,0.6)' : 'var(--chakra-colors-fg-subtle)';

  const breadcrumbItems = (
    <Flex align="center" gap={2}>
      {items.map((item, index) => (
        <Flex key={index} align="center" gap={2}>
          {index > 0 && (
            <LuChevronRight size={14} color={chevronColor} />
          )}
          {/* Last item with dropdown if siblings exist */}
          {isLastItem(index) && hasDropdown ? (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Flex
                  align="center"
                  gap={1}
                  cursor="pointer"
                  bg={isTutorialMode ? 'whiteAlpha.200' : 'bg.surface'}
                  border="1px solid"
                  borderColor={isTutorialMode ? 'whiteAlpha.300' : 'border.default'}
                  _hover={{
                    bg: isTutorialMode ? 'whiteAlpha.300' : 'bg.subtle',
                    borderColor: isTutorialMode ? 'whiteAlpha.400' : 'border.emphasized'
                  }}
                  px={1.5}
                  py={0.5}
                  borderRadius="md"
                  transition="all 0.2s"
                  shadow="xs"
                >
                  <Text
                    fontSize="xs"
                    fontWeight="600"
                    color={textColorActive}
                  >
                    {item.label}
                  </Text>
                  <LuChevronDown size={14} color={isTutorialMode ? 'white' : 'var(--chakra-colors-accent-teal)'} />
                </Flex>
              </Menu.Trigger>
              <Menu.Positioner>
                <Menu.Content
                  minW="220px"
                  p={1}
                  bg="bg.surface"
                  borderColor="border.default"
                  shadow="lg"
                >
                  {siblingFiles.map(file => {
                    const metadata = getFileTypeMetadata(file.type);
                    return (
                      <Menu.Item
                        key={file.id}
                        value={file.id.toString()}
                        onClick={() => navigate(`/f/${file.id}`)}
                        bg={file.id === currentFileId ? 'bg.subtle' : 'transparent'}
                        fontWeight={file.id === currentFileId ? '600' : '400'}
                        borderRadius="sm"
                        px={3}
                        py={2}
                        cursor="pointer"
                        _hover={{ bg: 'bg.muted' }}
                      >
                        <Flex align="center" gap={2}>
                          <Icon
                            as={metadata.icon}
                            boxSize={4}
                            color={metadata.color}
                            flexShrink={0}
                          />
                          <Text fontSize="xs" flex="1" truncate>
                            {file.name}
                          </Text>
                        </Flex>
                      </Menu.Item>
                    );
                  })}
                </Menu.Content>
              </Menu.Positioner>
            </Menu.Root>
          ) : item.href ? (
            <Link href={item.href} prefetch={true} style={{ textDecoration: 'none' }}>
              <Text
                fontSize="xs"
                fontWeight="600"
                color={textColor}
                _hover={{ color: textColorActive }}
                transition="color 0.2s"
                cursor="pointer"
              >
                {item.label}
              </Text>
            </Link>
          ) : (
            <Text
              fontSize="xs"
              fontWeight="600"
              color={textColorActive}
            >
              {item.label}
            </Text>
          )}
        </Flex>
      ))}
    </Flex>
  );

  // Unsaved changes button (styled differently when inside demo banner vs standalone)
  const unsavedChangesButton = dirtyFiles.length > 0 ? (
    <Button
      size="xs"
      variant="solid"
      bg={isTutorialMode ? 'whiteAlpha.500' : 'accent.warning'}
      border="1px solid"
      borderColor={isTutorialMode ? 'whiteAlpha.600' : 'accent.warning'}
      color={isTutorialMode ? 'white' : 'black'}
      _hover={isTutorialMode ? { bg: 'white', color: 'accent.danger' } : undefined}
      fontFamily="mono"
      onClick={() => setIsPublishModalOpen(true)}
    >
      <LuTriangleAlert size={12} />
      {dirtyFiles.length} unsaved {dirtyFiles.length === 1 ? 'change' : 'changes'}
    </Button>
  ) : null;

  // Use DemoModeBanner wrapper when in tutorial mode
  if (isTutorialMode) {
    return (
      <>
        <DemoModeBanner unsavedChangesButton={unsavedChangesButton}>
          {breadcrumbItems}
        </DemoModeBanner>
        <PublishModal isOpen={isPublishModalOpen} onClose={() => setIsPublishModalOpen(false)} />
      </>
    );
  }

  return (
    <Flex align="center" justify="space-between" gap={2} mb={2}>
      {breadcrumbItems}
      <Flex gap={2} align="center" flexShrink={0} display={{ base: 'none', md: 'flex' }}>
        {unsavedChangesButton}
        <FileSearchBar />
      </Flex>
      <PublishModal isOpen={isPublishModalOpen} onClose={() => setIsPublishModalOpen(false)} />
    </Flex>
  );
}
