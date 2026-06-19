'use client';

/**
 * Single-row toolbar chrome shared by notebook cells: a collapse toggle, a
 * cell-type indicator (SQL/Text), a compact name field, optional cell-specific
 * controls in two slots (middle / trailing — e.g. the SQL/GUI/Viz tabs or the
 * Lexical toolbar, and the DB selector), and delete. Everything lives on ONE
 * level so cells stay dense.
 *
 * When COLLAPSED the controls (middle/trailing) are hidden — just the type
 * indicator + name show, so a folded cell reads as a quiet labelled strip.
 * Inserting new cells is handled by hover zones around the cell (CellInsertZone),
 * Jupyter/Colab style — not from this toolbar.
 */
import type { ReactNode } from 'react';
import { HStack, IconButton, Input, Box, Icon } from '@chakra-ui/react';
import { LuChevronDown, LuChevronRight, LuTrash2, LuDatabase, LuFileText } from 'react-icons/lu';

interface NotebookCellHeaderProps {
  cellType: 'sql' | 'text';
  collapsed: boolean;
  onToggleCollapse: () => void;
  name: string;
  onNameChange: (name: string) => void;
  onRemove: () => void;
  readOnly?: boolean;
  middle?: ReactNode;
  trailing?: ReactNode;
}

function Divider() {
  return <Box w="1px" alignSelf="stretch" my={1.5} bg="border.muted" opacity={0.6} flexShrink={0} />;
}

export default function NotebookCellHeader({
  cellType, collapsed, onToggleCollapse, name, onNameChange, onRemove, readOnly = false, middle, trailing,
}: NotebookCellHeaderProps) {
  const TypeIcon = cellType === 'sql' ? LuDatabase : LuFileText;
  const typeColor = cellType === 'sql' ? 'accent.teal' : 'accent.secondary';

  const nameInput = (
    <Input
      aria-label="Cell name"
      size="xs"
      variant="flushed"
      placeholder="Untitled"
      value={name}
      onChange={(e) => onNameChange(e.target.value)}
      disabled={readOnly}
      width="130px"
      px={1}
      fontFamily="mono"
      fontSize="xs"
      fontWeight="500"
      color={collapsed ? 'fg.default' : 'fg.muted'}
      letterSpacing="-0.01em"
      borderColor="transparent"
      textAlign={collapsed ? 'left' : 'right'}
      _placeholder={{ color: 'fg.subtle' }}
      _focus={{ color: 'fg.default', borderColor: 'border.default' }}
      flexShrink={0}
    />
  );

  return (
    <HStack
      px={2}
      py={1}
      gap={2}
      minH="36px"
      bg="bg.subtle"
      borderBottomWidth={collapsed ? '0' : '1px'}
      borderColor="border.muted"
    >
      {/* Left: collapse + type indicator */}
      <HStack gap={1.5} flexShrink={0}>
        <IconButton
          aria-label={collapsed ? 'Expand cell' : 'Collapse cell'}
          size="2xs"
          variant="ghost"
          color="fg.subtle"
          _hover={{ color: 'fg.default', bg: 'bg.muted' }}
          onClick={onToggleCollapse}
        >
          {collapsed ? <LuChevronRight /> : <LuChevronDown />}
        </IconButton>
        <Icon as={TypeIcon} boxSize="14px" color={typeColor} aria-label={cellType === 'sql' ? 'SQL cell' : 'Text cell'} />
      </HStack>

      {collapsed ? (
        // Collapsed: just the name, then push delete to the right.
        <>
          {nameInput}
          <Box flex={1} />
        </>
      ) : (
        // Expanded: toolbar leads on the LEFT; name sits on the right.
        <>
          <Box minW={0} overflowX="auto" display="flex" alignItems="center" flexShrink={0}>
            {middle}
          </Box>
          <Box flex={1} minW={2} />
          {nameInput}
          {trailing && (
            <>
              <Divider />
              <Box flexShrink={0}>{trailing}</Box>
            </>
          )}
        </>
      )}

      <Divider />

      <IconButton
        aria-label="Delete cell"
        size="2xs"
        variant="ghost"
        color="fg.subtle"
        _hover={{ color: 'accent.danger', bg: 'bg.muted' }}
        disabled={readOnly}
        onClick={onRemove}
        flexShrink={0}
      >
        <LuTrash2 />
      </IconButton>
    </HStack>
  );
}
