'use client';

import { Box, IconButton, Text, HStack } from '@chakra-ui/react';
import SearchBar from './SearchBar';
import { LuDownload, LuZap } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';

interface BottomBarProps {
  showChat?: boolean;
  filePath?: string;
  databaseName?: string;
}

export default function BottomBar({ showChat, filePath, databaseName }: BottomBarProps) {
  const rightSidebarCollapsed = useAppSelector(state => state.ui.rightSidebarCollapsed);
  return (
    <Box
      flexShrink={0}
      borderTopWidth="1px"
      borderColor="border.muted"
      bg="bg.surface"
      display="flex"
      alignItems="center"
      justifyContent="space-between"
      px={4}
      py={0}
      gap={3}
    >
      {/* Execution time on the left */}
      {/* <HStack gap={1} color="fg.muted">
        <LuZap size={14} />
        <Text fontSize="xs" whiteSpace="nowrap">
          1.2s
        </Text>
      </HStack> */}

      {/* Search bar in the middle — hidden when right sidebar is open (chat visible there) */}
      {showChat && rightSidebarCollapsed && (
        <Box flex="1" width="100%">
          <SearchBar inBottomBar={true} filePath={filePath} databaseName={databaseName} />
        </Box>
      )}

      {/* Download button on the right side */}
      {/* <IconButton
        aria-label="Download data"
        variant="ghost"
        size="sm"
        disabled
        colorPalette="gray"
      >
        CSV<LuDownload />
      </IconButton> */}
    </Box>
  );
}
