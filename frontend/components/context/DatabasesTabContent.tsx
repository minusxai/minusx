'use client';

/**
 * DatabasesTabContent - the "Databases" tab body of ContextEditorV2: the
 * connection/schema whitelist picker (visual tree or raw YAML editor) plus
 * the whitelisted-item stats footer.
 * Extracted from ContextEditorV2 — pure structural move, no behavior change.
 *
 * NOTE: `expandedDatabases`/`toggleDatabase` are owned by the parent (not
 * this component) because this tab unmounts/remounts whenever the page is
 * toggled between the visual picker and the whole-file JSON/XML code view —
 * keeping that expand/collapse state in the parent means it survives the
 * toggle, matching pre-extraction behavior.
 */

import { Box, VStack, HStack, Button, Text, Icon, Collapsible, Tabs } from '@chakra-ui/react';
import { LuCircleAlert, LuCircleCheck, LuGlobe, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import type { ContextContent } from '@/lib/types';
import type { DatabaseWithSchema } from '@/lib/types';
import { countResolvedWhitelist } from '@/lib/context/context-utils';
import SchemaTreeView, { type WhitelistItem } from '../schema-browser/SchemaTreeView';
import { Checkbox } from '@/components/ui/checkbox';
import Editor from '@monaco-editor/react';

const MONACO_READ_ONLY_MESSAGE = { value: 'Switch to edit mode to make changes.' };

export type DatabaseSelection = {
  databaseName: string;
  whitelist: WhitelistItem[];
};

interface DatabasesTabContentProps {
  isActive: boolean;
  activeTab: 'picker' | 'yaml';
  colorMode: string;
  editMode: boolean;
  isLoading: boolean;
  availableDatabases: DatabaseWithSchema[];
  content: ContextContent;
  onChange: (updates: Partial<ContextContent>) => void;
  availableChildPaths: string[];
  expandedDatabases: Set<string>;
  toggleDatabase: (name: string) => void;
  yamlText: string;
  onYamlChange: (newYaml: string) => void;
}

export function DatabasesTabContent({
  isActive,
  activeTab,
  colorMode,
  editMode,
  isLoading,
  availableDatabases,
  content,
  onChange,
  availableChildPaths,
  expandedDatabases,
  toggleDatabase,
  yamlText,
  onYamlChange,
}: DatabasesTabContentProps) {
  // Handle whitelist change - pure controlled
  const handleWhitelistChange = (databaseName: string, newWhitelist: WhitelistItem[]) => {
    // When databases === '*', synthesize a full whitelist for all connections as the starting point
    // so that modifying one connection doesn't implicitly exclude all others.
    const databases: DatabaseSelection[] = content.databases === '*'
      ? availableDatabases.map(db => ({
          databaseName: db.databaseName,
          whitelist: db.schemas.map(s => ({ type: 'schema' as const, name: s.schema })),
        }))
      : (content.databases || []);
    const dbIndex = databases.findIndex((db: DatabaseSelection) => db.databaseName === databaseName);

    if (dbIndex >= 0) {
      // Update existing database
      const newDatabases = [...databases];
      newDatabases[dbIndex] = { ...newDatabases[dbIndex], whitelist: newWhitelist };
      onChange({ databases: newDatabases });
    } else {
      // Add new database if it doesn't exist yet
      onChange({
        databases: [...databases, { databaseName, whitelist: newWhitelist }]
      });
    }
  };

  // Count whitelisted items, resolved against the live schema so deleted
  // datasets don't inflate the count. The agent sees `fullSchema`, so we count
  // against that ('*' = everything currently available).
  const resolvedCounts = content.databases === '*'
    ? {
        databases: availableDatabases.length,
        items: availableDatabases.reduce((sum: number, db) => sum + db.schemas.reduce((s: number, sc) => s + sc.tables.length, 0), 0),
      }
    : countResolvedWhitelist(content.databases || [], content.fullSchema || []);
  const totalWhitelisted = resolvedCounts.items;

  return (
    <Tabs.Content value="databases">
      {/* Only mount the heavy schema tree when this tab is active — Chakra keeps
          all panels mounted, so without this gate SchemaTreeView re-renders on
          every keystroke while editing docs (visible typing lag). */}
      {isActive && (<>
      {activeTab === 'picker' ? (
        <VStack gap={6} align="stretch">
          {/* Database Sections */}
          <Box>
            {!isLoading && availableDatabases.length > 0 && (
              <HStack justify="space-between" mb={2}>
                <HStack
                  gap={1.5}
                  px={2.5}
                  py={1}
                  bg={content.databases === '*' ? 'accent.teal/10' : 'bg.muted'}
                  borderRadius="full"
                >
                  <Icon as={LuGlobe} boxSize={3} color={content.databases === '*' ? 'accent.teal' : 'fg.muted'} />
                  <Text fontSize="xs" fontWeight="600" fontFamily="mono" color={content.databases === '*' ? 'accent.teal' : 'fg.muted'}>
                    {content.databases === '*' ? 'All databases selected — includes future connections' : 'Custom selection'}
                  </Text>
                </HStack>
                {content.databases === '*' ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      const explicitDbs: DatabaseSelection[] = availableDatabases.map(db => ({
                        databaseName: db.databaseName,
                        whitelist: db.schemas.map(s => ({ type: 'schema' as const, name: s.schema })),
                      }));
                      onChange({ databases: explicitDbs });
                    }}
                    fontFamily="mono"
                  >
                    Edit selection
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onChange({ databases: '*' })}
                    fontFamily="mono"
                  >
                    Wildcard — select all
                  </Button>
                )}
              </HStack>
            )}
            {!isLoading && availableDatabases.length > 0 && totalWhitelisted === 0 && (
              <Box
                p={3}
                mb={3}
                bg="accent.warning/10"
                borderLeft="3px solid"
                borderColor="accent.warning"
                borderRadius="md"
              >
                <HStack gap={2}>
                  <LuCircleAlert color="var(--chakra-colors-accent-warning)" />
                  <Text color="accent.warning" fontSize="sm">
                    No schemas or tables whitelisted. Select at least one below.
                  </Text>
                </HStack>
              </Box>
            )}
            {isLoading ? (
              <Box p={8} textAlign="center">
                <Text color="fg.muted">Loading context...</Text>
              </Box>
            ) : availableDatabases.length === 0 ? (
              <Box p={8} textAlign="center">
                <Text color="fg.muted">No schemas available from parent context</Text>
              </Box>
            ) : (
              <VStack gap={4} align="stretch">
                {availableDatabases.map((database) => {
                  const isConnectionWildcard = content.databases === '*';
                  // When databases === '*', pass empty whitelist and let connectionWhitelisted prop handle visuals
                  const whitelist: WhitelistItem[] = isConnectionWildcard
                    ? []
                    : ((content.databases || []) as DatabaseSelection[]).find(
                        (db: DatabaseSelection) => db.databaseName === database.databaseName
                      )?.whitelist || [];

                  const isExpanded = expandedDatabases.has(database.databaseName);
                  const whitelistedSchemas = whitelist.filter(w => w.type === 'schema');
                  const whitelistedTables = whitelist.filter(w => w.type === 'table');
                  const totalTables = database.schemas.reduce((sum, s) => sum + s.tables.length, 0);
                  const tablesFromSchemas = database.schemas
                    .filter(s => whitelistedSchemas.some(ws => ws.name === s.schema))
                    .reduce((sum, s) => sum + s.tables.length, 0);
                  // When wildcarded, all tables are effectively included
                  const effectiveTableCount = isConnectionWildcard ? totalTables : tablesFromSchemas + whitelistedTables.length;
                  const hasAny = effectiveTableCount > 0;

                  // Connection-level checkbox state
                  const connectionCheckboxState: { checked: boolean; indeterminate: boolean } = (() => {
                    if (isConnectionWildcard) return { checked: true, indeterminate: false };
                    if (whitelist.length === 0) return { checked: false, indeterminate: false };
                    const isFullyCovered = database.schemas.every(s =>
                      whitelistedSchemas.some(ws => ws.name === s.schema) ||
                      s.tables.every(t => whitelistedTables.some(wt => wt.name === t.table && wt.schema === s.schema))
                    );
                    if (isFullyCovered) return { checked: true, indeterminate: false };
                    return { checked: false, indeterminate: true };
                  })();

                  return (
                    <Box
                      key={database.databaseName}
                      border="1px solid"
                      borderColor="border.default"
                      borderRadius="md"
                      overflow="hidden"
                      bg="bg.surface"
                    >
                      <Collapsible.Root open={isExpanded} onOpenChange={() => toggleDatabase(database.databaseName)}>
                        <Collapsible.Trigger asChild>
                          <Box
                            px={4}
                            py={3}
                            bg="bg.muted"
                            cursor="pointer"
                            _hover={{ bg: 'bg.emphasized' }}
                            {...(isExpanded ? { borderBottom: '1px solid', borderColor: 'border.default' } : {})}
                          >
                            <HStack gap={2}>
                              <Box
                                position="relative"
                                onClick={(e: React.MouseEvent) => { e.stopPropagation(); }}
                              >
                                <Checkbox
                                  checked={connectionCheckboxState.checked}
                                  onCheckedChange={() => {
                                    if (connectionCheckboxState.checked || connectionCheckboxState.indeterminate) {
                                      handleWhitelistChange(database.databaseName, []);
                                    } else {
                                      handleWhitelistChange(database.databaseName, database.schemas.map(s => ({ type: 'schema' as const, name: s.schema })));
                                    }
                                  }}
                                />
                                {connectionCheckboxState.indeterminate && (
                                  <Box
                                    position="absolute"
                                    top="50%"
                                    left="50%"
                                    transform="translate(-50%, -50%)"
                                    width="8px"
                                    height="2px"
                                    bg="accent.teal"
                                    borderRadius="sm"
                                    pointerEvents="none"
                                  />
                                )}
                              </Box>
                              <Icon
                                as={isExpanded ? LuChevronDown : LuChevronRight}
                                boxSize={4}
                                color="fg.muted"
                              />
                              <Text
                                fontSize="md"
                                fontWeight="700"
                                color="fg.default"
                                fontFamily="mono"
                              >
                                {database.databaseName}
                              </Text>
                              {isConnectionWildcard && (
                                <Box
                                  px={2}
                                  py={0.5}
                                  bg="accent.teal/15"
                                  borderRadius="sm"
                                  border="1px solid"
                                  borderColor="accent.teal/30"
                                >
                                  <Text fontSize="2xs" fontWeight="700" color="accent.teal" fontFamily="mono">
                                    all schemas
                                  </Text>
                                </Box>
                              )}
                              <Box
                                px={2}
                                py={0.5}
                                bg={hasAny ? 'accent.cyan/15' : 'bg.canvas'}
                                borderRadius="sm"
                                border="1px solid"
                                borderColor={hasAny ? 'accent.cyan/30' : 'border.muted'}
                              >
                                <Text
                                  fontSize="2xs"
                                  fontWeight="700"
                                  color={hasAny ? 'accent.cyan' : 'fg.subtle'}
                                  fontFamily="mono"
                                >
                                  {effectiveTableCount}/{totalTables} {totalTables === 1 ? 'table' : 'tables'}
                                </Text>
                              </Box>
                            </HStack>
                          </Box>
                        </Collapsible.Trigger>
                        <Collapsible.Content>
                          <Box p={4}>
                            <SchemaTreeView
                              schemas={database.schemas}
                              selectable={true}
                              whitelist={whitelist}
                              onWhitelistChange={(newWhitelist) =>
                                handleWhitelistChange(database.databaseName, newWhitelist)
                              }
                              showColumns={true}
                              showStats={true}
                              showPathFilter={true}
                              availableChildPaths={availableChildPaths}
                              connectionWhitelisted={isConnectionWildcard}
                              connectionName={database.databaseName}
                              annotations={content.annotations || []}
                              onAnnotationsChange={editMode ? (next) => onChange({ annotations: next }) : undefined}
                              inheritedAnnotations={content.fullAnnotations}
                              metrics={content.metrics || []}
                              onMetricsChange={editMode ? (next) => onChange({ metrics: next }) : undefined}
                              inheritedMetrics={content.fullMetrics}
                              relationships={content.relationships || []}
                              onRelationshipsChange={editMode ? (next) => onChange({ relationships: next }) : undefined}
                              inheritedRelationships={content.fullRelationships}
                            />
                          </Box>
                        </Collapsible.Content>
                      </Collapsible.Root>
                    </Box>
                  );
                })}
              </VStack>
            )}
          </Box>

        </VStack>
      ) : (
        <Box
          border="1px solid"
          borderColor="border.default"
          borderRadius="md"
          overflow="hidden"
          minH="600px"
        >
          <Editor
            height="600px"
            language="yaml"
            value={yamlText}
            onChange={(value) => onYamlChange(value || '')}
            theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
            options={{
              readOnly: !editMode,
              readOnlyMessage: MONACO_READ_ONLY_MESSAGE,
              minimap: { enabled: false },
              wordWrap: 'on',
              lineNumbers: 'on',
              fontSize: 14,
              fontFamily: 'var(--font-jetbrains-mono)',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
            }}
          />
        </Box>
      )}
      {/* Stats Footer */}
      {!isLoading && totalWhitelisted > 0 && (
        <Box
          p={3}
          bg="bg.surface"
          borderRadius="md"
          border="1px solid"
          borderColor="border.default"
        >
          <HStack gap={2} fontSize="sm" color="fg.muted">
            <LuCircleCheck color="var(--chakra-colors-accent-success)" />
            <Text>
              <strong>{resolvedCounts.databases}</strong> databases configured with{' '}
              <strong>{totalWhitelisted}</strong> total whitelisted items
            </Text>
          </HStack>
        </Box>
      )}
      </>)}
    </Tabs.Content>
  );
}
