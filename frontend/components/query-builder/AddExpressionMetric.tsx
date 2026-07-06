/**
 * AddExpressionMetric
 * "Add custom expression metric" button + popover — lets the user add a
 * raw SQL expression metric. Extracted from SummarizeSection.
 */

'use client';

import { useState, useCallback } from 'react';
import { Box, Text } from '@chakra-ui/react';
import { SelectColumn } from '@/lib/types';
import { PickerPopover } from './PickerPopover';
import { ExpressionEditor } from './ExpressionEditor';
import { LuCode } from 'react-icons/lu';

interface AddExpressionMetricProps {
  columns: SelectColumn[];
  onColumnsChange: (columns: SelectColumn[]) => void;
}

export function AddExpressionMetric({ columns, onColumnsChange }: AddExpressionMetricProps) {
  const [addExprOpen, setAddExprOpen] = useState(false);
  const [newExprSql, setNewExprSql] = useState('');
  const [newExprAlias, setNewExprAlias] = useState('');

  const handleAddExprMetric = useCallback(() => {
    if (!newExprSql.trim()) return;
    const newCol: SelectColumn = {
      type: 'raw',
      raw_sql: newExprSql.trim(),
      alias: newExprAlias.trim() || undefined,
    };
    onColumnsChange([...columns, newCol]);
    setNewExprSql('');
    setNewExprAlias('');
    setAddExprOpen(false);
  }, [newExprSql, newExprAlias, columns, onColumnsChange]);

  return (
    <PickerPopover
      open={addExprOpen}
      onOpenChange={(details) => {
        setAddExprOpen(details.open);
        if (!details.open) { setNewExprSql(''); setNewExprAlias(''); }
      }}
      trigger={
        <Box
          as="button"
          display="inline-flex"
          alignItems="center"
          gap={1}
          bg="transparent"
          border="1px dashed"
          borderColor="rgba(134, 239, 172, 0.3)"
          borderRadius="md"
          px={2}
          py={1}
          cursor="pointer"
          transition="all 0.15s ease"
          _hover={{ bg: 'rgba(134, 239, 172, 0.08)', borderStyle: 'solid' }}
          onClick={() => setAddExprOpen(true)}
        >
          <LuCode size={11} color="var(--chakra-colors-fg-muted)" />
          <Text fontSize="xs" color="fg.muted" fontWeight="500" fontFamily="mono">expr</Text>
        </Box>
      }
      padding={3}
      width="340px"
    >
      <ExpressionEditor
        title="SQL Expression"
        sql={newExprSql}
        onSqlChange={setNewExprSql}
        alias={newExprAlias}
        onAliasChange={setNewExprAlias}
        placeholder="e.g. ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT user_id), 2)"
        buttonLabel="Add"
        onSubmit={handleAddExprMetric}
        disabled={!newExprSql.trim()}
      />
    </PickerPopover>
  );
}
