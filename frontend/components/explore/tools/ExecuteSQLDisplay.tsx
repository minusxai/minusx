'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Box, HStack, Text, IconButton, Icon, GridItem } from '@chakra-ui/react';
import { LuChevronDown, LuChevronRight, LuDatabase, LuCheck, LuX } from 'react-icons/lu';
import { QuestionContent, QueryResult, DisplayProps } from '@/lib/types';
import QuestionViewV2 from '@/components/views/QuestionViewV2';


export const EXECUTE_SQL_MAX_COLS = 12;
const EXECUTE_SQL_COLLAPSED_COLS = 12; // Narrower when collapsed
const EXECUTE_SQL_COLLAPSED_COLS_COMPACT = 12; // Compact: 4 tools per row

export default function ExecuteSQLDisplay({ toolCallTuple, databaseName, isCompact, showThinking }: DisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false); // Collapsed by default
  const [isThinkingSQL, setIsThinkingSQL] = useState(true); // Collapsed by default
  const [toolCall, toolMessage] = toolCallTuple;
  const hasInitializedExpansion = useRef(false);

  // Local state for viz changes (read-only display, but allow viz type switching)
  const [localContent, setLocalContent] = useState<QuestionContent | null>(null);

  const parse_mb_data = (data: any) => {
    const columns = data.cols.map((d: any) => d.name) || [];
    const types = data.cols.map((d: any) => d.database_type) || [];
    const rows = data.rows || [];

    // Convert rows from list of lists to list of objects
    const rowObjects = rows.map((row: any[]) => {
      const obj: Record<string, any> = {};
      columns.forEach((col: string, index: number) => {
        obj[col] = row[index];
      });
      return obj;
    });

    return {
      columns,
      types,
      rows: rowObjects
    };
  }

  const parse_result_data = (data: any) => {
    return {
      columns: data.columns,
      types: data.types,
      rows: data.rows
    };
  }
  const args = toolCall.function.arguments;

  // Parse tool call once and memoize to prevent infinite loops
  const { question, queryResult, error } = useMemo(() => {
    let question: QuestionContent | null = null;
    let queryResult: QueryResult | null = null;
    let error: string | null = null;

    try {
      // Note: orchestrator always parses arguments to dict in JS land

      // Parse vizSettings if it's a string
      let vizSettings = { type: 'table' as const };
      if (args.vizSettings) {
        if (typeof args.vizSettings === 'string') {
          try {
            const parsed = JSON.parse(args.vizSettings);
            if (parsed.type) {
              vizSettings = parsed;
            }
          } catch {
            // If parsing fails, use default (already set above)
          }
        } else if (typeof args.vizSettings === 'object' && args.vizSettings.type) {
          vizSettings = args.vizSettings;
        }
      }

      // Parse parameters if it's a string
      let parameters: any[] = [];
      if (args.parameters) {
        if (typeof args.parameters === 'string') {
          try {
            const parsed = JSON.parse(args.parameters);
            if (Array.isArray(parsed)) {
              parameters = parsed;
            }
          } catch {
            // If parsing fails, use default empty array
          }
        } else if (Array.isArray(args.parameters)) {
          parameters = args.parameters;
        }
      }

      question = {
        query: args.query || '',
        vizSettings,
        parameters,
        database_name: databaseName || ''  // Empty string if no database provided
      };

      // Parse the result to get query data
      if (typeof toolMessage.content === 'string') {
        try {
          const parsed = JSON.parse(toolMessage.content);

          // Check for error response
          if (parsed.success === false || parsed.error) {
            error = parsed.error || 'Query failed';
          } else {
            queryResult = parse_result_data(parsed.data ? parsed.data : parsed);
          }
        } catch (e) {
          // Not JSON, might be error string
          if (toolMessage.content.toLowerCase().includes('error')) {
            error = toolMessage.content;
          }
        }
      } else if (toolMessage.content?.error) {
        error = toolMessage.content.error;
      } else if (toolMessage.content?.success === false) {
        error = toolMessage.content.error || 'Query failed';
      } else if (toolMessage.content) {
        // Content is already an object
        queryResult = parse_result_data(toolMessage.content.data)
      }
    } catch (e) {
      error = 'Failed to parse tool call arguments';
    }

    return { question, queryResult, error };
  }, [toolCall, toolMessage]);


  // Set initial expansion state only once when data is available
  useEffect(() => {
    if (!hasInitializedExpansion.current && queryResult && queryResult.columns && queryResult.columns.length > 0 && question?.vizSettings.type !== 'table') {
      setIsExpanded(true);
      setIsThinkingSQL(false);
      hasInitializedExpansion.current = true;
    }
  }, [queryResult, question]);

  // Initialize localContent when question changes
  useEffect(() => {
    if (question) {
      setLocalContent(question);
    }
  }, [question]);

  // Handler for content changes (viz type, etc.)
  const handleContentChange = (updates: Partial<QuestionContent>) => {
    setLocalContent(prev => {
      if (!prev) return null;

      // Deep merge for nested objects like vizSettings
      const merged = { ...prev };
      for (const [key, value] of Object.entries(updates)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && merged[key as keyof QuestionContent] && typeof merged[key as keyof QuestionContent] === 'object') {
          // Deep merge for nested objects
          merged[key as keyof QuestionContent] = { ...merged[key as keyof QuestionContent] as any, ...value };
        } else {
          merged[key as keyof QuestionContent] = value as any;
        }
      }
      return merged;
    });
  };




  return (
    (!isThinkingSQL || showThinking) && 
    <GridItem
        colSpan={isExpanded ? 12 : isCompact ? EXECUTE_SQL_COLLAPSED_COLS_COMPACT : EXECUTE_SQL_COLLAPSED_COLS}
        bg={isThinkingSQL ? "bg.elevated" : ""}
        borderRadius={isThinkingSQL ? "md" : ""}
        p={isThinkingSQL ? 2 : 0}
        my={2}
    >
      <Box
        border="1px solid"
        borderColor="border.default"
        borderRadius="md"
        bg="bg.surface"
        overflow="hidden"
    >
      {/* Header */}
      <HStack
        py={isExpanded ? 3 : 0}
        pr={isExpanded ? 3 : 2}
        cursor="pointer"
        onClick={() => setIsExpanded(!isExpanded)}
        _hover={{ bg: 'bg.muted' }}
        gap={2}
      >
        <IconButton
          aria-label="Toggle details"
          size="xs"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
        >
          {isExpanded ? <LuChevronDown /> : <LuChevronRight />}
        </IconButton>
        <Icon as={LuDatabase} boxSize={4} color="accent.primary" />
        <Text fontWeight="600" fontSize="sm" fontFamily="mono" truncate>
            Execute SQL
        </Text>
        {/* {question && isExpanded && (
            <Text fontSize="2xs" color="fg.muted" fontFamily="mono">
              DB Connection: {question.database_name}
            </Text>
          )} */}
          <Icon as={error ? LuX : LuCheck} boxSize={3} color={error ? "accent.danger" : "accent.success"} />
            {isExpanded && <Text
              fontSize="xs"
              fontFamily="mono"
              color={error ? "accent.danger" : "accent.success"}
              fontWeight="600"
            >
              {error ? 'Error' : 'Completed'}
            </Text>}

            {/* {isExpanded &&
            <Text fontSize="2xs" color="fg.muted" fontFamily="mono">
              {queryResult && queryResult.rows ? `${queryResult.rows.length} rows` : 'No data'}
            </Text>} */}
      </HStack>

      {/* Expandable Details */}
      {isExpanded && (
        <Box p={3} pt={2} bg="bg.canvas">
          {error ? (
            <Box
              p={3}
              bg="accent.danger/10"
              borderRadius="sm"
              fontFamily="mono"
              fontSize="xs"
              color="accent.danger"
              borderLeft="3px solid"
              borderColor="accent.danger"
            >
              {error}
            </Box>
          ) : localContent ? (
            <QuestionViewV2
              viewMode='toolcall'
              content={localContent}
              queryData={queryResult}
              queryLoading={false}
              queryError={error}
              queryStale={false}
              showVizControls={!isCompact}
              onChange={handleContentChange} // Allow viz type changes locally
              onExecute={() => {}} // No re-execution in explore
            />
          ) : (
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              Failed to load query
            </Text>
          )}
        </Box>
      )}
      </Box>
    </GridItem>
  );
}
