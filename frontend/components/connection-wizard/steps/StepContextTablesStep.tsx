'use client';

import { Box, VStack, HStack, Text, Heading, Button } from '@chakra-ui/react';
import SchemaTreeView, { type WhitelistItem, type SchemaTreeItem } from '@/components/schema-browser/SchemaTreeView';
import { cursorBlinkKeyframes } from '@/lib/ui/animations';

interface StepContextTablesStepProps {
  greeting?: string;
  displayedText: string;
  typingDone: boolean;
  totalTables: number;
  schemas: SchemaTreeItem[];
  whitelistedCount: number;
  effectiveWhitelist: WhitelistItem[];
  onWhitelistChange: (newWhitelist: WhitelistItem[]) => void;
  connectionName: string;
  onNext: () => void;
}

/** Sub-step 1: Select Tables */
export default function StepContextTablesStep({
  greeting, displayedText, typingDone, totalTables, schemas, whitelistedCount,
  effectiveWhitelist, onWhitelistChange, connectionName, onNext,
}: StepContextTablesStepProps) {
  return (
    <VStack gap={6} align="stretch" minH="400px">
      {greeting && <style>{cursorBlinkKeyframes}</style>}

      {/* Header */}
      <Box>
        {greeting ? (
          <Heading
            fontSize={{ base: 'xl', md: '2xl' }}
            fontFamily="mono"
            fontWeight="400"
            mb={1}
            letterSpacing="-0.02em"
          >
            {displayedText}
            {!typingDone && (
              <Box
                as="span"
                display="inline-block"
                w="2px"
                h="1em"
                bg="accent.teal"
                ml="2px"
                verticalAlign="text-bottom"
                css={{ animation: 'cursorBlink 0.8s step-end infinite' }}
              />
            )}
          </Heading>
        ) : (
          <Heading size="md" fontFamily="mono" fontWeight="500" mb={1}>
            Select tables
          </Heading>
        )}
        <Text color="fg.muted" fontSize="sm">
          {totalTables > 0
            ? <>We&apos;ve auto-selected {totalTables === 1 ? '' : 'all '}<Text as="span" color="accent.teal" fontWeight="600">{totalTables} {totalTables === 1 ? 'table' : 'tables'}</Text>. Deselect anything you don&apos;t need (you can always edit this later).</>
            : 'No tables found for this connection.'
          }
        </Text>
      </Box>

      {/* Tables */}
      {schemas.length > 0 && (
        <Box
          border="1px solid"
          borderColor="border.default"
          borderRadius="lg"
          p={4}
          maxH="400px"
          overflowY="auto"
        >
          <HStack gap={2} mb={3}>
            <Text fontSize="sm" fontWeight="600">Tables</Text>
            <Text fontSize="xs" fontFamily="mono" color="fg.subtle">
              {whitelistedCount}/{totalTables} selected
            </Text>
          </HStack>
          <SchemaTreeView
            schemas={schemas}
            selectable
            whitelist={effectiveWhitelist}
            onWhitelistChange={onWhitelistChange}
            showColumns={true}
            connectionName={connectionName}
            defaultExpandedSchemas
          />
        </Box>
      )}

      {schemas.length === 0 && (
        <Box p={4} bg="bg.muted" borderRadius="lg">
          <Text color="fg.muted" fontSize="sm">
            No schema found for this connection. You can still add context in the next step.
          </Text>
        </Box>
      )}

      {/* Spacer pushes button to bottom */}
      <Box flex={1} />

      {/* Actions */}
      <HStack justify="flex-end" gap={3}>
        <Button
          aria-label="Continue to documentation"
          variant="outline"
          size="sm"
          fontFamily="mono"
          onClick={onNext}
        >
          Next &rarr;
        </Button>
      </HStack>
    </VStack>
  );
}
