'use client';

import { ReactElement } from 'react';
import { Box, HStack, Text, IconButton, Portal, MenuRoot, MenuTrigger, MenuPositioner, MenuContent, MenuItem } from '@chakra-ui/react';
import { LuX, LuDownload, LuFileText, LuPresentation, LuCode } from 'react-icons/lu';

export type ExportFormat = 'pdf' | 'slides' | 'html';

interface OverlayControlBarProps {
  currentIndex: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (index: number) => void;
  onClose: () => void;
  onExport?: (format: ExportFormat) => void;
  prevIcon: ReactElement;
  nextIcon: ReactElement;
  prevLabel: string;
  nextLabel: string;
  exitLabel: string;
  accentColor: string;
}

export default function OverlayControlBar({
  currentIndex,
  total,
  onPrev,
  onNext,
  onGoTo,
  onClose,
  onExport,
  prevIcon,
  nextIcon,
  prevLabel,
  nextLabel,
  exitLabel,
  accentColor,
}: OverlayControlBarProps) {
  return (
    <Box
      position="absolute"
      bottom={5}
      left="50%"
      transform="translateX(-50%)"
      zIndex={1}
    >
      <HStack
        bg="bg.surface"
        border="1px solid"
        borderColor="border.default"
        borderRadius="full"
        px={4}
        py={1.5}
        gap={3}
        boxShadow="0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)"
        backdropFilter="blur(8px)"
      >
        {/* Prev */}
        <IconButton
          onClick={onPrev}
          aria-label={prevLabel}
          size="xs"
          variant="ghost"
          borderRadius="full"
          disabled={currentIndex === 0}
          color="fg.muted"
          _hover={{ bg: 'bg.muted', color: 'fg.default' }}
        >
          {prevIcon}
        </IconButton>

        {/* Dots */}
        <HStack gap={1.5}>
          {Array.from({ length: total }, (_, i) => (
            <Box
              key={i}
              w={currentIndex === i ? '18px' : '6px'}
              h="6px"
              borderRadius="full"
              bg={currentIndex === i ? accentColor : 'border.emphasized'}
              cursor="pointer"
              transition="all 0.2s"
              onClick={() => onGoTo(i)}
              _hover={{ bg: currentIndex === i ? accentColor : 'fg.muted' }}
            />
          ))}
        </HStack>

        {/* Next */}
        <IconButton
          onClick={onNext}
          aria-label={nextLabel}
          size="xs"
          variant="ghost"
          borderRadius="full"
          disabled={currentIndex === total - 1}
          color="fg.muted"
          _hover={{ bg: 'bg.muted', color: 'fg.default' }}
        >
          {nextIcon}
        </IconButton>

        {/* Divider */}
        <Box w="1px" h="16px" bg="border.default" />

        {/* Counter */}
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" whiteSpace="nowrap">
          {currentIndex + 1} / {total}
        </Text>

        {/* Divider */}
        <Box w="1px" h="16px" bg="border.default" />

        {/* Export menu */}
        {onExport && (
          <>
            <MenuRoot positioning={{ placement: 'top-start' }}>
              <MenuTrigger asChild>
                <IconButton
                  aria-label="Export"
                  size="xs"
                  variant="ghost"
                  borderRadius="full"
                  color="fg.muted"
                  _hover={{ bg: 'bg.muted', color: 'fg.default' }}
                >
                  <LuDownload size={14} />
                </IconButton>
              </MenuTrigger>
              <Portal>
                <MenuPositioner>
                  <MenuContent minW="160px" bg="bg.surface" borderColor="border.default" shadow="lg" p={1}>
                    <MenuItem
                      value="pdf"
                      onClick={() => onExport('pdf')}
                      px={3}
                      py={1.5}
                      borderRadius="sm"
                      _hover={{ bg: 'bg.muted' }}
                      cursor="pointer"
                    >
                      <HStack gap={2}>
                        <LuFileText size={14} />
                        <Text fontSize="xs" fontWeight="500">PDF</Text>
                      </HStack>
                    </MenuItem>
                    <MenuItem
                      value="slides"
                      onClick={() => onExport('slides')}
                      px={3}
                      py={1.5}
                      borderRadius="sm"
                      _hover={{ bg: 'bg.muted' }}
                      cursor="pointer"
                    >
                      <HStack gap={2}>
                        <LuPresentation size={14} />
                        <Text fontSize="xs" fontWeight="500">Slides</Text>
                      </HStack>
                    </MenuItem>
                    <MenuItem
                      value="html"
                      onClick={() => onExport('html')}
                      px={3}
                      py={1.5}
                      borderRadius="sm"
                      _hover={{ bg: 'bg.muted' }}
                      cursor="pointer"
                    >
                      <HStack gap={2}>
                        <LuCode size={14} />
                        <Text fontSize="xs" fontWeight="500">HTML</Text>
                      </HStack>
                    </MenuItem>
                  </MenuContent>
                </MenuPositioner>
              </Portal>
            </MenuRoot>

            {/* Divider */}
            <Box w="1px" h="16px" bg="border.default" />
          </>
        )}

        {/* Close */}
        <IconButton
          onClick={onClose}
          aria-label={exitLabel}
          size="xs"
          variant="ghost"
          borderRadius="full"
          color="fg.muted"
          _hover={{ bg: 'accent.danger/10', color: 'accent.danger' }}
        >
          <LuX size={14} />
        </IconButton>
      </HStack>
    </Box>
  );
}
