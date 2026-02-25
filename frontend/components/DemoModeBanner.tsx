'use client';

import { Flex, Text, Icon, Button, Box } from '@chakra-ui/react';
import { LuGraduationCap, LuX } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { switchMode } from '@/lib/mode/mode-utils';
import FileSearchBar from './FileSearchBar';

const shimmerAnimation = `
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
`;

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
      <style>{shimmerAnimation}{containerQueryStyles}</style>
      <Box
        position="relative"
        borderRadius="md"
        role="status"
        aria-label="Demo Mode - You're exploring with sample data"
      >
        {/* Shimmer overlay */}
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          pointerEvents="none"
          zIndex={1}
          overflow="hidden"
          borderRadius="md"
          css={{
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 40%, rgba(255,255,255,0.25) 50%, rgba(255,255,255,0.15) 60%, transparent 100%)',
              animation: 'shimmer 3s ease-in-out infinite',
            }
          }}
        />
        <Flex
          bg="accent.danger/90"
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
              <Icon as={LuGraduationCap} color="white" boxSize={4} aria-hidden="true" />
              <Text fontSize="xs" fontWeight="600" color="white" fontFamily="mono" whiteSpace="nowrap">
                Demo Mode
              </Text>
            </Flex>
            {unsavedChangesButton ? null : (
              <Text fontSize="xs" color="whiteAlpha.800" whiteSpace="nowrap" className="demo-description">
                You're exploring MinusX with Sample Data
              </Text>
            )}
            <Button
                size="2xs"
                variant="solid"
                bg="whiteAlpha.500"
                color="white"
                _hover={{ bg: 'white', color: 'accent.danger' }}
                onClick={() => switchMode('org')}
                aria-label="Exit Demo Mode"
                flexShrink={0}
            >
                Exit Demo Mode
                <Icon as={LuX} boxSize={3} aria-hidden="true" />
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
