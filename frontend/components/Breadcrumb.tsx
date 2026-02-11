'use client';

import { Flex, Text, Menu, Icon, Box } from '@chakra-ui/react';
import { Link } from '@/components/ui/Link';
import { LuChevronRight, LuChevronDown } from 'react-icons/lu';
import { BaseFileMetadata } from '@/lib/types';
import { useRouter } from '@/lib/navigation/use-navigation';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import DemoModeBanner from '@/components/DemoModeBanner';
import FileSearchBar from './FileSearchBar';

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
  const router = useRouter();
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const isTutorialMode = effectiveUser?.mode === 'tutorial';
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
                        onClick={() => router.push(`/f/${file.id}`)}
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

  // Use DemoModeBanner wrapper when in tutorial mode
  if (isTutorialMode) {
    return (
      <DemoModeBanner>
        {breadcrumbItems}
      </DemoModeBanner>
    );
  }

  return (
    <Flex align="center" justify="space-between" gap={2} mb={2}>
      {breadcrumbItems}
      <Box flexShrink={0} display={{ base: 'none', md: 'block' }}>
        <FileSearchBar />
      </Box> 
    </Flex>
  );
}
