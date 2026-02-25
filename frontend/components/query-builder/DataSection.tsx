/**
 * DataSection
 * Compact row showing selected table with change option
 */

'use client';

import { useState, useEffect } from 'react';
import { Box, HStack, Text, Spinner } from '@chakra-ui/react';
import { TableReference } from '@/lib/types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { QueryChip } from './QueryChip';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';
import { AliasInput } from './AliasInput';
import { LuTable, LuDatabase, LuChartBar } from 'react-icons/lu';
import type { QuestionOption } from '@/lib/hooks/useAvailableQuestions';

interface DataSectionProps {
  databaseName: string;
  value: TableReference;
  onChange: (table: TableReference) => void;
  availableQuestions?: QuestionOption[];
}

export function DataSection({ databaseName, value, onChange, availableQuestions = [] }: DataSectionProps) {
  const [tables, setTables] = useState<Array<{ name: string; schema?: string; displayName: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // Resolve display name for the current table value when it's a @reference
  const isReference = value.table?.startsWith('@');
  const referencedQuestion = isReference
    ? availableQuestions.find(q => `@${q.alias}` === value.table)
    : null;

  useEffect(() => {
    async function loadTables() {
      if (!databaseName) return;

      setLoading(true);
      try {
        const result = await CompletionsAPI.getTableSuggestions({ databaseName });
        if (result.success && result.tables) {
          setTables(result.tables);
        }
      } catch (err) {
        console.error('Failed to load tables:', err);
      } finally {
        setLoading(false);
      }
    }

    loadTables();
  }, [databaseName]);

  const handleSelect = (table: { name: string; schema?: string }) => {
    onChange({ table: table.name, schema: table.schema, alias: value.alias });
    setOpen(false);
  };

  const handleSelectQuestion = (q: QuestionOption) => {
    onChange({ table: `@${q.alias}`, schema: undefined, alias: value.alias });
    setOpen(false);
  };

  const handleAliasChange = (newAlias: string) => {
    const trimmed = newAlias.trim();
    onChange({ ...value, alias: trimmed || undefined });
  };

  return (
    <Box
      bg="bg.subtle"
      borderRadius="lg"
      border="1px solid"
      borderColor="border.muted"
      p={3}
    >
      <Text fontSize="xs" fontWeight="600" color="fg.muted" mb={2.5} textTransform="uppercase" letterSpacing="0.05em">
        Data
      </Text>

      <HStack gap={2} align="center" flexWrap="wrap">
        <PickerPopover
          open={open}
          onOpenChange={(details) => setOpen(details.open)}
          positioning={{ placement: 'bottom-start' }}
          trigger={
            <Box cursor="pointer">
              {value.table ? (
                <QueryChip
                  variant="table"
                  icon={isReference ? <LuChartBar size={11} /> : <LuTable size={11} />}
                  onClick={() => setOpen(true)}
                >
                  {isReference
                    ? (referencedQuestion?.name ?? value.table)
                    : (value.schema ? `${value.schema}.${value.table}` : value.table)}
                  {value.alias && <Text as="span" color="fg.muted" fontWeight="400"> as {value.alias}</Text>}
                </QueryChip>
              ) : (
                <Box
                  as="button"
                  bg="bg.subtle"
                  border="1px dashed"
                  borderColor="border.emphasized"
                  borderRadius="lg"
                  px={3}
                  py={2}
                  cursor="pointer"
                  _hover={{ bg: 'bg.muted', borderStyle: 'solid' }}
                  transition="all 0.15s ease"
                  onClick={() => setOpen(true)}
                >
                  <HStack gap={2}>
                    <Box color="accent.primary"><LuDatabase size={14} /></Box>
                    <Text fontSize="sm" color="accent.primary">
                      Select a table...
                    </Text>
                  </HStack>
                </Box>
              )}
            </Box>
          }
        >
          <HStack justify="space-between" align="center" px={1} mb={1}>
            <PickerHeader>Tables</PickerHeader>
            {value.table && (
              <HStack gap={1.5} align="center">
                <Text fontSize="xs" color="fg.muted" flexShrink={0}>as</Text>
                <AliasInput
                  value={value.alias}
                  onChange={(alias) => handleAliasChange(alias || '')}
                  placeholder="alias"
                  width="80px"
                />
              </HStack>
            )}
          </HStack>
          <PickerList maxH="300px" searchable searchPlaceholder="Search tables or questions...">
            {(query) =>
              loading ? (
                <HStack px={2} py={3} justify="center">
                  <Spinner size="sm" />
                  <Text fontSize="sm" color="fg.muted">
                    Loading...
                  </Text>
                </HStack>
              ) : (
                <>
                  {/* DB tables */}
                  {tables
                    .filter((t) => !query || t.displayName.toLowerCase().includes(query.toLowerCase()))
                    .map((table) => {
                      const tableDisplayName = table.schema ? `${table.schema}.${table.name}` : table.name;
                      const isSelected = !isReference && tableDisplayName === (value.schema ? `${value.schema}.${value.table}` : value.table);
                      return (
                        <PickerItem
                          key={table.displayName}
                          icon={<LuTable size={14} />}
                          selected={isSelected}
                          onClick={() => handleSelect(table)}
                        >
                          {table.displayName}
                        </PickerItem>
                      );
                    })}
                  {/* Questions section */}
                  {availableQuestions.length > 0 && (
                    <>
                      {(tables.length > 0 || query) && (
                        <Text fontSize="10px" fontWeight="600" color="fg.subtle" textTransform="uppercase"
                          letterSpacing="0.08em" px={2} pt={2} pb={1}>
                          Questions
                        </Text>
                      )}
                      {availableQuestions
                        .filter((q) => !query || q.name.toLowerCase().includes(query.toLowerCase()) || q.alias.toLowerCase().includes(query.toLowerCase()))
                        .map((q) => {
                          const isSelected = isReference && `@${q.alias}` === value.table;
                          return (
                            <PickerItem
                              key={q.id}
                              icon={<LuChartBar size={14} />}
                              selected={isSelected}
                              onClick={() => handleSelectQuestion(q)}
                            >
                              {q.name}
                            </PickerItem>
                          );
                        })}
                    </>
                  )}
                </>
              )
            }
          </PickerList>
        </PickerPopover>
      </HStack>
    </Box>
  );
}
