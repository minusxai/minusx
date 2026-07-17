'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, Button, HStack, Text } from '@chakra-ui/react';
import { createUniver, LocaleType, mergeLocales, type ICellData, type IObjectMatrixPrimitiveType } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import type { SpreadsheetSource } from '@/lib/types';
import { QUESTION_SPREADSHEET_LIMITS, type SpreadsheetLimits } from '@/lib/spreadsheet/materialize';
import { LuPlay } from 'react-icons/lu';

interface SpreadsheetSourceEditorProps {
  source: SpreadsheetSource;
  onChange: (source: SpreadsheetSource) => void;
  onRun?: () => void;
  isRunning?: boolean;
  limits?: SpreadsheetLimits;
  readOnly?: boolean;
}

function toCellData(source: SpreadsheetSource): IObjectMatrixPrimitiveType<ICellData> {
  const data: IObjectMatrixPrimitiveType<ICellData> = {};
  source.columns.forEach((column, columnIndex) => {
    data[0] ??= {};
    data[0][columnIndex] = { v: column.name };
  });
  source.rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value == null) return;
      data[rowIndex + 1] ??= {};
      data[rowIndex + 1][columnIndex] = { v: value };
    });
  });
  return data;
}

function textValue(value: unknown): string | null {
  if (value == null || value === '') return null;
  return String(value);
}

function sourceFromValues(values: unknown[][], previous: SpreadsheetSource): SpreadsheetSource {
  let columnCount = 0;
  for (const row of values) {
    for (let column = row.length - 1; column >= 0; column--) {
      if (textValue(row[column]) != null) {
        columnCount = Math.max(columnCount, column + 1);
        break;
      }
    }
  }

  const columns = Array.from({ length: columnCount }, (_, column) => {
    const name = textValue(values[0]?.[column]) ?? '';
    const previousColumn = previous.columns[column];
    return {
      name,
      type: previousColumn?.name === name ? previousColumn.type : 'auto' as const,
    };
  });
  const rows = values.slice(1).map(row =>
    Array.from({ length: columnCount }, (_, column) => textValue(row[column])),
  );
  while (rows.length > 0 && rows[rows.length - 1].every(value => value == null)) rows.pop();
  return { version: 1, columns, rows };
}

function parseClipboard(text: string): string[][] {
  return text.replace(/\r\n?/g, '\n').split('\n').filter((row, index, all) => row !== '' || index < all.length - 1)
    .map(row => row.split('\t'));
}

export default function SpreadsheetSourceEditor({
  source,
  onChange,
  onRun,
  isRunning = false,
  limits = QUESTION_SPREADSHEET_LIMITS,
  readOnly = false,
}: SpreadsheetSourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef(source);
  const onChangeRef = useRef(onChange);
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pasteRows, setPasteRows] = useState<string[][] | null>(null);
  const [firstRowHeaders, setFirstRowHeaders] = useState(true);
  const [selectedColumn, setSelectedColumn] = useState(0);

  useEffect(() => { sourceRef.current = source; }, [source]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;
    const { univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) },
      presets: [UniverSheetsCorePreset({
        container: containerRef.current,
        header: false,
        toolbar: false,
        formulaBar: false,
        footer: false,
        contextMenu: !readOnly,
        ...(readOnly ? { disableAutoFocus: true as const } : {}),
      })],
    });
    const initial = sourceRef.current;
    univerAPI.createWorkbook({
      id: 'direct-data',
      name: 'Direct data',
      sheetOrder: ['data'],
      sheets: {
        data: {
          id: 'data', name: 'Data',
          rowCount: limits.maxRows + 1,
          columnCount: limits.maxColumns,
          cellData: toCellData(initial),
        },
      },
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleSync = () => {
      if (readOnly) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const values = univerAPI.getActiveWorkbook()?.getActiveSheet()?.getDataRange().getValues() ?? [];
        const next = sourceFromValues(values, sourceRef.current);
        if (next.columns.length > limits.maxColumns || next.rows.length > limits.maxRows) {
          setError(`A spreadsheet can contain at most ${limits.maxRows.toLocaleString()} data rows and ${limits.maxColumns} columns.`);
          setResetKey(key => key + 1);
          return;
        }
        setError(null);
        setSelectedColumn(column => Math.min(column, Math.max(0, next.columns.length - 1)));
        sourceRef.current = next;
        onChangeRef.current(next);
      }, 80);
    };
    const valueDisposable = univerAPI.addEvent(univerAPI.Event.SheetValueChanged, scheduleSync);
    // Delete, clear, undo/redo, and row/column operations do not all emit
    // SheetValueChanged. CommandExecuted is the structural-change backstop.
    const commandDisposable = univerAPI.addEvent(univerAPI.Event.CommandExecuted, scheduleSync);
    const selectionDisposable = univerAPI.addEvent(univerAPI.Event.SelectionChanged, ({ selections }) => {
      const column = selections[0]?.startColumn;
      if (typeof column === 'number') setSelectedColumn(column);
    });

    return () => {
      if (timer) clearTimeout(timer);
      valueDisposable.dispose();
      commandDisposable.dispose();
      selectionDisposable.dispose();
      univerAPI.dispose();
    };
  }, [readOnly, resetKey, limits.maxRows, limits.maxColumns]);

  const applyPaste = () => {
    if (!pasteRows) return;
    const width = Math.max(0, ...pasteRows.map(row => row.length));
    const dataRows = firstRowHeaders ? pasteRows.slice(1) : pasteRows;
    if (width > limits.maxColumns || dataRows.length > limits.maxRows) {
      setError(`Paste rejected: data is limited to ${limits.maxRows.toLocaleString()} rows and ${limits.maxColumns} columns.`);
      setPasteRows(null);
      return;
    }
    const headers = firstRowHeaders
      ? (pasteRows[0] ?? [])
      : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
    const next: SpreadsheetSource = {
      version: 1,
      columns: Array.from({ length: width }, (_, index) => ({ name: headers[index] ?? '', type: 'auto' })),
      rows: dataRows.map(row => Array.from({ length: width }, (_, index) => textValue(row[index]))),
    };
    sourceRef.current = next;
    onChangeRef.current(next);
    setPasteRows(null);
    setError(null);
    setResetKey(key => key + 1);
  };

  return (
    <Box
      flex="1"
      minH="0"
      display="flex"
      flexDirection="column"
      onPasteCapture={(event) => {
        if (readOnly || sourceRef.current.columns.length || sourceRef.current.rows.length) return;
        const text = event.clipboardData.getData('text/plain');
        if (!text) return;
        event.preventDefault();
        event.stopPropagation();
        setPasteRows(parseClipboard(text));
        setFirstRowHeaders(true);
      }}
    >
      {error && <Text role="alert" px={3} py={2} color="accent.danger" fontSize="xs">{error}</Text>}
      {pasteRows && (
        <Box m={3} p={3} border="1px solid" borderColor="border.default" borderRadius="md" bg="bg.surface">
          <Text fontWeight="600" fontSize="sm" mb={2}>Paste {pasteRows.length} rows × {Math.max(0, ...pasteRows.map(row => row.length))} columns?</Text>
          <Box maxH="120px" overflow="auto" border="1px solid" borderColor="border.muted" mb={3}>
            {pasteRows.slice(0, 5).map((row, rowIndex) => (
              <HStack key={rowIndex} gap={0}>{row.slice(0, 6).map((cell, columnIndex) => (
                <Text key={columnIndex} px={2} py={1} minW="90px" fontSize="xs" borderRight="1px solid" borderColor="border.muted" truncate>{cell}</Text>
              ))}</HStack>
            ))}
          </Box>
          <HStack justify="space-between">
            <label><input type="checkbox" checked={firstRowHeaders} onChange={event => setFirstRowHeaders(event.target.checked)} /> <Text as="span" fontSize="xs">First row contains headers</Text></label>
            <HStack><Button size="xs" variant="ghost" onClick={() => setPasteRows(null)}>Cancel</Button><Button size="xs" bg="accent.teal" color="white" onClick={applyPaste}>Import</Button></HStack>
          </HStack>
        </Box>
      )}
      <HStack px={3} py={1.5} minH="41px" gap={2} borderBottom="1px solid" borderColor="border.muted" flexShrink={0} bg="bg.subtle">
        {source.columns[selectedColumn] ? (() => {
          const column = source.columns[selectedColumn];
          const columnLetter = String.fromCharCode(65 + selectedColumn);
          return <>
            <Text fontSize="xs" color="fg.muted" truncate>
              Column {columnLetter}{column.name ? ` · ${column.name}` : ''}
            </Text>
            <select
              aria-label={`Type for ${column.name || `column ${selectedColumn + 1}`}`}
              value={column.type}
              disabled={readOnly}
              onChange={(event) => {
                const next: SpreadsheetSource = {
                  ...sourceRef.current,
                  columns: sourceRef.current.columns.map((item, columnIndex) =>
                    columnIndex === selectedColumn
                      ? { ...item, type: event.target.value as typeof item.type }
                      : item),
                };
                sourceRef.current = next;
                onChangeRef.current(next);
              }}
              style={{ marginLeft: 'auto', fontSize: 12, border: '1px solid var(--chakra-colors-border-muted)', borderRadius: 4, padding: '2px 6px' }}
            >
              <option value="auto">Auto type</option>
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="date">Date</option>
            </select>
          </>;
        })() : (
          <Text fontSize="xs" color="fg.subtle">Add or select a column to set its data type.</Text>
        )}
      </HStack>
      <Box ref={containerRef} flex="1" minH="300px" aria-label="Spreadsheet editor" />
      <HStack px={3} py={2} minH="48px" borderTop="1px solid" borderColor="border.muted" bg="bg.surface" justify="space-between" flexShrink={0}>
        <Text fontSize="xs" color="fg.muted">
          {source.rows.length.toLocaleString()} rows · {source.columns.length} columns
        </Text>
        {!readOnly && onRun && (
          <Button size="sm" bg="accent.teal" color="white" aria-label="Run spreadsheet" loading={isRunning} onClick={onRun}><LuPlay fill="white"/></Button>
        )}
      </HStack>
    </Box>
  );
}
