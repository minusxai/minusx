'use client';

/**
 * ViewWorkbench — the expand-in-place editor for a view.
 *
 * A view row in the whitelist UI expands into this: write SQL, run it, see real
 * rows, name it, save. On save the SQL is sent to /api/views/prepare, which
 * validates the name across the whole context tree and snapshots the output
 * columns + types (that snapshot is what makes the saved view behave like a real
 * table — semantic models, relationships, agent schema all key off it).
 *
 * Execution goes through the CORE query path (`getQueryResult`), so views are
 * cached, whitelist-validated and streamed exactly like any other query — the
 * context's path is passed as `filePath` so nested `_views.x` references resolve.
 */

import React, { useCallback, useState } from 'react';
import { Box, VStack, HStack, Text, Button, Input, Table } from '@chakra-ui/react';
import { LuPlay, LuSave, LuTriangleAlert, LuTrash2 } from 'react-icons/lu';
import SqlEditor from '@/components/query-builder/SqlEditor';
import { getQueryResult } from '@/lib/file-state/file-state';
import type { QueryResult, ViewColumn, ViewDef } from '@/lib/types';

interface ViewWorkbenchProps {
  /** The context file's path — resolves nested views + the whitelist. */
  contextPath: string;
  connection: string;
  /** The view being edited; undefined for a brand-new one. */
  view?: ViewDef;
  /** Pre-filled name for a new view (folder-derived, editable). */
  defaultName?: string;
  onSave: (view: ViewDef) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

const PREVIEW_ROWS = 20;

export default function ViewWorkbench({
  contextPath, connection, view, defaultName = '', onSave, onDelete, onCancel,
}: ViewWorkbenchProps) {
  const [name, setName] = useState(view?.name ?? defaultName);
  const [description, setDescription] = useState(view?.description ?? '');
  const [sql, setSql] = useState(view?.sql ?? '');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!sql.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const r = await getQueryResult(
        { query: sql, params: {}, database: connection, filePath: contextPath },
        { forceLoad: true },
      );
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [sql, connection, contextPath]);

  const save = useCallback(async () => {
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
      onSave({
        name: name.trim(),
        connection,
        sql,
        columns,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
    } catch {
      setError('Could not save the view');
    } finally {
      setSaving(false);
    }
  }, [contextPath, connection, name, sql, description, view?.name, onSave]);

  const canSave = !!name.trim() && !!sql.trim() && !saving;
  const rows = (result?.rows ?? []).slice(0, PREVIEW_ROWS);

  return (
    <VStack
      align="stretch" gap={3} p={3}
      bg="bg.surface" borderRadius="md" border="1px solid" borderColor="border.muted"
      onClick={(e) => e.stopPropagation()}
    >
      <HStack gap={2}>
        <Input
          aria-label="View name"
          size="sm" fontFamily="mono" fontSize="xs" maxW="240px"
          placeholder="view_name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          aria-label="View description"
          size="sm" fontSize="xs" flex={1}
          placeholder="What does this view show? (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </HStack>

      <Box border="1px solid" borderColor="border.muted" borderRadius="md" overflow="hidden" minH="180px">
        <SqlEditor
          value={sql}
          onChange={setSql}
          onRun={run}
          showRunButton={false}
          databaseName={connection}
        />
      </Box>

      <HStack gap={2}>
        <Button aria-label="Run view query" size="xs" variant="outline" onClick={run} loading={running}>
          <LuPlay size={12} /> <Text ml={1} fontFamily="mono">Run</Text>
        </Button>
        {result && (
          <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">
            {result.rows.length} rows · {result.columns.length} columns
          </Text>
        )}
      </HStack>

      {error && (
        <HStack aria-label="View error" gap={1.5} color="accent.danger" fontSize="xs" fontFamily="mono" align="start">
          <Box pt="2px"><LuTriangleAlert size={12} /></Box>
          <Text>{error}</Text>
        </HStack>
      )}

      {rows.length > 0 && (
        <Box aria-label="View preview" maxH="220px" overflow="auto" border="1px solid" borderColor="border.muted" borderRadius="md">
          <Table.Root size="sm" stickyHeader>
            <Table.Header>
              <Table.Row>
                {result!.columns.map((c) => (
                  <Table.ColumnHeader key={c} fontFamily="mono" fontSize="2xs">{c}</Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row, i) => (
                <Table.Row key={i}>
                  {result!.columns.map((c) => (
                    <Table.Cell key={c} fontFamily="mono" fontSize="2xs">{String((row as Record<string, unknown>)[c] ?? '')}</Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}

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
            <LuSave size={12} /> <Text ml={1}>Save view</Text>
          </Button>
        </HStack>
      </HStack>
    </VStack>
  );
}
