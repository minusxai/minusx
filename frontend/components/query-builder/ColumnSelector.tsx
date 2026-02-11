/**
 * ColumnSelector - Multi-select for SELECT columns
 */

'use client';

import { useState, useEffect } from 'react';
import { Box, Text, Button, HStack, VStack, Badge, Spinner, IconButton, Input, createListCollection } from '@chakra-ui/react';
import {
  SelectRoot,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValueText,
} from '@/components/ui/select';
import { SelectColumn } from '@/lib/types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { LuPlus, LuX, LuColumns3 } from 'react-icons/lu';

interface ColumnSelectorProps {
  databaseName: string;
  tableName: string;
  tableSchema?: string;
  tableAlias?: string;
  columns: SelectColumn[];
  onChange: (columns: SelectColumn[]) => void;
}

export function ColumnSelector({
  databaseName,
  tableName,
  tableSchema,
  tableAlias,
  columns,
  onChange,
}: ColumnSelectorProps) {
  const [availableColumns, setAvailableColumns] = useState<
    Array<{ name: string; type?: string; displayName: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedColumnToAdd, setSelectedColumnToAdd] = useState<string>('');

  useEffect(() => {
    async function loadColumns() {
      if (!tableName || !databaseName) {
        setAvailableColumns([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await CompletionsAPI.getColumnSuggestions({
          databaseName,
          table: tableName,
          schema: tableSchema,
        });

        if (result.success && result.columns) {
          setAvailableColumns(result.columns);
        } else {
          setError(result.error || 'Failed to load columns');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    loadColumns();
  }, [databaseName, tableName, tableSchema]);

  const handleAddColumn = () => {
    if (!selectedColumnToAdd) return;

    const newColumn: SelectColumn = {
      type: 'column',
      column: selectedColumnToAdd,
      table: tableAlias,
    };

    onChange([...columns, newColumn]);
    setSelectedColumnToAdd('');
  };

  const handleRemoveColumn = (index: number) => {
    onChange(columns.filter((_, i) => i !== index));
  };

  const handleToggleAggregate = (index: number) => {
    const newColumns = [...columns];
    const col = newColumns[index];

    if (col.type === 'aggregate') {
      // Remove aggregate
      newColumns[index] = {
        ...col,
        type: 'column',
        aggregate: undefined,
      };
    } else {
      // Add COUNT aggregate by default
      newColumns[index] = {
        ...col,
        type: 'aggregate',
        aggregate: 'COUNT',
      };
    }

    onChange(newColumns);
  };

  const handleChangeAggregate = (index: number, agg: string) => {
    const newColumns = [...columns];
    newColumns[index] = {
      ...newColumns[index],
      aggregate: agg as any,
    };
    onChange(newColumns);
  };

  const handleChangeAlias = (index: number, alias: string) => {
    const newColumns = [...columns];
    newColumns[index] = {
      ...newColumns[index],
      alias: alias || undefined,
    };
    onChange(newColumns);
  };

  const displayColumn = (col: SelectColumn) => {
    let display = col.table ? `${col.table}.${col.column}` : col.column;
    if (col.type === 'aggregate' && col.aggregate) {
      display = `${col.aggregate}(${display})`;
    }
    if (col.alias) {
      display += ` AS ${col.alias}`;
    }
    return display;
  };

  return (
    <Box>
      <Text fontSize="sm" fontWeight="medium" mb={2}>
        <HStack gap={1}>
          <LuColumns3 />
          <span>SELECT Columns</span>
        </HStack>
      </Text>

      {/* Selected columns */}
      <VStack align="stretch" gap={2} mb={3}>
        {columns.map((col, index) => (
          <HStack key={index} gap={2}>
            <Badge
              colorPalette={col.type === 'aggregate' ? 'blue' : 'gray'}
              variant="subtle"
              px={2}
              py={1}
              flex={1}
            >
              {displayColumn(col)}
            </Badge>

            {/* Aggregate toggle */}
            <Button
              size="xs"
              variant={col.type === 'aggregate' ? 'solid' : 'ghost'}
              onClick={() => handleToggleAggregate(index)}
              title="Toggle aggregate function"
            >
              Σ
            </Button>

            {/* Aggregate type selector */}
            {col.type === 'aggregate' && (
              <SelectRoot
                collection={createListCollection({
                  items: [
                    { label: 'COUNT', value: 'COUNT' },
                    { label: 'SUM', value: 'SUM' },
                    { label: 'AVG', value: 'AVG' },
                    { label: 'MIN', value: 'MIN' },
                    { label: 'MAX', value: 'MAX' },
                    { label: 'COUNT DISTINCT', value: 'COUNT_DISTINCT' },
                  ],
                })}
                value={[col.aggregate || 'COUNT']}
                onValueChange={(e) => handleChangeAggregate(index, e.value[0])}
                size="xs"
                width="120px"
              >
                <SelectTrigger>
                  <SelectValueText />
                </SelectTrigger>
                <SelectContent>
                  {['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT'].map((agg) => (
                    <SelectItem key={agg} item={agg}>
                      {agg}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>
            )}

            {/* Alias input */}
            <Input
              size="xs"
              placeholder="alias"
              value={col.alias || ''}
              onChange={(e) => handleChangeAlias(index, e.target.value)}
              width="100px"
            />

            {/* Remove button */}
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

        {columns.length === 0 && (
          <Text fontSize="sm" color="fg.muted">
            No columns selected
          </Text>
        )}
      </VStack>

      {/* Add column selector */}
      {loading ? (
        <HStack>
          <Spinner size="sm" />
          <Text fontSize="sm" color="fg.muted">
            Loading columns...
          </Text>
        </HStack>
      ) : error ? (
        <Text fontSize="sm" color="fg.error">
          {error}
        </Text>
      ) : (
        <HStack>
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
            disabled={!selectedColumnToAdd}
          >
            <LuPlus />
            <Text ml={1}>Add</Text>
          </Button>
        </HStack>
      )}
    </Box>
  );
}
