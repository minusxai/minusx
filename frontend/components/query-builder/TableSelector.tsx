/**
 * TableSelector - Dropdown for selecting FROM table
 */

'use client';

import { useState, useEffect } from 'react';
import { Box, Text, Spinner, HStack, createListCollection } from '@chakra-ui/react';
import {
  SelectRoot,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValueText,
} from '@/components/ui/select';
import { TableReference } from '@/lib/types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { LuTable } from 'react-icons/lu';

interface TableSelectorProps {
  databaseName: string;
  value: TableReference;
  onChange: (table: TableReference) => void;
}

export function TableSelector({
  databaseName,
  value,
  onChange,
}: TableSelectorProps) {
  const [tables, setTables] = useState<Array<{ name: string; schema?: string; displayName: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTables() {
      if (!databaseName) {
        setTables([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await CompletionsAPI.getTableSuggestions({
          databaseName,
        });

        if (result.success && result.tables) {
          setTables(result.tables);
        } else {
          setError(result.error || 'Failed to load tables');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    loadTables();
  }, [databaseName]);

  const handleChange = (items: string[]) => {
    const selectedValue = items[0];
    if (!selectedValue) return;

    const table = tables.find((t) => t.displayName === selectedValue);
    if (table) {
      onChange({
        table: table.name,
        schema: table.schema,
      });
    }
  };

  const currentValue = value.schema
    ? `${value.schema}.${value.table}`
    : value.table;

  return (
    <Box>
      <Text fontSize="sm" fontWeight="medium" mb={2}>
        <HStack gap={1}>
          <LuTable />
          <span>FROM Table</span>
        </HStack>
      </Text>
      {loading ? (
        <HStack>
          <Spinner size="sm" />
          <Text fontSize="sm" color="fg.muted">
            Loading tables...
          </Text>
        </HStack>
      ) : error ? (
        <Text fontSize="sm" color="fg.error">
          {error}
        </Text>
      ) : (
        <SelectRoot
          collection={createListCollection({
            items: tables.map((t) => ({ label: t.displayName, value: t.displayName })),
          })}
          value={[currentValue]}
          onValueChange={(e) => handleChange(e.value)}
          size="sm"
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select table..." />
          </SelectTrigger>
          <SelectContent>
            {tables.map((table) => (
              <SelectItem key={table.displayName} item={table.displayName}>
                {table.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
      )}
    </Box>
  );
}
