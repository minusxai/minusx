'use client';

import { useState } from 'react';
import { Flex, Text, Menu, Icon, Box, Button, Input } from '@chakra-ui/react';
import { Link } from '@/components/ui/Link';
import { LuChevronRight, LuChevronDown, LuTriangleAlert, LuPencil, LuSearch } from 'react-icons/lu';
import { BaseFileMetadata } from '@/lib/types';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import DemoModeBanner from '@/components/DemoModeBanner';
import FileSearchBar from './FileSearchBar';
import { useSaveDecision } from '@/lib/hooks/file-state-hooks';
import PublishModal from './PublishModal';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  siblingFiles?: BaseFileMetadata[];
  currentFileId?: number;
  bannerColor?: string;  // Optional accent color for banner mode (e.g. dashboard edit mode)
  bannerLabel?: string;  // Optional label shown in the banner
}

// Sort order matching FilesList sections: knowledge base → dashboards → folders → questions → other
const TYPE_ORDER: Record<string, number> = { context: 0, dashboard: 1, folder: 2, question: 3 };
const TYPE_LABELS: Record<string, string> = { context: 'Knowledge Base', dashboard: 'Dashboards', folder: 'Folders', question: 'Questions' };

function sortByTypeHierarchy(files: BaseFileMetadata[]): BaseFileMetadata[] {
  return [...files].sort((a, b) => {
    const orderA = TYPE_ORDER[a.type] ?? 4;
    const orderB = TYPE_ORDER[b.type] ?? 4;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });
}

export default function Breadcrumb({ items, siblingFiles, currentFileId, bannerColor, bannerLabel }: BreadcrumbProps) {
  const { navigate } = useNavigationGuard();
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const isTutorialMode = effectiveUser?.mode === 'tutorial';
  const hasDarkBanner = !!bannerColor; // only custom bannerColor is dark; demo banner is light
  const hasBanner = isTutorialMode || !!bannerColor;
  const { unrelatedDirtyCount, isPublishModalOpen, openPublishModal, closePublishModal } = useSaveDecision(currentFileId);
  const isLastItem = (index: number) => index === items.length - 1;
  const [searchQuery, setSearchQuery] = useState('');
  const sortedSiblingFiles = siblingFiles ? sortByTypeHierarchy(siblingFiles) : undefined;
  const filteredSiblingFiles = sortedSiblingFiles
    ? sortedSiblingFiles.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : undefined;
  const hasDropdown = sortedSiblingFiles && sortedSiblingFiles.length > 0;

  // Colors that adapt based on banner mode (only dark banners get white text)
  const textColor = hasDarkBanner ? 'white' : 'fg.muted';
  const textColorActive = hasDarkBanner ? 'white' : 'fg.default';
  const chevronColor = hasDarkBanner ? 'rgba(255,255,255,0.6)' : 'var(--chakra-colors-fg-subtle)';

  const breadcrumbItems = (
    <Flex align="center" gap={2}>
      {items.map((item, index) => (
        <Flex key={index} align="center" gap={2}>
          {index > 0 && (
            <LuChevronRight size={14} color={chevronColor} />
          )}
          {/* Last item with dropdown if siblings exist */}
          {isLastItem(index) && hasDropdown ? (
            <Menu.Root onOpenChange={(details) => { if (!details.open) setSearchQuery(''); }}>
              <Menu.Trigger asChild>
                <Flex
                  align="center"
                  gap={1}
                  cursor="pointer"
                  bg={hasDarkBanner ? 'whiteAlpha.200' : 'bg.surface'}
                  border="1px solid"
                  borderColor={hasDarkBanner ? 'whiteAlpha.300' : 'border.default'}
                  _hover={{
                    bg: hasDarkBanner ? 'whiteAlpha.300' : 'bg.subtle',
                    borderColor: hasDarkBanner ? 'whiteAlpha.400' : 'border.emphasized'
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
                  <LuChevronDown size={14} color={hasDarkBanner ? 'white' : 'var(--chakra-colors-accent-teal)'} />
                </Flex>
              </Menu.Trigger>
              <Menu.Positioner>
                <Menu.Content
                  minW="250px"
                  maxH="400px"
                  p={1}
                  bg="bg.surface"
                  borderColor="border.default"
                  shadow="lg"
                  overflow="hidden"
                >
                  <Box px={1.5} pt={1} pb={1}>
                    <Flex
                      align="center"
                      gap={2}
                      px={2.5}
                      h="32px"
                      bg="bg.subtle"
                      borderRadius="md"
                      border="1px solid"
                      borderColor="border.default"
                      _focusWithin={{
                        borderColor: 'accent.teal',
                        boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)'
                      }}
                      transition="all 0.2s"
                    >
                      <Icon as={LuSearch} color="fg.muted" boxSize={3.5} flexShrink={0} />
                      <Input
                        size="xs"
                        variant="outline"
                        placeholder={`Search in ${items[index - 1]?.label ?? item.label}`}
                        fontSize="sm"
                        fontFamily="mono"
                        px={0}
                        h="auto"
                        border="none"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        _focus={{ outline: 'none', boxShadow: 'none', border: 'none' }}
                        _placeholder={{ color: 'fg.muted', fontFamily: 'mono' }}
                      />
                    </Flex>
                  </Box>
                  <Box overflowY="auto" maxH="340px">
                  {filteredSiblingFiles!.map((file, i) => {
                    const metadata = getFileTypeMetadata(file.type);
                    const prevType = i > 0 ? filteredSiblingFiles![i - 1].type : null;
                    const isNewGroup = prevType === null || prevType !== file.type;
                    const groupLabel = TYPE_LABELS[file.type] || 'Other';
                    return (
                      <Box key={file.id}>
                        {isNewGroup && file.type !== 'context' && (
                          <>
                            {prevType !== null && <Menu.Separator />}
                            <Text fontSize="2xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" px={3} pt={prevType !== null ? 1 : 0.5} pb={0.5}>
                              {groupLabel}
                            </Text>
                          </>
                        )}
                        <Menu.Item
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
                      </Box>
                    );
                  })}
                  </Box>
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

  // Unsaved changes button — only shows for unrelated dirty files (not current file's children)
  const unsavedChangesButton = unrelatedDirtyCount > 0 ? (
    <Button
      size="xs"
      variant="solid"
      bg="accent.danger/15"
      border="1px solid"
      borderColor="accent.danger/30"
      color="accent.danger"
      fontFamily="mono"
      onClick={openPublishModal}
    >
      <LuTriangleAlert size={12} />
      {unrelatedDirtyCount} unsaved {unrelatedDirtyCount === 1 ? 'change' : 'changes'}
    </Button>
  ) : null;

  // Use DemoModeBanner wrapper when in tutorial mode
  if (isTutorialMode) {
    return (
      <>
        <DemoModeBanner unsavedChangesButton={unsavedChangesButton}>
          {breadcrumbItems}
        </DemoModeBanner>
        <PublishModal isOpen={isPublishModalOpen} onClose={closePublishModal} />
      </>
    );
  }

  return (
    <Flex
      align="center"
      justify="space-between"
      gap={2}
      mb={2}
      px={3}
      py={1}
      mx={-3}
      bg={bannerColor ?? 'transparent'}
      borderRadius="md"
    >
      <Box flex="0 0 auto">
        {breadcrumbItems}
      </Box>
      {bannerLabel && (
        <>
          <style>{`@keyframes bannerIconBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
          <Flex align="center" gap={1.5} flex={1} justify="center">
            <Box display="inline-flex" style={{ animation: 'bannerIconBlink 2s ease-in-out infinite' }}>
              <Icon as={LuPencil} boxSize={3} color="white" />
            </Box>
            <Text fontSize="xs" fontWeight="600" color="white" fontFamily="mono" whiteSpace="nowrap">
              {bannerLabel}
            </Text>
          </Flex>
        </>
      )}
      <Flex gap={2} align="center" flexShrink={0} display={{ base: 'none', md: 'flex' }}>
        {unsavedChangesButton}
        <FileSearchBar />
      </Flex>
      <PublishModal isOpen={isPublishModalOpen} onClose={closePublishModal} />
    </Flex>
  );
}
