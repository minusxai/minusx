/**
 * FilterSection
 * Shows filter conditions as dismissible pills with inline editing
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, HStack, Text, VStack, Input, createListCollection, Button, IconButton } from '@chakra-ui/react';
import {
  SelectRoot,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValueText,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterGroup, FilterCondition } from '@/lib/sql/ir-types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { QueryChip, AddChipButton } from './QueryChip';
import { PickerPopover, PickerList, PickerItem } from './PickerPopover';
import { ColumnPickerDropdown } from './ColumnPickerDropdown';
import { LuX, LuPlus, LuChevronDown, LuCheck } from 'react-icons/lu';

interface FilterSectionProps {
  databaseName: string;
  tableName: string;
  tableSchema?: string;
  filter?: FilterGroup;
  onChange: (filter: FilterGroup | undefined) => void;
  onClose?: () => void;
  onRemove?: () => void;  // For removing nested groups
  label?: string;
  filterType?: 'where' | 'having'; // 'having' shows aggregate options
  depth?: number;  // Track nesting depth (0 = top level)
}

type Operator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';

const OPERATORS: Array<{ label: string; value: Operator; needsValue: boolean }> = [
  { label: 'is', value: '=', needsValue: true },
  { label: 'is not', value: '!=', needsValue: true },
  { label: '>', value: '>', needsValue: true },
  { label: '<', value: '<', needsValue: true },
  { label: '>=', value: '>=', needsValue: true },
  { label: '<=', value: '<=', needsValue: true },
  { label: 'contains', value: 'LIKE', needsValue: true },
  { label: 'is in', value: 'IN', needsValue: true },
  { label: 'is empty', value: 'IS NULL', needsValue: false },
  { label: 'is not empty', value: 'IS NOT NULL', needsValue: false },
];

const AGGREGATES = [
  { label: 'Count', value: 'COUNT' },
  { label: 'Sum', value: 'SUM' },
  { label: 'Average', value: 'AVG' },
  { label: 'Min', value: 'MIN' },
  { label: 'Max', value: 'MAX' },
  { label: 'Count distinct', value: 'COUNT_DISTINCT' },
];

/** Inline operator picker using PickerPopover — matches column picker style */
function OperatorPicker({ value, onChange }: { value: Operator; onChange: (op: Operator) => void }) {
  const [open, setOpen] = useState(false);
  const selected = OPERATORS.find(o => o.value === value);

  return (
    <PickerPopover
      open={open}
      onOpenChange={(details) => setOpen(details.open)}
      trigger={
        <HStack
          as="button"
          width="100%"
          px={3}
          py={1.5}
          borderRadius="md"
          border="1px solid"
          borderColor={open ? 'accent.teal' : 'border.default'}
          bg="bg.subtle"
          cursor="pointer"
          justify="space-between"
          transition="all 0.15s ease"
          _hover={{ borderColor: 'border.emphasized' }}
          onClick={() => setOpen(true)}
        >
          <Text fontSize="xs" fontFamily="mono" color="fg">
            {selected?.label || value}
          </Text>
          <Box color="fg.muted"><LuChevronDown size={12} /></Box>
        </HStack>
      }
      width="180px"
      padding={0}
    >
      <Box px={1} py={1}>
        <VStack gap={0.5} align="stretch">
          {OPERATORS.map(op => {
            const isSelected = op.value === value;
            return (
              <PickerItem
                key={op.value}
                onClick={() => { onChange(op.value); setOpen(false); }}
                selected={isSelected}
                selectedBg="rgba(45, 212, 191, 0.08)"
                rightElement={
                  isSelected ? <Box color="accent.teal"><LuCheck size={12} /></Box> : undefined
                }
              >
                <Text fontSize="xs" fontFamily="mono" fontWeight={isSelected ? '600' : '400'}>
                  {op.label}
                </Text>
              </PickerItem>
            );
          })}
        </VStack>
      </Box>
    </PickerPopover>
  );
}

export function FilterSection({
  databaseName,
  tableName,
  tableSchema,
  filterType = 'where',
  filter,
  onChange,
  onClose,
  onRemove,
  label = 'Filter',
  depth = 0,
}: FilterSectionProps) {
  const [availableColumns, setAvailableColumns] = useState<
    Array<{ name: string; type?: string; displayName: string }>
  >([]);
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newFilter, setNewFilter] = useState<{
    column: string;
    operator: Operator;
    value: string;
    isAggregate: boolean;
    aggregate?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';
  }>({ column: '', operator: '=', value: '', isAggregate: false });

  useEffect(() => {
    async function loadColumns() {
      if (!tableName || !databaseName) return;

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
      }
    }

    loadColumns();
  }, [databaseName, tableName, tableSchema]);

  // Separate conditions into FilterConditions and nested FilterGroups
  const filterConditions = filter?.conditions.filter((c): c is FilterCondition => 'column' in c) || [];
  const nestedGroups = filter?.conditions.filter((c): c is FilterGroup => !('column' in c)) || [];

  const handleAddFilter = useCallback(() => {
    // Validation
    if (filterType === 'having' && newFilter.isAggregate) {
      if (!newFilter.aggregate) return;
      if (newFilter.aggregate !== 'COUNT' && !newFilter.column) return;
    } else {
      if (!newFilter.column) return;
    }

    const op = OPERATORS.find((o) => o.value === newFilter.operator);
    if (op?.needsValue && !newFilter.value) return;

    const isParameter = newFilter.value.startsWith(':');
    const paramName = isParameter ? newFilter.value.slice(1) : undefined;
    const actualValue = isParameter ? undefined : (op?.needsValue ? newFilter.value : undefined);

    const condition: FilterCondition = filterType === 'having' && newFilter.isAggregate
      ? {
          column: newFilter.column || null,
          aggregate: newFilter.aggregate,
          operator: newFilter.operator,
          value: actualValue,
          param_name: paramName,
        }
      : {
          column: newFilter.column,
          operator: newFilter.operator,
          value: actualValue,
          param_name: paramName,
        };

    if (!filter) {
      onChange({ operator: 'AND', conditions: [condition] });
    } else {
      onChange({ ...filter, conditions: [...filter.conditions, condition] });
    }

    setNewFilter({ column: '', operator: '=', value: '', isAggregate: false });
    setAddFilterOpen(false);
  }, [newFilter, filter, onChange, filterType]);

  const handleUpdateFilter = useCallback(() => {
    if (editingIndex === null || !filter) return;

    if (filterType === 'having' && newFilter.isAggregate) {
      if (!newFilter.aggregate) return;
      if (newFilter.aggregate !== 'COUNT' && !newFilter.column) return;
    } else {
      if (!newFilter.column) return;
    }

    const op = OPERATORS.find((o) => o.value === newFilter.operator);
    if (op?.needsValue && !newFilter.value) return;

    const isParameter = newFilter.value.startsWith(':');
    const paramName = isParameter ? newFilter.value.slice(1) : undefined;
    const actualValue = isParameter ? undefined : (op?.needsValue ? newFilter.value : undefined);

    const newConditions = [...filter.conditions];
    newConditions[editingIndex] = filterType === 'having' && newFilter.isAggregate
      ? {
          column: newFilter.column || null,
          aggregate: newFilter.aggregate,
          operator: newFilter.operator,
          value: actualValue,
          param_name: paramName,
        }
      : {
          column: newFilter.column,
          operator: newFilter.operator,
          value: actualValue,
          param_name: paramName,
        };

    onChange({ ...filter, conditions: newConditions });
    setNewFilter({ column: '', operator: '=', value: '', isAggregate: false });
    setEditingIndex(null);
  }, [editingIndex, newFilter, filter, onChange, filterType]);

  const handleRemoveFilter = useCallback(
    (index: number) => {
      if (!filter) return;

      let actualIndex = 0;
      let filterCondCount = 0;
      for (let i = 0; i < filter.conditions.length; i++) {
        if ('column' in filter.conditions[i]) {
          if (filterCondCount === index) {
            actualIndex = i;
            break;
          }
          filterCondCount++;
        }
      }

      const newConditions = filter.conditions.filter((_, i) => i !== actualIndex);
      onChange(newConditions.length > 0 ? { ...filter, conditions: newConditions } : undefined);
    },
    [filter, onChange]
  );

  const handleEditFilter = useCallback((index: number) => {
    const cond = filterConditions[index];
    if (!cond || (!cond.column && !cond.aggregate)) return;

    const displayValue = cond.param_name ? `:${cond.param_name}` : (cond.value as string) || '';

    setNewFilter({
      column: cond.column || '',
      operator: cond.operator as Operator,
      value: displayValue,
      isAggregate: !!cond.aggregate,
      aggregate: cond.aggregate,
    });

    let actualIndex = 0;
    let filterCondCount = 0;
    for (let i = 0; i < (filter?.conditions.length || 0); i++) {
      if ('column' in (filter!.conditions[i])) {
        if (filterCondCount === index) {
          actualIndex = i;
          break;
        }
        filterCondCount++;
      }
    }
    setEditingIndex(actualIndex);
  }, [filterConditions, filter]);

  // Nested group handlers
  const handleAddGroup = useCallback(() => {
    const newGroup: FilterGroup = {
      operator: 'AND',
      conditions: []
    };

    if (!filter) {
      onChange({ operator: 'AND', conditions: [newGroup] });
    } else {
      onChange({ ...filter, conditions: [...filter.conditions, newGroup] });
    }
  }, [filter, onChange]);

  const handleRemoveGroup = useCallback((index: number) => {
    if (!filter) return;

    let actualIndex = 0;
    let groupCount = 0;
    for (let i = 0; i < filter.conditions.length; i++) {
      if (!('column' in filter.conditions[i])) {
        if (groupCount === index) {
          actualIndex = i;
          break;
        }
        groupCount++;
      }
    }

    const newConditions = filter.conditions.filter((_, i) => i !== actualIndex);
    onChange(newConditions.length > 0 ? { ...filter, conditions: newConditions } : undefined);
  }, [filter, onChange]);

  const handleGroupChange = useCallback((index: number, newGroup: FilterGroup | undefined) => {
    if (!filter) return;

    let actualIndex = 0;
    let groupCount = 0;
    for (let i = 0; i < filter.conditions.length; i++) {
      if (!('column' in filter.conditions[i])) {
        if (groupCount === index) {
          actualIndex = i;
          break;
        }
        groupCount++;
      }
    }

    if (!newGroup) {
      const newConditions = filter.conditions.filter((_, i) => i !== actualIndex);
      onChange(newConditions.length > 0 ? { ...filter, conditions: newConditions } : undefined);
    } else {
      const newConditions = [...filter.conditions];
      newConditions[actualIndex] = newGroup;
      onChange({ ...filter, conditions: newConditions });
    }
  }, [filter, onChange]);

  const handleOperatorToggle = useCallback(() => {
    if (!filter) return;
    onChange({
      ...filter,
      operator: filter.operator === 'AND' ? 'OR' : 'AND',
    });
  }, [filter, onChange]);

  const formatFilterLabel = (cond: FilterCondition) => {
    const op = OPERATORS.find((o) => o.value === cond.operator);
    const opLabel = op?.label || cond.operator;

    if (cond.aggregate) {
      const aggLabel = AGGREGATES.find(a => a.value === cond.aggregate)?.label || cond.aggregate;
      const columnPart = !cond.column ? '(*)' : `(${cond.column})`;
      const aggDisplay = `${aggLabel}${columnPart}`;

      if (!op?.needsValue) {
        return `${aggDisplay} ${opLabel}`;
      }
      const value = cond.param_name ? `:${cond.param_name}` : cond.value;
      return `${aggDisplay} ${opLabel} ${value}`;
    }

    if (!op?.needsValue) {
      return `${cond.column} ${opLabel}`;
    }

    const value = cond.param_name ? `:${cond.param_name}` : cond.value;
    return `${cond.column} ${opLabel} ${value}`;
  };

  const isEditing = editingIndex !== null;

  const totalItems = filterConditions.length + nestedGroups.length;
  const showOperatorToggle = totalItems > 1;

  // Shared filter form content (used by both add and edit popovers)
  const renderFilterForm = (mode: 'add' | 'edit') => (
    <VStack gap={2.5} align="stretch">
      <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
        {mode === 'add' ? 'Add filter' : 'Edit filter'}
      </Text>

      {/* Show aggregate toggle only for HAVING clause */}
      {filterType === 'having' && (
        <>
          <Checkbox
            checked={newFilter.isAggregate}
            onCheckedChange={(e) => setNewFilter(prev => ({
              ...prev,
              isAggregate: e.checked === true,
              column: '',
              aggregate: e.checked === true ? 'COUNT' : undefined,
            }))}
          >
            <Text fontSize="xs" fontFamily="mono">Use aggregate function</Text>
          </Checkbox>

          {newFilter.isAggregate && (
            <SelectRoot
              collection={createListCollection({
                items: AGGREGATES.map(a => ({ label: a.label, value: a.value }))
              })}
              value={newFilter.aggregate ? [newFilter.aggregate] : ['COUNT']}
              onValueChange={(e) => setNewFilter(prev => ({
                ...prev,
                aggregate: e.value[0] as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT',
                column: e.value[0] === 'COUNT' ? prev.column : '',
              }))}
              size="sm"
            >
              <SelectTrigger>
                <SelectValueText placeholder="Aggregate function" />
              </SelectTrigger>
              <SelectContent>
                {AGGREGATES.map(agg => (
                  <SelectItem key={agg.value} item={agg.value}>
                    {agg.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
          )}
        </>
      )}

      {/* Column selection — uses shared ColumnPickerDropdown */}
      {newFilter.isAggregate && newFilter.aggregate === 'COUNT' ? (
        <ColumnPickerDropdown
          databaseName={databaseName}
          tableName={tableName}
          tableSchema={tableSchema}
          value={newFilter.column}
          onChange={(col) => setNewFilter(prev => ({ ...prev, column: col }))}
          placeholder="Select column..."
          availableColumns={availableColumns}
          extraItems={[{ label: '* (all rows)', value: '' }]}
        />
      ) : (
        <ColumnPickerDropdown
          databaseName={databaseName}
          tableName={tableName}
          tableSchema={tableSchema}
          value={newFilter.column}
          onChange={(col) => setNewFilter(prev => ({ ...prev, column: col }))}
          placeholder="Select column..."
          availableColumns={availableColumns}
        />
      )}

      {/* Operator picker */}
      <OperatorPicker
        value={newFilter.operator}
        onChange={(op) => setNewFilter(prev => ({ ...prev, operator: op }))}
      />

      {/* Value input */}
      {OPERATORS.find((o) => o.value === newFilter.operator)?.needsValue && (
        <Input
          size="sm"
          placeholder={newFilter.operator === 'IN' ? '1, 2, 3' : 'Value or :param'}
          value={newFilter.value}
          onChange={(e) =>
            setNewFilter((prev) => ({ ...prev, value: e.target.value }))
          }
          fontFamily="mono"
          fontSize="xs"
          bg="bg.subtle"
          border="1px solid"
          borderColor="border.default"
          borderRadius="md"
          _focus={{ borderColor: 'accent.teal', boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)' }}
        />
      )}

      <Button
        size="xs"
        colorPalette="teal"
        fontFamily="mono"
        fontSize="xs"
        onClick={mode === 'add' ? handleAddFilter : handleUpdateFilter}
        disabled={
          filterType === 'having' && newFilter.isAggregate
            ? !newFilter.aggregate || (newFilter.aggregate !== 'COUNT' && !newFilter.column)
            : !newFilter.column
        }
      >
        {mode === 'add' ? 'Add Filter' : 'Update Filter'}
      </Button>
    </VStack>
  );

  return (
    <Box
      bg="bg.subtle"
      borderRadius="lg"
      border="1px solid"
      borderColor="border.muted"
      p={3}
      ml={depth > 0 ? 4 : 0}
    >
      <HStack justify="space-between" mb={2.5}>
        <HStack gap={2}>
          <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
            {depth > 0 ? 'Group' : label}
          </Text>

          {/* AND/OR Toggle - show if multiple items */}
          {showOperatorToggle && (
            <Button
              size="xs"
              variant="subtle"
              onClick={handleOperatorToggle}
              fontSize="xs"
              fontWeight="600"
              fontFamily="mono"
              px={2}
              py={0.5}
              h="auto"
            >
              {filter?.operator || 'AND'}
            </Button>
          )}
        </HStack>

        {/* Close button for top level, remove button for nested groups */}
        {depth === 0 && onClose && (
          <Box
            as="button"
            fontSize="xs"
            color="fg.muted"
            opacity={0.6}
            _hover={{ opacity: 1 }}
            onClick={onClose}
          >
            <LuX size={14} />
          </Box>
        )}
        {depth > 0 && onRemove && (
          <IconButton
            size="xs"
            variant="ghost"
            onClick={onRemove}
            aria-label="Remove group"
          >
            <LuX size={14} />
          </IconButton>
        )}
      </HStack>

      {/* Filter condition chips */}
      <HStack gap={2} flexWrap="wrap" align="center" mb={nestedGroups.length > 0 ? 3 : 0}>
        {filterConditions.map((cond, idx) => (
          <PickerPopover
            key={`filter-${idx}`}
            open={editingIndex === idx}
            onOpenChange={(details) => {
              if (!details.open) {
                setEditingIndex(null);
                setNewFilter({ column: '', operator: '=', value: '', isAggregate: false });
              }
            }}
            trigger={
              <Box>
                <QueryChip
                  variant="filter"
                  onRemove={() => handleRemoveFilter(idx)}
                  onClick={() => handleEditFilter(idx)}
                  isActive={editingIndex === idx}
                >
                  {formatFilterLabel(cond)}
                </QueryChip>
              </Box>
            }
            width="300px"
            padding={3}
          >
            {renderFilterForm('edit')}
          </PickerPopover>
        ))}

        {/* Add filter */}
        <PickerPopover
          open={addFilterOpen && !isEditing}
          onOpenChange={(details) => setAddFilterOpen(details.open)}
          trigger={
            <Box>
              <AddChipButton onClick={() => setAddFilterOpen(true)} variant="filter" />
            </Box>
          }
          width="300px"
          padding={3}
        >
          {renderFilterForm('add')}
        </PickerPopover>

        {/* Add group button - only show if depth < 2 (limit nesting) */}
        {depth < 2 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddGroup}
            fontSize="xs"
            fontFamily="mono"
            px={2}
            py={1}
            h="auto"
            borderStyle="dashed"
          >
            <LuPlus size={14} />
            <Text ml={1} fontFamily="mono">Add group</Text>
          </Button>
        )}
      </HStack>

      {/* Nested groups - RECURSIVE */}
      {nestedGroups.length > 0 && (
        <VStack gap={2} align="stretch" mt={3}>
          {nestedGroups.map((group, idx) => (
            <FilterSection
              key={`group-${idx}`}
              databaseName={databaseName}
              tableName={tableName}
              tableSchema={tableSchema}
              filter={group}
              onChange={(newGroup) => handleGroupChange(idx, newGroup)}
              onRemove={() => handleRemoveGroup(idx)}
              filterType={filterType}
              depth={depth + 1}
              label={`Group ${idx + 1}`}
            />
          ))}
        </VStack>
      )}
    </Box>
  );
}
