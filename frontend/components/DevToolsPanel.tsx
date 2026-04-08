'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Box, VStack, HStack, Text, IconButton, Button, createListCollection } from '@chakra-ui/react';
import { SelectRoot, SelectTrigger, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { LuCamera, LuChevronDown, LuChevronRight, LuDownload, LuLink, LuMonitor, LuServer } from 'react-icons/lu';
import { AppState } from '@/lib/appState';
import AppStateViewer from './AppStateViewer';
import { useScreenshot } from '@/lib/hooks/useScreenshot';
import { getRegisteredToolNames, executeToolCall } from '@/lib/api/tool-handlers';
import { UserInputException, type UserInputProps, type UserInput } from '@/lib/api/user-input-exception';
import { getStore } from '@/store/store';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { ToolCall, DatabaseWithSchema } from '@/lib/types';
import { uploadFile } from '@/lib/object-store/client';
import { aggregateData } from '@/lib/chart/aggregate-data';
import { buildChartOption, buildPieChartOption, buildFunnelChartOption, buildWaterfallChartOption } from '@/lib/chart/chart-utils';
import { COLOR_PALETTE } from '@/lib/chart/echarts-theme';
import * as echarts from 'echarts';
import type { VizSettings } from '@/lib/types.gen';

interface DevToolsPanelProps {
  appState: AppState | null | undefined;
}

// OpenAI function tool schema format from describe_tool()
interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type?: string; description?: string }>;
      required: string[];
    };
  };
}

function ToolTester() {
  const [selectedTool, setSelectedTool] = useState('');
  const [argsJson, setArgsJson] = useState('{}');
  const [result, setResult] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [toolSchemas, setToolSchemas] = useState<ToolSchema[]>([]);
  const [pendingInput, setPendingInput] = useState<UserInputProps | null>(null);
  const frontendToolNames = useMemo(() => getRegisteredToolNames(), []);
  const dispatch = useAppDispatch();

  // Index schemas by tool name for quick lookup
  const schemasByName = useMemo(() => {
    const map: Record<string, ToolSchema> = {};
    for (const s of toolSchemas) map[s.function.name] = s;
    return map;
  }, [toolSchemas]);

  // Fetch tool schemas from Python backend on mount
  useEffect(() => {
    fetch('/api/tools/schema')
      .then(res => res.json())
      .then((data: ToolSchema[]) => setToolSchemas(data))
      .catch(() => {}); // silently fail - schemas are optional
  }, []);

  // Merge backend tool names with frontend-only tools
  const toolNames = useMemo(() => {
    const allNames = new Set([...Object.keys(schemasByName), ...frontendToolNames]);
    return Array.from(allNames).sort();
  }, [schemasByName, frontendToolNames]);

  const toolCollection = useMemo(() => createListCollection({
    items: toolNames.map(name => ({ label: name, value: name })),
  }), [toolNames]);

  // Prefill args JSON when tool selection changes
  const handleToolChange = useCallback((name: string) => {
    setSelectedTool(name);
    setResult(null);
    setPendingInput(null);
    const schema = schemasByName[name];
    const props = schema?.function.parameters.properties;
    if (props && Object.keys(props).length > 0) {
      const stub: Record<string, any> = {};
      for (const key of Object.keys(props)) {
        stub[key] = null;
      }
      setArgsJson(JSON.stringify(stub, null, 2));
    } else {
      setArgsJson('{}');
    }
  }, [schemasByName]);

  const runTool = useCallback(async (userInputs?: UserInput[]) => {
    if (!selectedTool) return;
    setIsRunning(true);
    setResult(null);
    setPendingInput(null);
    try {
      const parsedArgs = JSON.parse(argsJson);
      const state = getStore().getState();
      const database: DatabaseWithSchema = { databaseName: '', schemas: [] };

      const toolCall: ToolCall = {
        id: `dev-${Date.now()}`,
        type: 'function',
        function: { name: selectedTool, arguments: parsedArgs },
      };

      const toolResult = await executeToolCall(toolCall, database, dispatch, undefined, state, userInputs);
      setResult(JSON.stringify(JSON.parse(toolResult.content), null, 2));
    } catch (err: any) {
      if (err instanceof UserInputException) {
        setPendingInput(err.props);
      } else {
        setResult(`Error: ${err.message || String(err)}`);
      }
    } finally {
      setIsRunning(false);
    }
  }, [selectedTool, argsJson, dispatch]);

  const handleRun = useCallback(() => runTool(), [runTool]);

  const respondToInput = useCallback((response: any) => {
    if (!pendingInput) return;
    const userInput: UserInput = {
      id: `dev-input-${Date.now()}`,
      props: pendingInput,
      result: response,
      providedAt: new Date().toISOString(),
    };
    runTool([userInput]);
  }, [pendingInput, runTool]);

  return (
    <Box borderWidth="1px" borderColor="border.default" borderRadius="md" p={3} bg="bg.surface">
      <VStack align="stretch" gap={2}>
        <Text fontSize="xs" fontWeight="600" color="fg.muted">Tool Tester</Text>
        <SelectRoot
          collection={toolCollection}
          value={selectedTool ? [selectedTool] : []}
          onValueChange={(e) => handleToolChange(e.value[0] || '')}
          size="xs"
          positioning={{ sameWidth: true, placement: 'bottom' }}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select a tool..." fontFamily="mono" fontSize="2xs" />
          </SelectTrigger>
          <SelectContent maxH="300px" overflowY="auto" fontFamily="mono" fontSize="2xs">
            {toolNames.map((name) => (
              <SelectItem key={name} item={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
        <textarea
          value={argsJson}
          onChange={(e) => setArgsJson(e.target.value)}
          placeholder="Arguments (JSON)"
          rows={4}
          style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--chakra-colors-border)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: '11px', resize: 'vertical' }}
        />
        <Button size="xs" colorPalette="teal" onClick={handleRun} loading={isRunning} disabled={!selectedTool || isRunning}>
          Run
        </Button>

        {/* User input prompt */}
        {pendingInput && (
          <Box p={2} borderRadius="sm" bg="bg.subtle" borderWidth="1px" borderColor="accent.teal">
            <VStack align="stretch" gap={2}>
              <Text fontSize="2xs" fontWeight="600" fontFamily="mono">{pendingInput.title}</Text>
              {pendingInput.message && (
                <Text fontSize="2xs" fontFamily="mono" color="fg.muted">{pendingInput.message}</Text>
              )}
              {pendingInput.type === 'confirmation' && (
                <HStack gap={2}>
                  <Button size="2xs" colorPalette="teal" onClick={() => respondToInput(true)}>
                    {pendingInput.confirmText || 'Yes'}
                  </Button>
                  <Button size="2xs" variant="outline" onClick={() => respondToInput(false)}>
                    {pendingInput.cancelText || 'No'}
                  </Button>
                </HStack>
              )}
              {pendingInput.type === 'choice' && pendingInput.options && (
                <VStack align="stretch" gap={1}>
                  {pendingInput.options.map((opt, i) => (
                    <Button key={i} size="2xs" variant="outline" onClick={() => respondToInput(opt)}>
                      {opt.label}
                    </Button>
                  ))}
                </VStack>
              )}
            </VStack>
          </Box>
        )}

        {result !== null && (
          <Box
            as="pre"
            p={2}
            borderRadius="sm"
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border.default"
            fontSize="2xs"
            fontFamily="mono"
            overflowX="auto"
            maxH="200px"
            overflowY="auto"
            whiteSpace="pre-wrap"
            wordBreak="break-all"
          >
            {result}
          </Box>
        )}
      </VStack>
    </Box>
  );
}

// ── Hidden-canvas ECharts export (matches download button quality) ───────────

function buildEChartsOption(
  queryResult: import('@/lib/types').QueryResult,
  vizSettings: VizSettings,
  colorMode: 'light' | 'dark',
  width: number,
  height: number,
): echarts.EChartsOption | null {
  const xCols = vizSettings.xCols ?? [];
  const yCols = vizSettings.yCols ?? [];
  if (yCols.length === 0 || queryResult.rows.length === 0) return null;

  const chartType = vizSettings.type;
  const aggregated = aggregateData(
    queryResult.rows,
    xCols,
    yCols,
    chartType as Parameters<typeof aggregateData>[3],
  );
  if (aggregated.xAxisData.length === 0 && aggregated.series.length === 0) return null;

  const yPart = yCols.join(', ');
  const xPart = xCols.length > 0 ? xCols[0] : '';
  const splitPart = xCols.length > 1 ? xCols.slice(1).join(', ') : '';
  const chartTitle = [yPart, xPart && `vs ${xPart}`, splitPart && `split by ${splitPart}`]
    .filter(Boolean).join(' ') || undefined;
  const xAxisLabel = xCols.length > 0 ? xCols[0] : undefined;
  const yAxisLabel = yCols.length === 1 ? yCols[0] : yCols.length > 1 ? yCols.join(', ') : undefined;

  if (chartType === 'pie') {
    return buildPieChartOption({ xAxisData: aggregated.xAxisData, series: aggregated.series, colorMode, xAxisColumns: xCols, yAxisColumns: yCols, chartTitle, colorPalette: COLOR_PALETTE, columnFormats: vizSettings.columnFormats ?? undefined });
  }
  if (chartType === 'funnel') {
    return buildFunnelChartOption({ xAxisData: aggregated.xAxisData, series: aggregated.series, colorMode, xAxisColumns: xCols, yAxisColumns: yCols, chartTitle, colorPalette: COLOR_PALETTE, columnFormats: vizSettings.columnFormats ?? undefined });
  }
  if (chartType === 'waterfall') {
    return buildWaterfallChartOption({ xAxisData: aggregated.xAxisData, series: aggregated.series, colorMode, xAxisColumns: xCols, yAxisColumns: yCols, chartTitle, colorPalette: COLOR_PALETTE, columnFormats: vizSettings.columnFormats ?? undefined });
  }
  return buildChartOption({ xAxisData: aggregated.xAxisData, series: aggregated.series, chartType: chartType as 'line' | 'bar' | 'area' | 'scatter', colorMode, colorPalette: COLOR_PALETTE, containerWidth: width, containerHeight: height, xAxisColumns: xCols, yAxisColumns: yCols, xAxisLabel, yAxisLabel, columnFormats: vizSettings.columnFormats ?? undefined, chartTitle });
}

async function renderChartToDataUrl(
  queryResult: import('@/lib/types').QueryResult,
  vizSettings: VizSettings,
  colorMode: 'light' | 'dark' = 'dark',
  width = 512,
  height = 256,
): Promise<string | null> {
  const option = buildEChartsOption(queryResult, vizSettings, colorMode, width, height);
  if (!option) return null;

  const container = document.createElement('div');
  container.style.cssText = `width:${width}px;height:${height}px;position:absolute;left:-9999px;top:-9999px;visibility:hidden;`;
  document.body.appendChild(container);

  try {
    const bgColor = colorMode === 'dark' ? '#161b22' : '#ffffff';
    const chart = echarts.init(container, null, { renderer: 'canvas', width, height });
    chart.setOption({ ...option, animation: false, backgroundColor: bgColor });
    const dataUrl = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: bgColor });
    chart.dispose();
    return dataUrl;
  } finally {
    document.body.removeChild(container);
  }
}

// ── Image Tools test panel ────────────────────────────────────────────────────

type ImageResult = { dataUrl: string; label: string } | { url: string; label: string } | { error: string; label: string };

function ImageToolsPanel({ appState }: { appState: AppState | null | undefined }) {
  const { captureFileView } = useScreenshot();
  const [result, setResult] = useState<ImageResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // which button is loading
  const colorMode = useAppSelector(state => state.ui.colorMode) as 'light' | 'dark';
  const queryResultsMap = useAppSelector(state => state.queryResults.results);

  if (appState?.type !== 'file') return null;
  const { fileState } = appState.state;
  if (fileState.type !== 'question' && fileState.type !== 'dashboard') return null;

  const fileId = fileState.id;
  const questionContent = fileState.type === 'question' ? (fileState.content as any) : null;
  const vizSettings: VizSettings | null = questionContent?.vizSettings ?? null;
  const queryResultId: string | null = (fileState as any).queryResultId ?? null;
  const queryResult = queryResultId ? queryResultsMap[queryResultId]?.data ?? null : null;
  const canUseResults = fileState.type === 'question' && !!vizSettings && !!queryResult;

  const run = async (label: string, fn: () => Promise<ImageResult>) => {
    setBusy(label);
    setResult(null);
    try {
      setResult(await fn());
    } catch (err: any) {
      setResult({ error: err.message ?? String(err), label });
    } finally {
      setBusy(null);
    }
  };

  const handleDomCapture = () => run('DOM Capture', async () => {
    const blob = await captureFileView(fileId);
    return { dataUrl: URL.createObjectURL(blob), label: 'DOM Capture' };
  });

  const handleEChartsExport = () => run('ECharts Export', async () => {
    if (!canUseResults) throw new Error('Need a question with query results and chart viz');
    const dataUrl = await renderChartToDataUrl(queryResult!, vizSettings!, colorMode);
    if (!dataUrl) throw new Error('Chart render returned null (unsupported type or empty data)');
    return { dataUrl, label: 'ECharts Export' };
  });

  const handleGetUrl = () => run('Get URL', async () => {
    const blob = await captureFileView(fileId);
    const file = new File([blob], 'screenshot.png', { type: 'image/png' });
    const { publicUrl } = await uploadFile(file, undefined, { keyType: 'charts' });
    return { url: publicUrl, label: 'Get URL' };
  });

  const handleServerRender = () => run('Server Render', async () => {
    if (!canUseResults) throw new Error('Need a question with query results and chart viz');
    const res = await fetch('/api/dev/render-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryResult, vizSettings, colorMode }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Server error ${res.status}`);
    }
    const { dataUrl } = await res.json();
    return { dataUrl, label: 'Server Render' };
  });

  const download = (dataUrl: string, filename: string) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  return (
    <Box borderWidth="1px" borderColor="border.default" borderRadius="md" p={3} bg="bg.surface">
      <VStack align="stretch" gap={2}>
        <Text fontSize="xs" fontWeight="600" color="fg.muted">Image Tools</Text>
        <HStack gap={1} flexWrap="wrap">
          <Button
            size="2xs"
            variant="outline"
            onClick={handleDomCapture}
            loading={busy === 'DOM Capture'}
            aria-label="DOM Capture"
          >
            <LuMonitor />DOM
          </Button>
          <Button
            size="2xs"
            variant="outline"
            onClick={handleEChartsExport}
            loading={busy === 'ECharts Export'}
            disabled={!canUseResults}
            aria-label="ECharts Export"
            title={!canUseResults ? 'Need a question with query results and a chart viz type' : undefined}
          >
            <LuDownload />ECharts
          </Button>
          <Button
            size="2xs"
            variant="outline"
            onClick={handleGetUrl}
            loading={busy === 'Get URL'}
            aria-label="Get S3 URL"
          >
            <LuLink />S3 URL
          </Button>
          <Button
            size="2xs"
            variant="outline"
            onClick={handleServerRender}
            loading={busy === 'Server Render'}
            disabled={!canUseResults}
            aria-label="Server Render"
            title={!canUseResults ? 'Need a question with query results and a chart viz type' : undefined}
          >
            <LuServer />Server
          </Button>
        </HStack>

        {result && (
          <Box borderWidth="1px" borderColor="border.default" borderRadius="sm" overflow="hidden">
            {'error' in result ? (
              <Box p={2} bg="accent.danger/10">
                <Text fontSize="2xs" fontFamily="mono" color="accent.danger">{result.error}</Text>
              </Box>
            ) : 'url' in result ? (
              <Box p={2}>
                <Text fontSize="2xs" fontFamily="mono" color="fg.muted" mb={1}>{result.label}</Text>
                <Text
                  fontSize="2xs"
                  fontFamily="mono"
                  color="accent.teal"
                  cursor="pointer"
                  wordBreak="break-all"
                  onClick={() => navigator.clipboard.writeText(result.url)}
                  title="Click to copy"
                >
                  {result.url}
                </Text>
              </Box>
            ) : (
              <Box>
                <HStack justify="space-between" px={2} pt={2} pb={1}>
                  <Text fontSize="2xs" fontFamily="mono" color="fg.muted">{result.label}</Text>
                  <IconButton
                    size="2xs"
                    variant="ghost"
                    aria-label="Download image"
                    onClick={() => download(result.dataUrl, `${result.label.toLowerCase().replace(/\s+/g, '-')}.png`)}
                  >
                    <LuDownload />
                  </IconButton>
                </HStack>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.dataUrl}
                  alt={result.label}
                  style={{ width: '100%', height: 'auto', display: 'block' }}
                />
              </Box>
            )}
          </Box>
        )}
        <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">
          DOM: html-to-image capture · ECharts: hidden canvas · S3 URL: DOM→upload · Server: SSR render
        </Text>
      </VStack>
    </Box>
  );
}

export default function DevToolsPanel({ appState }: DevToolsPanelProps) {
  const [appStateOpen, setAppStateOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const fileId = appState?.type === 'file' ? appState.state.fileState.id : undefined;
  const fileAnalytics = useAppSelector(state =>
    fileId !== undefined ? state.files.files[fileId]?.analytics : undefined
  );

  return (
    <Box p={4}>
      <VStack align="stretch" gap={3}>
        <Text fontSize="sm" fontFamily="mono" color="accent.teal" fontWeight="600">
          Development Mode Active
        </Text>

        {/* Image Tools */}
        <ImageToolsPanel appState={appState} />

        {/* App State (collapsible) */}
        <Box borderWidth="1px" borderColor="border.default" borderRadius="md" bg="bg.surface" overflow="hidden">
          <HStack
            px={3} py={2}
            cursor="pointer"
            onClick={() => setAppStateOpen(!appStateOpen)}
            _hover={{ bg: 'bg.subtle' }}
          >
            <Box as={appStateOpen ? LuChevronDown : LuChevronRight} fontSize="xs" color="fg.muted" />
            <Text fontSize="xs" fontWeight="600" color="fg.muted">App State</Text>
          </HStack>
          {appStateOpen && (
            <Box px={3} pb={3}>
              <AppStateViewer appState={appState} maxHeight="400px" />
            </Box>
          )}
        </Box>

        {/* Analytics (collapsible, file only) */}
        {appState?.type === 'file' && (
          <Box borderWidth="1px" borderColor="border.default" borderRadius="md" bg="bg.surface" overflow="hidden">
            <HStack
              px={3} py={2}
              cursor="pointer"
              onClick={() => setAnalyticsOpen(!analyticsOpen)}
              _hover={{ bg: 'bg.subtle' }}
            >
              <Box as={analyticsOpen ? LuChevronDown : LuChevronRight} fontSize="xs" color="fg.muted" />
              <Text fontSize="xs" fontWeight="600" color="fg.muted">Analytics</Text>
            </HStack>
            {analyticsOpen && (
              <Box px={3} pb={3}>
                <Box
                  as="pre"
                  p={2}
                  borderRadius="sm"
                  bg="bg.subtle"
                  borderWidth="1px"
                  borderColor="border.default"
                  fontSize="2xs"
                  fontFamily="mono"
                  overflowX="auto"
                  maxH="300px"
                  overflowY="auto"
                  whiteSpace="pre-wrap"
                  wordBreak="break-all"
                >
                  {JSON.stringify(fileAnalytics ?? null, null, 2)}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* Tool Tester */}
        <ToolTester />
      </VStack>
    </Box>
  );
}
