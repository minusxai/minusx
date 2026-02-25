'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, VStack, HStack, Text, Icon, Spinner } from '@chakra-ui/react';
import { LuChartBar, LuChevronRight, LuChevronDown, LuColumns3 } from 'react-icons/lu';
import { FilesAPI } from '@/lib/data/files';
import { QuestionContent } from '@/lib/types';
import { extractReferencesFromSQL } from '@/lib/sql/sql-references';

interface InferredColumn {
  name: string;
  type: string;
}

interface QuestionItem {
  id: number;
  name: string;
  alias: string;
  query: string;
}

/**
 * Sidebar section that lists referenceable questions (leaf questions — no @refs
 * in their own SQL) and allows lazy-loading inferred output columns.
 * Clicking a question inserts `@alias` at the editor cursor.
 * Clicking a column inserts `alias.column_name` at the editor cursor.
 */
export default function QuestionSchemaSection() {
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [columnsByQuestionId, setColumnsByQuestionId] = useState<Record<number, InferredColumn[] | 'loading' | 'error'>>({});

  // Load all leaf questions (questions whose SQL has no @references)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data: files } = await FilesAPI.getFiles({ type: 'question', depth: 999 });

        // Load question content to check for @references
        const ids = files.map((f: any) => f.id);
        if (ids.length === 0) {
          if (!cancelled) {
            setQuestions([]);
            setLoading(false);
          }
          return;
        }

        // Batch load to get query content
        const res = await fetch('/api/files/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        const json = await res.json();
        const filesMap: Record<number, any> = {};
        (json.data || []).forEach((f: any) => { filesMap[f.id] = f; });

        const leafQuestions: QuestionItem[] = [];
        files.forEach((f: any) => {
          const full = filesMap[f.id];
          const content = full?.content as QuestionContent | undefined;
          const query = content?.query || '';
          // Only include questions with no @references (leaf questions)
          const refs = extractReferencesFromSQL(query);
          if (refs.length === 0 && query.trim()) {
            const alias = f.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + f.id;
            leafQuestions.push({ id: f.id, name: f.name, alias, query });
          }
        });

        if (!cancelled) {
          setQuestions(leafQuestions.sort((a, b) => a.name.localeCompare(b.name)));
          setLoading(false);
        }
      } catch (err) {
        console.error('[QuestionSchemaSection] Failed to load questions:', err);
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const toggleExpand = useCallback(async (q: QuestionItem) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(q.id)) {
        next.delete(q.id);
        return next;
      }
      next.add(q.id);
      return next;
    });

    // Lazy-load columns if not yet fetched
    if (!columnsByQuestionId[q.id]) {
      setColumnsByQuestionId(prev => ({ ...prev, [q.id]: 'loading' }));
      try {
        const res = await fetch('/api/infer-columns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: q.id }),
        });
        if (res.ok) {
          const data = await res.json();
          setColumnsByQuestionId(prev => ({ ...prev, [q.id]: data.columns || [] }));
        } else {
          setColumnsByQuestionId(prev => ({ ...prev, [q.id]: 'error' }));
        }
      } catch {
        setColumnsByQuestionId(prev => ({ ...prev, [q.id]: 'error' }));
      }
    }
  }, [columnsByQuestionId]);

  const insertAtCursor = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent('atlas:editor-insert', { detail: { text } }));
  }, []);

  if (loading) {
    return (
      <Box p={4} textAlign="center">
        <Spinner size="sm" color="accent.success" />
      </Box>
    );
  }

  if (questions.length === 0) {
    return (
      <Box p={4}>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">
          No referenceable questions found
        </Text>
      </Box>
    );
  }

  return (
    <VStack gap={0} align="stretch">
      {questions.map(q => {
        const isExpanded = expandedIds.has(q.id);
        const cols = columnsByQuestionId[q.id];

        return (
          <Box key={q.id} borderBottom="1px solid" borderColor="border.subtle">
            {/* Question row */}
            <HStack
              px={3}
              py={2}
              gap={1}
              cursor="pointer"
              _hover={{ bg: 'bg.muted' }}
              transition="background 0.15s"
            >
              {/* Expand/collapse toggle */}
              <Icon
                as={isExpanded ? LuChevronDown : LuChevronRight}
                boxSize={3}
                color="fg.muted"
                flexShrink={0}
                onClick={() => toggleExpand(q)}
                cursor="pointer"
              />
              <Icon as={LuChartBar} boxSize={3} color="accent.success" flexShrink={0} />
              {/* Question name — inserts @alias at cursor */}
              <Text
                fontSize="xs"
                fontFamily="mono"
                color="fg.default"
                fontWeight="500"
                flex="1"
                truncate
                title={`Insert @${q.alias}`}
                onClick={() => insertAtCursor(`@${q.alias}`)}
                _hover={{ color: 'accent.success' }}
                transition="color 0.15s"
              >
                {q.name}
              </Text>
              <Text
                fontSize="10px"
                fontFamily="mono"
                color="fg.subtle"
                flexShrink={0}
                title="Click to expand columns"
                onClick={() => toggleExpand(q)}
              >
                #{q.id}
              </Text>
            </HStack>

            {/* Columns — lazy loaded on expand */}
            {isExpanded && (
              <Box pl={6} pb={1}>
                {cols === 'loading' && (
                  <Box py={1}>
                    <Spinner size="xs" color="fg.muted" />
                  </Box>
                )}
                {cols === 'error' && (
                  <Text fontSize="xs" color="fg.subtle" fontFamily="mono" py={1}>
                    Could not infer columns
                  </Text>
                )}
                {Array.isArray(cols) && cols.length === 0 && (
                  <Text fontSize="xs" color="fg.subtle" fontFamily="mono" py={1}>
                    No columns inferred
                  </Text>
                )}
                {Array.isArray(cols) && cols.map(col => (
                  <HStack
                    key={col.name}
                    px={2}
                    py={1}
                    gap={2}
                    cursor="pointer"
                    _hover={{ bg: 'bg.muted' }}
                    borderRadius="sm"
                    onClick={() => insertAtCursor(`${q.alias}.${col.name}`)}
                    title={`Insert ${q.alias}.${col.name}`}
                  >
                    <Icon as={LuColumns3} boxSize={3} color="fg.subtle" flexShrink={0} />
                    <Text fontSize="xs" fontFamily="mono" color="fg.default" flex="1" truncate>
                      {col.name}
                    </Text>
                    <Text fontSize="10px" fontFamily="mono" color="fg.subtle" flexShrink={0}>
                      {col.type}
                    </Text>
                  </HStack>
                ))}
              </Box>
            )}
          </Box>
        );
      })}
    </VStack>
  );
}
