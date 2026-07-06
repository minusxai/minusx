'use client';

import { useRef } from 'react';
import {
  Box,
  Text,
  HStack,
  Input,
  IconButton,
} from '@chakra-ui/react';
import {
  LuX,
  LuCheck,
  LuPencil,
  LuCircleAlert,
  LuTrash2,
} from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';

// ─── Inline rename row ────────────────────────────────────────────────────────

export interface FileRowProps {
  f: CsvFileInfo;
  isCollision: boolean;
  editingKey: string | null;
  editSchema: string;
  editTable: string;
  editError: string;
  onStartEdit: (f: CsvFileInfo) => void;
  onEditSchema: (v: string) => void;
  onEditTable: (v: string) => void;
  onConfirmRename: (s3Key: string) => void;
  onCancelEdit: () => void;
  onDelete: (s3Key: string) => void;
  /** Extra indent for nested rows (e.g. inside a sheets group) */
  nested?: boolean;
}

export function FileRow({
  f, isCollision, editingKey, editSchema, editTable, editError,
  onStartEdit, onEditSchema, onEditTable, onConfirmRename, onCancelEdit, onDelete,
  nested = false,
}: FileRowProps) {
  const tableInputRef = useRef<HTMLInputElement>(null);
  const isEditing = editingKey === f.s3_key;
  const colPreview = f.columns.slice(0, 4).map((c) => c.name).join(', ')
    + (f.columns.length > 4 ? ` +${f.columns.length - 4}` : '');

  if (isEditing) {
    return (
      <Box
        px={3}
        py={2}
        borderRadius="md"
        border="1px solid"
        borderColor="accent.teal"
        bg="accent.teal/5"
      >
        <HStack gap={1} align="center" wrap="nowrap">
          <Input
            size="xs"
            fontFamily="mono"
            w="24"
            value={editSchema}
            onChange={(e) => onEditSchema(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { tableInputRef.current?.focus(); }
              if (e.key === 'Escape') onCancelEdit();
            }}
            aria-label="Schema name"
            autoFocus
          />
          <Text fontSize="xs" flexShrink={0} color="fg.muted">.</Text>
          <Input
            ref={tableInputRef}
            size="xs"
            fontFamily="mono"
            w="28"
            value={editTable}
            onChange={(e) => onEditTable(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirmRename(f.s3_key);
              if (e.key === 'Escape') onCancelEdit();
            }}
            aria-label="Table name"
          />
          <IconButton size="xs" variant="ghost" colorPalette="green" aria-label="Confirm rename" onClick={() => onConfirmRename(f.s3_key)}>
            <LuCheck />
          </IconButton>
          <IconButton size="xs" variant="ghost" aria-label="Cancel rename" onClick={onCancelEdit}>
            <LuX />
          </IconButton>
        </HStack>
        {editError && (
          <Text fontSize="2xs" color="red.400" mt={1}>{editError}</Text>
        )}
      </Box>
    );
  }

  return (
    <HStack
      role="group"
      gap={2}
      px={3}
      py={1.5}
      borderRadius="md"
      transition="background 0.1s"
      _hover={{ bg: 'bg.surface' }}
      cursor="default"
    >
      <Text
        fontSize="xs"
        fontFamily="mono"
        fontWeight="600"
        color={isCollision ? 'red.400' : 'fg.default'}
        truncate
        flex={1}
        minW={0}
        title={colPreview}
      >
        {f.table_name}
      </Text>
      {isCollision && (
        <Box as="span" display="inline-flex" title="Duplicate name — rename to resolve" flexShrink={0}>
          <LuCircleAlert size={10} color="var(--chakra-colors-red-400)" />
        </Box>
      )}
      <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" whiteSpace="nowrap" flexShrink={0}>
        {f.row_count.toLocaleString()} rows
      </Text>
      <IconButton
        size="2xs"
        variant="ghost"
        aria-label={`Rename ${f.schema_name}.${f.table_name}`}
        color="fg.muted"
        onClick={() => onStartEdit(f)}
      >
        <LuPencil size={11} />
      </IconButton>
      <IconButton
        size="2xs"
        variant="ghost"
        colorPalette="red"
        aria-label={`Delete table ${f.table_name}`}
        onClick={() => onDelete(f.s3_key)}
      >
        <LuTrash2 size={11} />
      </IconButton>
    </HStack>
  );
}
