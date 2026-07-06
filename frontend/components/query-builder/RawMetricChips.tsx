/**
 * RawMetricChips
 * Renders raw SQL expression metric chips (complex SQL: CASE, arithmetic, etc.)
 * — editable via a SQL editor popover. Extracted from SummarizeSection.
 */

'use client';

import { useState, useCallback } from 'react';
import { Box } from '@chakra-ui/react';
import { SelectColumn } from '@/lib/types';
import { QueryChip } from './QueryChip';
import { PickerPopover } from './PickerPopover';
import { ExpressionEditor } from './ExpressionEditor';
import { LuCode } from 'react-icons/lu';

interface RawMetricChipsProps {
  columns: SelectColumn[];
  onColumnsChange: (columns: SelectColumn[]) => void;
}

export function RawMetricChips({ columns, onColumnsChange }: RawMetricChipsProps) {
  const [editingRawMetricIndex, setEditingRawMetricIndex] = useState<number | null>(null);
  const [editRawSql, setEditRawSql] = useState('');
  const [editRawAlias, setEditRawAlias] = useState('');

  const rawMetrics = columns.filter((c) => c.type === 'raw');

  const handleRemoveRawMetric = useCallback(
    (rawIndex: number) => {
      const rawIndices = columns
        .map((c, i) => (c.type === 'raw' ? i : -1))
        .filter((i) => i !== -1);
      const actualIndex = rawIndices[rawIndex];
      onColumnsChange(columns.filter((_, i) => i !== actualIndex));
    },
    [columns, onColumnsChange]
  );

  const handleOpenRawMetricEdit = useCallback((idx: number) => {
    const metric = rawMetrics[idx];
    if (!metric) return;
    setEditRawSql(metric.raw_sql || '');
    setEditRawAlias(metric.alias || '');
    setEditingRawMetricIndex(idx);
  }, [rawMetrics]);

  const handleSaveRawMetric = useCallback(() => {
    if (editingRawMetricIndex === null) return;
    const rawIndices = columns
      .map((c, i) => (c.type === 'raw' ? i : -1))
      .filter((i) => i !== -1);
    const actualIndex = rawIndices[editingRawMetricIndex];
    const newColumns = [...columns];
    newColumns[actualIndex] = {
      ...newColumns[actualIndex],
      raw_sql: editRawSql.trim(),
      alias: editRawAlias.trim() || undefined,
    };
    onColumnsChange(newColumns);
    setEditingRawMetricIndex(null);
  }, [editingRawMetricIndex, editRawSql, editRawAlias, columns, onColumnsChange]);

  return (
    <>
      {/* Raw expression metric chips (complex SQL: CASE, arithmetic, etc.) — editable via SQL editor */}
      {rawMetrics.map((metric, idx) => (
        <PickerPopover
          key={`raw-metric-${idx}`}
          open={editingRawMetricIndex === idx}
          onOpenChange={(details) => {
            if (!details.open) setEditingRawMetricIndex(null);
          }}
          trigger={
            <Box>
              <QueryChip
                variant="metric"
                icon={<LuCode size={11} />}
                onRemove={() => handleRemoveRawMetric(idx)}
                onClick={() => handleOpenRawMetricEdit(idx)}
                isActive={editingRawMetricIndex === idx}
              >
                {metric.alias || metric.raw_sql?.slice(0, 40) || 'expression'}
              </QueryChip>
            </Box>
          }
          padding={3}
          width="340px"
        >
          <ExpressionEditor
            title="SQL Expression"
            sql={editRawSql}
            onSqlChange={setEditRawSql}
            alias={editRawAlias}
            onAliasChange={setEditRawAlias}
            placeholder="e.g. ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT user_id), 2)"
            buttonLabel="Apply"
            onSubmit={handleSaveRawMetric}
            disabled={!editRawSql.trim()}
          />
        </PickerPopover>
      ))}
    </>
  );
}
