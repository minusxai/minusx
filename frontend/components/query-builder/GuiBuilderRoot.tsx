/**
 * GuiBuilderRoot — the single GUI tab's content, housing the tier gradation:
 *
 *   Semantic · Simple · Full
 *
 * One query editor, three zoom levels over the same underlying SQL/IR. A small
 * mode switcher (top-right) moves between them:
 *  - the DEFAULT mode is the highest tier the current query supports:
 *      semantic (models exist + persisted semanticQuery compiles to this SQL,
 *      or the SQL is empty) → simple (fits the Scuba subset) → full
 *  - switching DOWN is always allowed (each tier is a subset of the next)
 *  - switching UP is enabled only when the query fits that tier (greyed with
 *    a reason tooltip otherwise)
 *  - an explicit user choice is sticky for the life of the component; it only
 *    falls back when the chosen mode becomes unavailable
 *
 * Semantic mode only appears in the switcher when the active context defines
 * semantic models for the connection (`semanticModels` non-empty). Callers
 * that don't support semantic persistence (notebook cells, eval editor) simply
 * omit the semantic props and get Simple · Full.
 */

'use client';

import React, { useState, useMemo } from 'react';
import { Box, HStack, Text } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import { compileSemanticQuery } from '@/lib/semantic/compile';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import type { SemanticModel } from '@/lib/types';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';
import type { QuestionOption } from '@/lib/hooks/useAvailableQuestions';
import { QueryBuilderRoot } from './QueryBuilderRoot';
import { SimpleQueryBuilder } from './SimpleQueryBuilder';
import { SemanticQueryBuilder } from './SemanticQueryBuilder';

export type GuiMode = 'semantic' | 'simple' | 'full';

interface GuiBuilderRootProps {
  databaseName: string;
  dialect: string;
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute?: () => void;
  isExecuting?: boolean;
  availableQuestions?: QuestionOption[];
  whitelistedSchema?: Array<{ schema: string; tables: Array<{ table: string; columns: Array<{ name: string; type: string }> }> }>;
  /** From useGuiCompat — whether the SQL fits the Simple tier (+ reason). */
  canUseSimple: boolean;
  simpleError?: string | null;
  /** Semantic tier (optional): models for this connection; omit to hide the mode. */
  semanticModels?: SemanticModel[];
  /** Persisted semantic spec (content.semanticQuery). */
  semanticQuery?: SemanticQuerySpec | null;
  /** Persist an edited semantic spec together with its compiled SQL. */
  onSemanticChange?: (spec: SemanticQuerySpec, sql: string) => void;
}

/** Does the persisted semantic spec compile to exactly the current SQL? */
function semanticMatchesSql(
  spec: SemanticQuerySpec | null | undefined,
  models: SemanticModel[],
  sql: string,
  dialect: string,
): boolean {
  if (!spec) return false;
  const model = models.find((m) => m.name === spec.model);
  if (!model) return false;
  try {
    return irToSqlLocal(compileSemanticQuery(spec, model), dialect).trim() === sql.trim();
  } catch {
    return false;
  }
}

export function GuiBuilderRoot({
  databaseName,
  dialect,
  sql,
  onSqlChange,
  onExecute,
  isExecuting = false,
  availableQuestions = [],
  whitelistedSchema,
  canUseSimple,
  simpleError,
  semanticModels = [],
  semanticQuery,
  onSemanticChange,
}: GuiBuilderRootProps) {
  const semanticSupported = semanticModels.length > 0 && !!onSemanticChange;
  const emptySql = !sql.trim();

  // Semantic is enterable when supported AND the query is semantic-owned
  // (compiles from the persisted spec) or there's nothing to clobber yet.
  const semanticMatches = useMemo(
    () => semanticSupported && (emptySql || semanticMatchesSql(semanticQuery, semanticModels, sql, dialect)),
    [semanticSupported, emptySql, semanticQuery, semanticModels, sql, dialect],
  );

  const defaultMode: GuiMode = semanticMatches && semanticQuery ? 'semantic' : canUseSimple ? 'simple' : 'full';

  // null = no explicit choice yet → follow defaultMode as the query changes.
  const [chosenMode, setChosenMode] = useState<GuiMode | null>(null);

  const availability: Record<GuiMode, { available: boolean; reason?: string }> = {
    semantic: semanticSupported
      ? semanticMatches
        ? { available: true }
        : { available: false, reason: 'This SQL was not built in Semantic mode' }
      : { available: false, reason: 'No semantic models defined for this connection' },
    simple: canUseSimple
      ? { available: true }
      : { available: false, reason: simpleError || 'This query is too complex for Simple mode' },
    full: { available: true },
  };

  const effectiveMode: GuiMode =
    chosenMode && availability[chosenMode].available ? chosenMode : defaultMode;

  const modes: GuiMode[] = semanticSupported ? ['semantic', 'simple', 'full'] : ['simple', 'full'];

  return (
    <Box>
      <HStack justify="flex-end" px={4} pt={3}>
        <HStack gap={0} bg="bg.muted" borderRadius="md" p="2px">
          {modes.map((mode) => {
            const isActive = effectiveMode === mode;
            const { available, reason } = availability[mode];
            const label = mode.charAt(0).toUpperCase() + mode.slice(1);
            return (
              <Tooltip
                key={mode}
                content={reason}
                disabled={available}
                showArrow
                positioning={{ placement: 'top' }}
                openDelay={200}
              >
                <Box
                  as="button"
                  aria-label={`${label} mode`}
                  aria-disabled={!available}
                  aria-pressed={isActive}
                  px={2.5}
                  py={0.5}
                  borderRadius="sm"
                  bg={isActive ? 'accent.teal/90' : 'transparent'}
                  color={isActive ? 'white' : 'fg.subtle'}
                  cursor={available ? 'pointer' : 'not-allowed'}
                  opacity={available ? 1 : 0.5}
                  transition="all 0.15s ease"
                  _hover={{ color: available ? (isActive ? 'white' : 'fg.muted') : undefined }}
                  onClick={() => available && setChosenMode(mode)}
                >
                  <Text fontSize="11px" fontFamily="mono" fontWeight="600">{label}</Text>
                </Box>
              </Tooltip>
            );
          })}
        </HStack>
      </HStack>

      {effectiveMode === 'semantic' && semanticSupported && (
        <SemanticQueryBuilder
          models={semanticModels}
          dialect={dialect}
          value={semanticQuery}
          onChange={onSemanticChange!}
          onExecute={onExecute}
          isExecuting={isExecuting}
        />
      )}

      {effectiveMode === 'simple' && (
        <SimpleQueryBuilder
          databaseName={databaseName}
          dialect={dialect}
          sql={sql}
          onSqlChange={onSqlChange}
          onExecute={onExecute}
          isExecuting={isExecuting}
          availableQuestions={availableQuestions}
          whitelistedSchema={whitelistedSchema}
        />
      )}

      {effectiveMode === 'full' && (
        <QueryBuilderRoot
          databaseName={databaseName}
          dialect={dialect}
          sql={sql}
          onSqlChange={onSqlChange}
          onExecute={onExecute}
          isExecuting={isExecuting}
          availableQuestions={availableQuestions}
          whitelistedSchema={whitelistedSchema}
        />
      )}
    </Box>
  );
}
