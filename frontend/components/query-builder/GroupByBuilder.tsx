/**
 * GroupByBuilder - Multi-select for GROUP BY columns
 * Shows validation warnings if non-aggregate SELECT columns are missing
 */

'use client';

import { useState, useEffect } from 'react';
import { Box, Text, Button, HStack, VStack, Badge, IconButton, createListCollection } from '@chakra-ui/react';
import {
  SelectRoot,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValueText,
} from '@/components/ui/select';
import { GroupByClause, SelectColumn } from '@/lib/sql/ir-types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { LuPlus, LuX, LuGroup } from 'react-icons/lu';

interface GroupByBuilderProps {
  databaseName: string;
  tableName: string;
  tableSchema?: string;
  groupBy?: GroupByClause;
  onChange: (groupBy: GroupByClause | undefined) => void;
  selectColumns?: SelectColumn[]; // For validation
}

export function GroupByBuilder({
  databaseName,
  tableName,
  tableSchema,
  groupBy,
  onChange,
  selectColumns = [],
}: GroupByBuilderProps) {
  const [availableColumns, setAvailableColumns] = useState<
    Array<{ name: string; type?: string; displayName: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [selectedColumnToAdd, setSelectedColumnToAdd] = useState<string>('');

  useEffect(() => {
    async function loadColumns() {
      if (!tableName) return;

      setLoading(true);
      try {
        const result = await CompletionsAPI.getColumnSuggestions({
          databaseName,
          table: tableName,
          schema: tableSchema,
        });

        if (result.success && result.columns) {
          setAvailableColumns(result.columns);
        }
      } catch (err) {
        console.error('Failed to load columns:', err);
      } finally {
        setLoading(false);
      }
    }

    loadColumns();
  }, [databaseName, tableName, tableSchema]);

  const handleAddColumn = () => {
    if (!selectedColumnToAdd) return;

    const newColumn = {
      column: selectedColumnToAdd,
      table: undefined,
    };

    if (!groupBy) {
      onChange({
        columns: [newColumn],
      });
    } else {
      onChange({
        columns: [...groupBy.columns, newColumn],
      });
    }

    setSelectedColumnToAdd('');
  };

  const handleRemoveColumn = (index: number) => {
    if (!groupBy) return;

    const newColumns = groupBy.columns.filter((_, i) => i !== index);
    if (newColumns.length === 0) {
      onChange(undefined);
    } else {
      onChange({
        columns: newColumns,
      });
    }
  };

  // Validation: Find non-aggregate SELECT columns not in GROUP BY
  const getValidationWarnings = () => {
    if (!groupBy || selectColumns.length === 0) return [];

    const groupByColumnNames = groupBy.columns.map((c) => c.column);
    const warnings: string[] = [];

    selectColumns.forEach((col) => {
      // For non-aggregate columns, check if they're in GROUP BY
      // (column should not be null for non-aggregates, but check to be safe)
      if (col.type !== 'aggregate' && col.column && !groupByColumnNames.includes(col.column)) {
        warnings.push(`Column "${col.column}" should be in GROUP BY or use an aggregate function`);
      }
    });

    return warnings;
  };

  const warnings = getValidationWarnings();

  return (
    <Box>
      <Text fontSize="sm" fontWeight="medium" mb={2}>
        <HStack gap={1}>
          <LuGroup />
          <span>GROUP BY</span>
        </HStack>
      </Text>

      {/* Selected columns */}
      <VStack align="stretch" gap={2} mb={3}>
        {groupBy?.columns.map((col, index) => (
          <HStack key={index} gap={2}>
            <Badge
              colorPalette="purple"
              variant="subtle"
              px={2}
              py={1}
              flex={1}
            >
              {col.table ? `${col.table}.${col.column}` : col.column}
            </Badge>

            <IconButton
              size="xs"
              variant="ghost"
              onClick={() => handleRemoveColumn(index)}
              aria-label="Remove column"
            >
              <LuX />
            </IconButton>
          </HStack>
        ))}

        {(!groupBy || groupBy.columns.length === 0) && (
          <Text fontSize="sm" color="fg.muted">
            No columns grouped
          </Text>
        )}
      </VStack>

      {/* Add column selector */}
      <HStack mb={3}>
        <SelectRoot
          collection={createListCollection({
            items: availableColumns.map((c) => ({ label: c.name, value: c.name })),
          })}
          value={selectedColumnToAdd ? [selectedColumnToAdd] : []}
          onValueChange={(e) => setSelectedColumnToAdd(e.value[0] || '')}
          size="sm"
          flex={1}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Add column..." />
          </SelectTrigger>
          <SelectContent>
            {availableColumns.map((column) => (
              <SelectItem key={column.name} item={column.name}>
                {column.name}
                {column.type && (
                  <Text as="span" fontSize="xs" color="fg.muted" ml={2}>
                    {column.type}
                  </Text>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
        <Button
          size="sm"
          onClick={handleAddColumn}
          disabled={!selectedColumnToAdd || loading}
        >
          <LuPlus />
          <Text ml={1}>Add</Text>
        </Button>
      </HStack>

      {/* Validation warnings */}
      {warnings.length > 0 && (
        <VStack align="stretch" gap={1}>
          {warnings.map((warning, index) => (
            <Text key={index} fontSize="xs" color="orange.500">
              ⚠️ {warning}
            </Text>
          ))}
        </VStack>
      )}
    </Box>
  );
}
