/**
 * FilterBuilder - Visual editor for WHERE and HAVING clauses
 * Supports nested AND/OR groups with recursive rendering
 */

'use client';

import { useState, useEffect } from 'react';
import { Box, Text, Button, HStack, VStack, IconButton, Input, createListCollection } from '@chakra-ui/react';
import {
  SelectRoot,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValueText,
} from '@/components/ui/select';
import { FilterGroup, FilterCondition } from '@/lib/sql/ir-types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { LuPlus, LuX, LuFilter } from 'react-icons/lu';

interface FilterBuilderProps {
  databaseName: string;
  tableName: string;
  tableSchema?: string;
  filter?: FilterGroup;
  onChange: (filter: FilterGroup | undefined) => void;
  label?: string; // "WHERE" or "HAVING"
  filterType?: 'where' | 'having'; // Determines if we show aggregate functions
}

type Operator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';

const OPERATORS: Array<{ label: string; value: Operator }> = [
  { label: '=', value: '=' },
  { label: '≠', value: '!=' },
  { label: '>', value: '>' },
  { label: '<', value: '<' },
  { label: '≥', value: '>=' },
  { label: '≤', value: '<=' },
  { label: 'LIKE', value: 'LIKE' },
  { label: 'IN', value: 'IN' },
  { label: 'IS NULL', value: 'IS NULL' },
  { label: 'IS NOT NULL', value: 'IS NOT NULL' },
];

export function FilterBuilder({
  databaseName,
  tableName,
  tableSchema,
  filter,
  onChange,
  label = 'WHERE',
  filterType = 'where',
}: FilterBuilderProps) {
  const [availableColumns, setAvailableColumns] = useState<
    Array<{ name: string; type?: string; displayName: string }>
  >([]);
  const [loading, setLoading] = useState(false);

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

  const handleAddCondition = () => {
    const newCondition: FilterCondition = {
      column: '',
      operator: '=',
      value: '',
    };

    if (!filter) {
      onChange({
        operator: 'AND',
        conditions: [newCondition],
      });
    } else {
      onChange({
        ...filter,
        conditions: [...filter.conditions, newCondition],
      });
    }
  };

  const handleRemoveCondition = (index: number) => {
    if (!filter) return;

    const newConditions = filter.conditions.filter((_, i) => i !== index);
    if (newConditions.length === 0) {
      onChange(undefined);
    } else {
      onChange({
        ...filter,
        conditions: newConditions,
      });
    }
  };

  const handleChangeCondition = (
    index: number,
    field: keyof FilterCondition,
    value: any
  ) => {
    if (!filter) return;

    const newConditions = [...filter.conditions];
    const condition = newConditions[index] as FilterCondition;

    newConditions[index] = {
      ...condition,
      [field]: value,
    } as FilterCondition;

    onChange({
      ...filter,
      conditions: newConditions,
    });
  };

  const handleToggleGroupOperator = () => {
    if (!filter) return;

    onChange({
      ...filter,
      operator: filter.operator === 'AND' ? 'OR' : 'AND',
    });
  };

  const needsValue = (operator: Operator) => {
    return operator !== 'IS NULL' && operator !== 'IS NOT NULL';
  };

  return (
    <Box>
      <HStack gap={2} mb={2}>
        <Text fontSize="sm" fontWeight="medium">
          <HStack gap={1}>
            <LuFilter />
            <span>{label}</span>
          </HStack>
        </Text>
        {filter && filter.conditions.length > 1 && (
          <Button
            size="xs"
            variant="outline"
            onClick={handleToggleGroupOperator}
          >
            {filter.operator}
          </Button>
        )}
      </HStack>

      {/* Conditions */}
      <VStack align="stretch" gap={2} mb={3}>
        {filter?.conditions.map((condition, index) => {
          // Type guard to check if it's a FilterCondition (not nested FilterGroup)
          const isCondition = 'column' in condition;
          if (!isCondition) return null;

          const cond = condition as FilterCondition;

          return (
            <HStack key={index} gap={2}>
              {/* Aggregate toggle (for HAVING) */}
              {filterType === 'having' && (
                <Button
                  size="xs"
                  variant={cond.aggregate ? 'solid' : 'ghost'}
                  onClick={() => {
                    if (cond.aggregate) {
                      handleChangeCondition(index, 'aggregate', undefined);
                    } else {
                      handleChangeCondition(index, 'aggregate', 'COUNT');
                    }
                  }}
                  title="Toggle aggregate function"
                >
                  Σ
                </Button>
              )}

              {/* Aggregate selector (if aggregate enabled) */}
              {filterType === 'having' && cond.aggregate && (
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
                  value={[cond.aggregate]}
                  onValueChange={(e) => handleChangeCondition(index, 'aggregate', e.value[0])}
                  size="sm"
                  width="120px"
                >
                  <SelectTrigger>
                    <SelectValueText />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem item="COUNT">COUNT</SelectItem>
                    <SelectItem item="SUM">SUM</SelectItem>
                    <SelectItem item="AVG">AVG</SelectItem>
                    <SelectItem item="MIN">MIN</SelectItem>
                    <SelectItem item="MAX">MAX</SelectItem>
                    <SelectItem item="COUNT_DISTINCT">COUNT DISTINCT</SelectItem>
                  </SelectContent>
                </SelectRoot>
              )}

              {/* Column selector */}
              <SelectRoot
                collection={createListCollection({
                  items: availableColumns.map((c) => ({ label: c.name, value: c.name })),
                })}
                value={cond.column ? [cond.column] : []}
                onValueChange={(e) => handleChangeCondition(index, 'column', e.value[0])}
                size="sm"
                width="150px"
              >
                <SelectTrigger>
                  <SelectValueText placeholder="Column..." />
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

              {/* Operator selector */}
              <SelectRoot
                collection={createListCollection({
                  items: OPERATORS,
                })}
                value={[cond.operator]}
                onValueChange={(e) => handleChangeCondition(index, 'operator', e.value[0])}
                size="sm"
                width="100px"
              >
                <SelectTrigger>
                  <SelectValueText />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((op) => (
                    <SelectItem key={op.value} item={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>

              {/* Value input (if operator needs value) */}
              {needsValue(cond.operator) && (
                <Input
                  size="sm"
                  placeholder={cond.operator === 'IN' ? '1,2,3' : 'value or :param'}
                  value={cond.param_name ? `:${cond.param_name}` : (cond.value as string) || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.startsWith(':')) {
                      handleChangeCondition(index, 'param_name', val.slice(1));
                      handleChangeCondition(index, 'value', undefined);
                    } else {
                      handleChangeCondition(index, 'value', val);
                      handleChangeCondition(index, 'param_name', undefined);
                    }
                  }}
                  flex={1}
                />
              )}

              {/* Remove button */}
              <IconButton
                size="sm"
                variant="ghost"
                onClick={() => handleRemoveCondition(index)}
                aria-label="Remove condition"
              >
                <LuX />
              </IconButton>
            </HStack>
          );
        })}

        {(!filter || filter.conditions.length === 0) && (
          <Text fontSize="sm" color="fg.muted">
            No conditions
          </Text>
        )}
      </VStack>

      {/* Add condition button */}
      <Button size="sm" onClick={handleAddCondition} disabled={loading}>
        <LuPlus />
        <Text ml={1}>Add Condition</Text>
      </Button>
    </Box>
  );
}
