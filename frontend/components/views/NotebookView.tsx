'use client';

/**
 * NotebookView — a vertical, ordered list of notebook cells (presentational).
 * Each cell is either an inline SQL question or a rich-text block. The view
 * takes the merged `content` + an `onChange` patch callback and owns cell
 * add / insert / remove / update as pure, immutable array transforms.
 *
 * Cells render in natural array order, keyed by their stable `id`. New cells
 * are inserted via Jupyter/Colab-style hover zones between cells (CellInsertZone);
 * inserting a sibling never reparents an existing cell's Monaco editor. All cell
 * mutations rebuild the full `cells` array and call `onChange({ cells })`
 * (content keys are shallow-merged by selectMergedContent + editFile).
 *
 * A JSON view (FileHeader's eye/code toggle) is wired like StoryView/dashboards:
 * read-only without a fileId, editable with one (full-content edits).
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Box, VStack, HStack, Button, Center, Text, Icon } from '@chakra-ui/react';
import { LuDatabase, LuFileText, LuNotebook } from 'react-icons/lu';
import NotebookSqlCell from './notebook/NotebookSqlCell';
import NotebookTextCell from './notebook/NotebookTextCell';
import CellInsertZone from './notebook/CellInsertZone';
import JsonEditor from '@/components/slides/JsonEditor';
import { useAppSelector } from '@/store/hooks';
import { selectPersistableContent } from '@/store/filesSlice';
import { applyJsonContentEdit } from '@/lib/api/file-state';
import type {
  NotebookContent, NotebookCell, NotebookSqlCell as SqlCell,
} from '@/lib/types';

interface NotebookViewProps {
  content: NotebookContent;
  onChange: (updates: Partial<NotebookContent>) => void;
  readOnly?: boolean;
  /** Notebook file path, for SQL-cell schema autocomplete / context lookup. */
  filePath?: string;
  fileId?: number;
  viewMode?: 'visual' | 'json';
  /** Id of the cell the user is currently working on (highlighted + sent to the agent). */
  activeCellId?: string;
  onActivateCell?: (cellId: string) => void;
}

const newId = (): string => crypto.randomUUID();

export default function NotebookView({
  content, onChange, readOnly = false, filePath, fileId, viewMode = 'visual', activeCellId, onActivateCell,
}: NotebookViewProps) {
  const cells = content.cells ?? [];

  // Latest cells via ref so the mutation callbacks stay referentially stable
  // (cells change on every commit; stable callbacks avoid churning cell props
  // and the per-cell debounced query handler).
  const cellsRef = useRef(cells);
  useEffect(() => { cellsRef.current = cells; }, [cells]);
  const commit = useCallback((next: NotebookCell[]) => onChange({ cells: next }), [onChange]);

  const updateCell = useCallback((id: string, partial: Partial<NotebookCell>) => {
    commit(cellsRef.current.map(c => (c.id === id ? ({ ...c, ...partial } as NotebookCell) : c)));
  }, [commit]);

  const removeCell = useCallback((id: string) => {
    commit(cellsRef.current.filter(c => c.id !== id));
  }, [commit]);

  // A new SQL cell defaults to the most recent SQL cell's connection.
  const makeCell = useCallback((type: 'sql' | 'text'): NotebookCell => {
    if (type === 'text') return { type: 'text', id: newId(), name: null, content: '' };
    const lastSql = [...cellsRef.current].reverse().find((c): c is SqlCell => c.type === 'sql');
    return {
      type: 'sql', id: newId(), name: null, query: '', vizSettings: { type: 'table' },
      parameters: [], parameterValues: {}, connection_name: lastSql?.connection_name ?? '', references: [],
    };
  }, []);

  // Insert a new cell at an absolute index (0..length).
  const insertAt = useCallback((index: number, type: 'sql' | 'text') => {
    const list = cellsRef.current;
    const at = Math.max(0, Math.min(index, list.length));
    commit([...list.slice(0, at), makeCell(type), ...list.slice(at)]);
  }, [commit, makeCell]);

  // JSON view edits the persistable content (content + persistableChanges).
  const persistableContent = useAppSelector(state =>
    fileId !== undefined ? selectPersistableContent(state, fileId) : undefined
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  if (viewMode === 'json') {
    return (
      <JsonEditor
        value={JSON.stringify(persistableContent ?? content, null, 2)}
        readOnly={fileId === undefined || readOnly}
        error={jsonError}
        onChange={(value) => {
          if (fileId === undefined) return;
          const result = applyJsonContentEdit({ fileId, jsonString: value });
          setJsonError(result.success ? null : result.error ?? null);
        }}
      />
    );
  }

  return (
    <Box flex={1} overflow="auto" p={4}>
      <VStack align="stretch" gap={0} maxW="900px" mx="auto" pl={{ base: 0, md: '40px' }}>
        {cells.length === 0 ? (
          <>
            <Center aria-label="Empty notebook" flexDirection="column" gap={3} py={16} color="fg.muted">
              <Icon as={LuNotebook} boxSize={10} opacity={0.5} />
              <Text fontSize="sm">This notebook is empty. Add a cell to get started.</Text>
            </Center>
            {!readOnly && (
              <HStack justify="center" gap={2}>
                <Button aria-label="Add SQL cell" size="sm" variant="outline" onClick={() => insertAt(0, 'sql')}>
                  <LuDatabase /> SQL cell
                </Button>
                <Button aria-label="Add text cell" size="sm" variant="outline" onClick={() => insertAt(0, 'text')}>
                  <LuFileText /> Text cell
                </Button>
              </HStack>
            )}
          </>
        ) : (
          <>
            <CellInsertZone onInsert={(t) => insertAt(0, t)} readOnly={readOnly} />
            {cells.map((cell, i) => {
              const active = cell.id === activeCellId;
              return (
                <Fragment key={cell.id}>
                  <Box position="relative">
                    {/* Jupyter-style cell number in the left gutter */}
                    <Text
                      aria-hidden
                      position="absolute"
                      left={{ base: '4px', md: '-34px' }}
                      top="10px"
                      width={{ base: 'auto', md: '28px' }}
                      textAlign="right"
                      fontFamily="mono"
                      fontSize="11px"
                      fontWeight="600"
                      color={active ? 'accent.teal' : 'fg.subtle'}
                      pointerEvents="none"
                    >
                      [{i + 1}]
                    </Text>
                    {cell.type === 'sql' ? (
                      <NotebookSqlCell
                        cell={cell}
                        active={active}
                        onActivate={onActivateCell}
                        readOnly={readOnly}
                        filePath={filePath}
                        onCellChange={updateCell}
                        onRemove={removeCell}
                      />
                    ) : (
                      <NotebookTextCell
                        cell={cell}
                        active={active}
                        onActivate={onActivateCell}
                        readOnly={readOnly}
                        filePath={filePath}
                        onCellChange={updateCell}
                        onRemove={removeCell}
                      />
                    )}
                  </Box>
                  <CellInsertZone onInsert={(t) => insertAt(i + 1, t)} readOnly={readOnly} />
                </Fragment>
              );
            })}
          </>
        )}
      </VStack>
    </Box>
  );
}
