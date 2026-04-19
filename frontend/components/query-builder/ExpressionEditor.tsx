/**
 * ExpressionEditor
 * Shared SQL expression editor used across query builder sections.
 * Consistent styling: mono font, teal accents, optional alias field.
 */

'use client';

import { HStack, Text, VStack, Textarea, Button } from '@chakra-ui/react';
import { AliasInput } from './AliasInput';

interface ExpressionEditorProps {
  title: string;
  sql: string;
  onSqlChange: (sql: string) => void;
  alias?: string;
  onAliasChange?: (alias: string) => void;
  placeholder?: string;
  buttonLabel: string;
  onSubmit: () => void;
  disabled?: boolean;
}

export function ExpressionEditor({
  title,
  sql,
  onSqlChange,
  alias,
  onAliasChange,
  placeholder = 'e.g. CASE WHEN status = \'active\' THEN 1 ELSE 0 END',
  buttonLabel,
  onSubmit,
  disabled = false,
}: ExpressionEditorProps) {
  return (
    <VStack gap={2} align="stretch">
      <HStack justify="space-between" align="center">
        <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
          {title}
        </Text>
        {onAliasChange && (
          <HStack gap={1.5}>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" flexShrink={0}>as</Text>
            <AliasInput
              value={alias}
              onChange={(a) => onAliasChange(a || '')}
              placeholder="alias"
            />
          </HStack>
        )}
      </HStack>
      <Textarea
        value={sql}
        onChange={(e) => onSqlChange(e.target.value)}
        rows={3}
        fontFamily="mono"
        fontSize="xs"
        placeholder={placeholder}
        resize="vertical"
        bg="bg.subtle"
        border="1px solid"
        borderColor="border.default"
        borderRadius="md"
        _focus={{ borderColor: 'accent.teal', boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)' }}
      />
      <Button
        size="xs"
        colorPalette="teal"
        fontFamily="mono"
        fontSize="xs"
        onClick={onSubmit}
        disabled={disabled}
      >
        {buttonLabel}
      </Button>
    </VStack>
  );
}
