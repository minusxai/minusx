/**
 * DataSection
 * Compact row showing selected table with change option
 */

'use client';

import { useState, useEffect } from 'react';
import { Box, HStack, Text, VStack, Spinner, Popover, Portal, Input } from '@chakra-ui/react';
import { TableReference } from '@/lib/types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { QueryChip } from './QueryChip';
import { LuTable, LuDatabase } from 'react-icons/lu';

interface DataSectionProps {
  databaseName: string;
  value: TableReference;
  onChange: (table: TableReference) => void;
}

export function DataSection({ databaseName, value, onChange }: DataSectionProps) {
  const [tables, setTables] = useState<Array<{ name: string; schema?: string; displayName: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

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

  const handleAliasChange = (newAlias: string) => {
    const trimmed = newAlias.trim();
    onChange({ ...value, alias: trimmed || undefined });
  };

  return (
    <Box
      bg="rgba(255, 255, 255, 0.02)"
      borderRadius="lg"
      border="1px solid"
      borderColor="rgba(255, 255, 255, 0.06)"
      p={3}
    >
      <Text fontSize="xs" fontWeight="600" color="fg.muted" mb={2.5} textTransform="uppercase" letterSpacing="0.05em">
        Data
      </Text>

      <HStack gap={2} align="center" flexWrap="wrap">
        <Popover.Root open={open} onOpenChange={(details) => setOpen(details.open)} positioning={{ placement: 'bottom-start' }}>
          <Popover.Trigger asChild>
            <Box cursor="pointer">
              {value.table ? (
                <QueryChip variant="table" icon={<LuTable size={11} />} onClick={() => setOpen(true)}>
                  {value.schema ? `${value.schema}.${value.table}` : value.table}
                  {value.alias && <Text as="span" color="fg.muted" fontWeight="400"> as {value.alias}</Text>}
                </QueryChip>
              ) : (
                <Box
                  as="button"
                  bg="rgba(99, 102, 241, 0.1)"
                  border="1px dashed"
                  borderColor="rgba(99, 102, 241, 0.3)"
                  borderRadius="lg"
                  px={3}
                  py={2}
                  cursor="pointer"
                  _hover={{ bg: 'rgba(99, 102, 241, 0.15)', borderStyle: 'solid' }}
                  transition="all 0.15s ease"
                  onClick={() => setOpen(true)}
                >
                  <HStack gap={2}>
                    <LuDatabase size={14} color="#a5b4fc" />
                    <Text fontSize="sm" color="#a5b4fc">
                      Select a table...
                    </Text>
                  </HStack>
                </Box>
              )}
            </Box>
          </Popover.Trigger>
          <Portal>
            <Popover.Positioner>
              <Popover.Content width="280px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} overflow="hidden" borderRadius="lg">
                <Popover.Body p={2} bg="gray.900">
                  {/* Alias input at the top when table is selected */}
                  {value.table && (
                    <Box px={2} py={2} borderBottom="1px solid" borderColor="rgba(255, 255, 255, 0.06)" mb={2}>
                      <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" mb={1.5}>
                        Alias
                      </Text>
                      <Input
                        size="sm"
                        placeholder="Optional alias..."
                        value={value.alias || ''}
                        onChange={(e) => handleAliasChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setOpen(false);
                          }
                        }}
                        bg="rgba(255, 255, 255, 0.03)"
                        border="1px solid"
                        borderColor="rgba(255, 255, 255, 0.1)"
                        _hover={{ borderColor: 'rgba(255, 255, 255, 0.2)' }}
                        _focus={{ borderColor: 'rgba(99, 102, 241, 0.5)', boxShadow: 'none' }}
                      />
                    </Box>
                  )}
                  <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" px={2} py={1.5}>
                    Tables
                  </Text>
                  <VStack gap={0.5} align="stretch" maxH="250px" overflowY="auto" bg="gray.900">
                    {loading ? (
                      <HStack px={2} py={3} justify="center">
                        <Spinner size="sm" />
                        <Text fontSize="sm" color="fg.muted">
                          Loading...
                        </Text>
                      </HStack>
                    ) : (
                      tables.map((table) => {
                        const tableDisplayName = table.schema ? `${table.schema}.${table.name}` : table.name;
                        const isSelected = tableDisplayName === (value.schema ? `${value.schema}.${value.table}` : value.table);
                        return (
                          <Box
                            key={table.displayName}
                            px={2}
                            py={1.5}
                            borderRadius="md"
                            cursor="pointer"
                            bg={isSelected ? 'rgba(99, 102, 241, 0.15)' : 'transparent'}
                            _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                            onClick={() => handleSelect(table)}
                          >
                            <HStack gap={2}>
                              <Box color="fg.muted">
                                <LuTable size={14} />
                              </Box>
                              <Text fontSize="sm">{table.displayName}</Text>
                            </HStack>
                          </Box>
                        );
                      })
                    )}
                  </VStack>
                </Popover.Body>
              </Popover.Content>
            </Popover.Positioner>
          </Portal>
        </Popover.Root>
      </HStack>
    </Box>
  );
}
