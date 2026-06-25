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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, VStack, HStack, Button, Center, Text, Icon } from '@chakra-ui/react';
import { LuDatabase, LuFileText, LuNotebook, LuPlay, LuChevronsDownUp, LuChevronsUpDown, LuPresentation, LuX } from 'react-icons/lu';
import NotebookSqlCell, { type Executed } from './notebook/NotebookSqlCell';
import NotebookTextCell from './notebook/NotebookTextCell';
import CellInsertZone from './notebook/CellInsertZone';
import { useFileToolbarActions, type FileToolbarAction } from '@/components/file-toolbar/FileToolbarContext';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectNotebookCellExecuted, setNotebookCellExecuted } from '@/store/filesSlice';
import { captureNotebookCellResult, removeNotebookCellResult } from '@/lib/api/file-state';
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
  /** Id of the cell the user is currently working on (highlighted + sent to the agent). */
  activeCellId?: string;
  onActivateCell?: (cellId: string) => void;
}

const newId = (): string => crypto.randomUUID();

// Stable empty map so an absent cellExecuted doesn't churn cell props each render.
const EMPTY_EXECUTED: Record<string, Executed> = {};

export default function NotebookView({
  content, onChange, readOnly = false, filePath, fileId, activeCellId, onActivateCell,
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
    // Drop the deleted cell's cached result so it doesn't linger in content.
    if (fileId !== undefined && !readOnly) removeNotebookCellResult(fileId, id);
  }, [commit, fileId, readOnly]);

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


  // Per-cell collapse + a run-all nonce, driven by header toolbar actions.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [runNonce, setRunNonce] = useState(0);
  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const runAll = useCallback(() => setRunNonce(n => n + 1), []);
  const collapseAll = useCallback(() => setCollapsedIds(new Set(cellsRef.current.map(c => c.id))), []);
  const expandAll = useCallback(() => setCollapsedIds(new Set()), []);

  // What each SQL cell last ran. Held in Redux ephemeral state (keyed by cell id)
  // when the notebook is a real file — so the agent's EditFile can drive a cell's
  // result, and so results survive the edit↔present remount (a separate subtree).
  // Without a fileId (e.g. unit tests / draft preview) we fall back to local state.
  const dispatch = useAppDispatch();
  const reduxExecuted = useAppSelector(state =>
    fileId !== undefined ? selectNotebookCellExecuted(state, fileId) : undefined
  );
  const [localExecuted, setLocalExecuted] = useState<Record<string, Executed>>({});
  const executedById = (fileId !== undefined ? reduxExecuted : localExecuted) ?? EMPTY_EXECUTED;
  const setCellExecuted = useCallback((id: string, e: Executed) => {
    if (fileId !== undefined) {
      dispatch(setNotebookCellExecuted({ fileId, cellId: id, executed: e }));
    } else {
      setLocalExecuted(prev => ({ ...prev, [id]: e }));
    }
  }, [dispatch, fileId]);

  // Cache a cell's freshly-run result into the notebook content so it survives a
  // reload (real, editable notebooks only — drafts/read-only don't persist).
  const persistCellResult = useCallback((cellId: string, executed: Executed, data: unknown) => {
    if (fileId === undefined || readOnly) return;
    captureNotebookCellResult(fileId, cellId, executed, data as Parameters<typeof captureNotebookCellResult>[3]);
  }, [fileId, readOnly]);

  // Present (reading) mode — view-local; the header just renders the toggle we
  // publish below, so present isn't special-cased anywhere outside this view.
  const [present, setPresent] = useState(false);
  const togglePresent = useCallback(() => setPresent(p => !p), []);

  // Publish notebook actions into the document header toolbar (one list). The
  // Present toggle is always available; editing actions hide while presenting.
  const toolbarActions = useMemo<FileToolbarAction[]>(() => {
    if (cells.length === 0) return [];
    const presentAction: FileToolbarAction = present
      ? { id: 'present', ariaLabel: 'Exit present mode', icon: <LuX />, onClick: togglePresent, active: true }
      : { id: 'present', ariaLabel: 'Present', icon: <LuPresentation />, onClick: togglePresent };
    if (present || readOnly) return [presentAction];
    return [
      { id: 'run-all', ariaLabel: 'Run all cells', icon: <LuPlay />, onClick: runAll },
      { id: 'collapse-all', ariaLabel: 'Collapse all cells', icon: <LuChevronsDownUp />, onClick: collapseAll },
      { id: 'expand-all', ariaLabel: 'Expand all cells', icon: <LuChevronsUpDown />, onClick: expandAll },
      presentAction,
    ];
  }, [present, readOnly, cells.length, runAll, collapseAll, expandAll, togglePresent]);
  useFileToolbarActions(toolbarActions);

  if (present) {
    return (
      // No own scroll container — the shared FileLayout column owns page scroll,
      // so the horizontal gutters scroll too (a nested scroller leaves them dead).
      <Box p={{ base: 4, md: 8 }}>
        <Box maxW="860px" mx="auto">
          {cells.length === 0 ? (
            <Center color="fg.muted" py={16}><Text fontSize="sm">Nothing to present yet.</Text></Center>
          ) : (
            <VStack align="stretch" gap={8}>
              {cells.map(cell => cell.type === 'sql' ? (
                <NotebookSqlCell
                  key={cell.id}
                  cell={cell}
                  presentMode
                  readOnly
                  filePath={filePath}
                  executed={executedById[cell.id] ?? null}
                  onExecutedChange={(e) => setCellExecuted(cell.id, e)}
                  onCellChange={updateCell}
                  onRemove={removeCell}
                />
              ) : (
                <NotebookTextCell
                  key={cell.id}
                  cell={cell}
                  presentMode
                  readOnly
                  filePath={filePath}
                  onCellChange={updateCell}
                  onRemove={removeCell}
                />
              ))}
            </VStack>
          )}
        </Box>
      </Box>
    );
  }

  return (
    // No own scroll container — the shared FileLayout column owns page scroll,
    // so the horizontal gutters scroll too (a nested scroller leaves them dead).
    <Box p={4}>
      {/* data-file-id → standard FileView capture (useScreenshot / Dev Tools "Download Image"). */}
      <Box maxW="900px" mx="auto" {...(fileId !== undefined ? { 'data-file-id': fileId } : {})}>
      <VStack align="stretch" gap={0} pl={{ base: 0, md: '40px' }}>
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
                        collapsed={collapsedIds.has(cell.id)}
                        onToggleCollapse={() => toggleCollapse(cell.id)}
                        runNonce={runNonce}
                        readOnly={readOnly}
                        filePath={filePath}
                        executed={executedById[cell.id] ?? null}
                        onExecutedChange={(e) => setCellExecuted(cell.id, e)}
                        onPersistResult={persistCellResult}
                        onCellChange={updateCell}
                        onRemove={removeCell}
                      />
                    ) : (
                      <NotebookTextCell
                        cell={cell}
                        active={active}
                        onActivate={onActivateCell}
                        collapsed={collapsedIds.has(cell.id)}
                        onToggleCollapse={() => toggleCollapse(cell.id)}
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
    </Box>
  );
}
