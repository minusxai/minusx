'use client';

/**
 * ViewWorkbench — the expand-in-place editor for a view.
 *
 * It REUSES the question component rather than reimplementing one: the view is
 * authored on a VIRTUAL question file (a negative id, which `loadFiles`
 * deliberately never sends to the server), so what you get is the real editor —
 * the GUI / SQL / Viz tabs, Run, parameters, charts — behaving exactly as it
 * does on a question page. Saving reads that file's content back out of Redux.
 *
 * Save goes through /api/views/prepare, which validates the name across the
 * whole context tree and snapshots the output columns + types. The actual
 * boundary check (what a view is allowed to READ) happens server-side on the
 * context save — see lib/views/save-gate.server.ts — because the dialog is not
 * the only way a view can be written.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, VStack, HStack, Text, Button, Input } from '@chakra-ui/react';
import { LuSave, LuTriangleAlert, LuTrash2 } from 'react-icons/lu';
import QuestionContainerV2 from '@/components/containers/QuestionContainerV2';
import { setFile, selectMergedContent, removeVirtualFile } from '@/store/filesSlice';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { createDefaultTableViz } from '@/lib/data/story/template-defaults';
import type { DbFile, QuestionContent, ViewColumn, ViewDef } from '@/lib/types';

interface ViewWorkbenchProps {
  /** The context file's path — resolves nested views + the whitelist. */
  contextPath: string;
  connection: string;
  /** The view being edited; undefined for a brand-new one. */
  view?: ViewDef;
  /** Pre-filled name for a new view (folder-derived, editable). */
  defaultName?: string;
  /** Inspect-only: the definition is shown but nothing can be edited or saved. */
  readOnly?: boolean;
  onSave?: (view: ViewDef) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

/**
 * Virtual file ids are negative: `loadFiles` filters them out, so the question
 * component renders purely from what we seed into Redux — no server round-trip,
 * no phantom file.
 */
let nextVirtualId = -900_001;

export default function ViewWorkbench({
  contextPath, connection, view, defaultName = '', readOnly = false, onSave, onDelete, onCancel,
}: ViewWorkbenchProps) {
  const dispatch = useAppDispatch();
  const [name, setName] = useState(view?.name ?? defaultName);
  const [description, setDescription] = useState(view?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileId = useMemo(() => nextVirtualId--, []);

  // Seed the virtual question the editor works on.
  useEffect(() => {
    const content: QuestionContent = {
      description: null,
      query: view?.sql ?? '',
      viz: view?.viz ?? createDefaultTableViz(),
      parameters: [],
      parameterValues: {},
      connection_name: connection,
      cachePolicy: null,
    } as QuestionContent;

    const file: DbFile = {
      id: fileId,
      name: view?.name ?? 'New view',
      type: 'question',
      path: `${contextPath.substring(0, contextPath.lastIndexOf('/')) || '/'}/${view?.name ?? 'new-view'}`,
      content,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
      last_edit_id: null,
      // New models must behave like new questions: keep the live SQL inert until
      // the user explicitly clicks Run. Existing definitions still auto-preview.
      draft: !view,
    } as unknown as DbFile;

    dispatch(setFile({ file, references: [] }));
  }, [dispatch, fileId, contextPath, connection, view?.sql, view?.name, view?.viz]);

  // What the user has actually built in the editor (SQL + chart), live from Redux.
  const edited = useAppSelector((s) => selectMergedContent(s, fileId)) as QuestionContent | undefined;

  const save = useCallback(async () => {
    const sql = edited?.query ?? '';
    if (!name.trim() || !sql.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/views/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: contextPath, connection, name: name.trim(), sql,
          ...(view?.name ? { editing: view.name } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setError(body?.error?.message ?? body?.error ?? 'Could not save the view');
        return;
      }
      const columns: ViewColumn[] = body.data?.columns ?? [];
      onSave?.({
        name: name.trim(),
        connection,
        sql,
        columns,
        viz: edited?.viz ?? createDefaultTableViz(),
        ...(view?.whitelistedColumns ? { whitelistedColumns: view.whitelistedColumns } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      // The question editor is only a scratch surface for authoring the view.
      // Once its contents have been copied into the context, remove it so the
      // global dirty-file selector cannot report it as an unrelated change.
      dispatch(removeVirtualFile(fileId));
    } catch {
      setError('Could not save the view');
    } finally {
      setSaving(false);
    }
  }, [contextPath, connection, name, description, edited, view, onSave, dispatch, fileId]);

  const canSave = !!name.trim() && !!edited?.query?.trim() && !saving;

  return (
    <VStack
      align="stretch" gap={3} py={3}
      bg="bg.surface"
      onClick={(e) => e.stopPropagation()}
    >
      <HStack gap={2}>
        <Input
          aria-label="View name"
          size="sm" fontFamily="mono" fontSize="xs" maxW="240px"
          placeholder="view_name"
          value={name}
          readOnly={readOnly}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          aria-label="View description"
          size="sm" fontSize="xs" flex={1}
          placeholder="What does this data model show? (optional)"
          value={description}
          readOnly={readOnly}
          onChange={(e) => setDescription(e.target.value)}
        />
      </HStack>

      {/* The real question editor — GUI / SQL / Viz, Run, charts. Read-only when
          inspecting a definition (the editor itself disables editing + Monaco).
          A FIXED height (not minH) is essential: the editor fills its parent, so
          an unbounded parent makes Monaco lay out to tens of thousands of px (the
          minimap becomes a giant strip) and the results table grows forever. */}
      <Box overflow="hidden" px={0}
        h="480px" display="flex" flexDirection="column"
      >
        <QuestionContainerV2 fileId={fileId} readOnly={readOnly} />
      </Box>

      {error && (
        <HStack aria-label="View error" gap={1.5} color="accent.danger" fontSize="xs" fontFamily="mono" align="start">
          <Box pt="2px"><LuTriangleAlert size={12} /></Box>
          <Text>{error}</Text>
        </HStack>
      )}

      {/* Read-only inspection has no footer — the row's Definition/Hide toggle
          closes it. Editing keeps explicit Save / Delete / Cancel. */}
      {!readOnly && (
        <HStack justify="space-between">
          {onDelete ? (
            <Button aria-label="Delete view" size="xs" variant="ghost" colorPalette="red" onClick={onDelete}>
              <LuTrash2 size={12} /> <Text ml={1}>Delete</Text>
            </Button>
          ) : <Box />}
          <HStack gap={2}>
            <Button aria-label="Cancel view" size="xs" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button
              aria-label="Save view"
              size="xs" bg="accent.teal" color="white"
              onClick={save} disabled={!canSave} loading={saving}
            >
              <LuSave size={12} /> <Text ml={1}>Update</Text>
            </Button>
          </HStack>
        </HStack>
      )}
    </VStack>
  );
}
