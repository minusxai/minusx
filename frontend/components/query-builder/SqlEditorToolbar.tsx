'use client';

import { IconButton, VStack } from '@chakra-ui/react';
import { LuAlignLeft, LuPlay } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';

interface SqlEditorToolbarProps {
  readOnly: boolean;
  showFormatButton: boolean;
  showRunButton: boolean;
  onFormat: () => void;
  onRun?: () => void;
  isRunning: boolean;
}

/**
 * Vertical column of Format / Run action buttons alongside the SQL editor.
 */
export default function SqlEditorToolbar({
  readOnly,
  showFormatButton,
  showRunButton,
  onFormat,
  onRun,
  isRunning,
}: SqlEditorToolbarProps) {
  if (readOnly || !(showFormatButton || showRunButton)) {
    return null;
  }

  return (
    <VStack gap={2} justify="flex-start" py={2}>
      {showFormatButton && (
        <Tooltip content="Format SQL" positioning={{ placement: 'left' }}>
          <IconButton
            onClick={onFormat}
            aria-label="Format SQL"
            size="sm"
            variant="ghost"
            color="accent.teal"
            _hover={{ bg: 'accent.teal', color: 'white' }}
          >
            <LuAlignLeft />
          </IconButton>
        </Tooltip>
      )}
      {showRunButton && onRun && (
        <Tooltip content="Run Query (Cmd+Enter)" positioning={{ placement: 'left' }}>
          <IconButton
            onClick={onRun}
            aria-label="Run query"
            size="sm"
            colorPalette="teal"
            loading={isRunning}
          >
            <LuPlay fill="white" />
          </IconButton>
        </Tooltip>
      )}
    </VStack>
  );
}
