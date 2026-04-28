'use client';

import { Flex, Text, Icon, Button, Box } from '@chakra-ui/react';
import { LuGraduationCap, LuArrowLeft } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { switchMode } from '@/lib/mode/mode-utils';
import FileSearchBar from './FileSearchBar';

const containerQueryStyles = `
  .demo-description {
    display: none;
  }
  .demo-label {
    display: none;
 }
  @container demo-banner (min-width: 1200px) {
    .demo-description {
      display: block;
    }
  }
  @container demo-banner (min-width: 800px) {
    .demo-label {
      display: flex;
    }
  }
`;

interface DemoModeBannerProps {
  children?: React.ReactNode;
  unsavedChangesButton?: React.ReactNode;
}

export default function DemoModeBanner({ children, unsavedChangesButton }: DemoModeBannerProps) {
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const isTutorialMode = effectiveUser?.mode === 'tutorial';

  if (!isTutorialMode) {
    return children ? <>{children}</> : null;
  }

  return (
    <Box mb={2} css={{ containerType: 'inline-size', containerName: 'demo-banner' }}>
      <style>{containerQueryStyles}</style>
      <Box
        position="relative"
        borderRadius="md"
        role="status"
        aria-label="Demo Mode - You're exploring with sample data"
      >
        <Flex
          bg="bg.subtle"
          border="1px solid"
          borderColor="border.default"
          px={3}
          py={1.5}
          borderRadius="md"
          align="center"
          justify="space-between"
          gap={2}
        >
          {/* Left side: children (breadcrumb items, etc.) */}
          {children && (
            <Box flex="0 0 auto">
              {children}
            </Box>
          )}

          {/* Center: Demo mode label + description + exit button */}
          <Flex align="center" gap={2} flex={1} justify="center">
            <Flex align="center" gap={2} flexShrink={0} className="demo-label">
              <Icon as={LuGraduationCap} color="fg.muted" boxSize={4} aria-hidden="true" />
              <Text fontSize="xs" fontWeight="600" color="fg.muted" fontFamily="mono" whiteSpace="nowrap">
                Demo Mode
              </Text>
            </Flex>
            {unsavedChangesButton ? null : (
              <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap" className="demo-description">
                You're exploring MinusX with Sample Data
              </Text>
            )}
            <Button
                size="2xs"
                variant="outline"
                borderColor="border.default"
                color="fg.muted"
                _hover={{ bg: 'bg.subtle' }}
                onClick={() => switchMode('org')}
                aria-label="Exit Demo Mode"
                flexShrink={0}
            >
                <Icon as={LuArrowLeft} boxSize={3} aria-hidden="true" />
                Exit Demo
            </Button>
          </Flex>

          <Flex gap={2} align="center" flexShrink={0} display={{ base: 'none', md: 'flex' }}>
            {unsavedChangesButton}
            <FileSearchBar />
          </Flex>
        </Flex>
      </Box>
    </Box>
  );
}
